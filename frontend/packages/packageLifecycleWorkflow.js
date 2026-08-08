import { trustedHTML } from "../shared/trustedTypes.js";
import { deleteAllPackageVersions, deleteLatestPackageVersion, getPackageDeleteContext } from "./packageDeleteHelpers.js";
import {
  persistAndSync,
  refreshRecordBeforeDelete,
  stageLocalRecords,
} from "../shared/MutationService.js";
import { generateRecordId } from "../shared/idUtils.js";
import { hydratePlanPackageRecords, loadPaginatedRecords } from "../shared/tableDataUtils.js";
import { snapshotPackageAggregate } from "./packageAggregateSnapshot.js";

function versionNumber(record) {
  return Number.parseInt(record?.phienBan || "0", 10) || 0;
}

async function hydratePackageOwnedRows(controller, planId) {
  if (!controller.model?.useServerSidePagination || !planId) return;
  await hydratePlanPackageRecords(controller.model, planId);
  await Promise.all([
    "goithauhanghoa",
    "thongtinmothau",
    "hanghoaduthaunhathau",
    "assignments",
  ].map(async (table) => {
    let cursor = "";
    do {
      const page = await loadPaginatedRecords(controller.model, table, {
        pageSize: 200,
        pagination: "cursor",
        sortBy: "id",
        sortOrder: "asc",
        keHoachId: planId,
        ...(cursor ? { cursor } : {}),
      });
      const nextCursor = String(page?.nextCursor || "");
      if (!page?.hasMore || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    } while (cursor);
  }));
}

/**
 * Older data may have been created while the plan-version workflow only had a
 * partial package cache. In that case the new plan contains package -02 but is
 * missing the inherited -01 snapshot. Deleting -02 would therefore leave the
 * plan with no package at all.
 *
 * Repair that broken lineage just-in-time by cloning the closest predecessor
 * into the current plan before deleting the newest package version.
 */
async function repairMissingPreviousPlanSnapshot(controller, context) {
  const target = context?.targetPackage;
  const targetPlanId = String(target?.keHoachId || "");
  const targetVersion = versionNumber(target);
  if (!targetPlanId || targetVersion <= 0) return context;

  await hydratePlanPackageRecords(controller.model, targetPlanId);
  let refreshed = getPackageDeleteContext(controller.model.state.goithau, target.id);
  if (!refreshed) return context;

  const samePlanPredecessor = refreshed.relatedPackages.some((record) => (
    String(record?.keHoachId || "") === targetPlanId
    && versionNumber(record) < targetVersion
  ));
  if (samePlanPredecessor) return refreshed;

  const candidates = refreshed.relatedPackages
    .filter((record) => String(record?.id) !== String(target.id))
    .filter((record) => versionNumber(record) < targetVersion)
    .sort((a, b) => versionNumber(b) - versionNumber(a));
  const source = candidates[0];
  if (!source) return refreshed;

  await hydratePackageOwnedRows(controller, source.keHoachId);
  const hydratedSource = controller.model.state.goithau.find(
    (record) => String(record?.id) === String(source.id),
  ) || source;
  const timestamp = controller.model.getCurrentDateTimeString();
  const snapshot = snapshotPackageAggregate(controller.model.state, hydratedSource, {
    targetPackageId: generateRecordId("goithau"),
    targetPlanId,
    packageVersion: hydratedSource.phienBan || "00",
    timestamp,
    createId: generateRecordId,
  });
  // -02 remains latest until it is deleted in the same mutation. The backend
  // then recalculates the current plan family and promotes this restored -01.
  snapshot.packageRecord.isLatest = 0;
  controller.model.state.goithau.push(snapshot.packageRecord);
  ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau", "assignments"].forEach((key) => {
    controller.model.state[key] ||= [];
    controller.model.state[key].push(...snapshot[key]);
  });

  return getPackageDeleteContext(controller.model.state.goithau, target.id) || refreshed;
}

export function openPackageWizardStep() {
  if (!this.packageWizard.active) return;
  if (!document.getElementById("modal-goithau")) {
    this.ensureLazyModal?.("modal-goithau").then(() => this.openPackageWizardStep());
    return;
  }
  this.editGoiThau(null);
  const titleEl = document.getElementById("modal-goithau-title");
  if (titleEl) {
    titleEl.innerHTML = trustedHTML(`Thêm Gói thầu <span class="bf-s-e5cb2683fc">(Gói thầu số ${this.packageWizard.currentCount} trên tổng số ${this.packageWizard.totalCount})</span>`);
  }
  const planSelect = document.getElementById("gt-kehoachid");
  if (planSelect) {
    planSelect.value = this.packageWizard.planId;
    planSelect.disabled = true;
    planSelect.dispatchEvent(new Event("change"));
  }
}
export async function refreshPackageDeleteDependencies(controller, deleteContext) {
  if (!deleteContext) return null;
  const references = [];
  const seen = new Set();
  const addReference = (table, id) => {
    const normalizedId = String(id || "").trim();
    const key = `${table}:${normalizedId}`;
    if (!normalizedId || seen.has(key)) return;
    seen.add(key);
    references.push([table, normalizedId]);
  };
  deleteContext.versionRefs.forEach((record) => addReference("goithau", record?.id));
  deleteContext.planIds.forEach((id) => addReference("kehoach", id));
  const packageIds = new Set(deleteContext.relatedIds.map(String));
  (controller.model.state.thongtinmothau || []).forEach((record) => {
    if (packageIds.has(String(record?.goiThauId))) {
      addReference("thongtinmothau", record.id);
    }
  });
  await Promise.all(
    references.map(([table, id]) => refreshRecordBeforeDelete(controller, table, id))
  );
  return getPackageDeleteContext(
    controller.model.state.goithau,
    deleteContext.targetPackage.id
  );
}
export async function deleteGoiThau(id) {
  const refreshedTarget = await refreshRecordBeforeDelete(this, "goithau", id);
  if (refreshedTarget?.keHoachId) {
    await hydratePlanPackageRecords(this.model, refreshedTarget.keHoachId);
  }
  let deleteContext = getPackageDeleteContext(this.model.state.goithau, id);
  if (!deleteContext) return;
  deleteContext = await refreshPackageDeleteDependencies(this, deleteContext);
  if (!deleteContext) return;
  let deleteConfirmed = false;
  let deleteChoice = null;
  if (deleteContext.versionCount >= 2) {
    deleteChoice = await this.view.customVersionDeleteChoice(
      "Xác nhận xóa",
      `Gói thầu "${deleteContext.targetPackage.tenGoiThau}" có ${deleteContext.versionCount} phiên bản. Vui lòng chọn cách thức xóa:`,
      "Xóa phiên bản gần nhất",
      "Xóa toàn bộ"
    );
    if (deleteChoice === null) return;
  } else {
    const confirmed = await this.view.customConfirm(
      "Xác nhận xóa",
      "Bạn có chắc muốn xóa gói thầu này? Mọi phiên bản lịch sử liên quan sẽ bị xóa bỏ.",
      "trash-2"
    );
    if (!confirmed) return;
    deleteConfirmed = true;
  }
  if (deleteChoice === 1) {
    deleteContext = await repairMissingPreviousPlanSnapshot(this, deleteContext);
    const deleted = deleteLatestPackageVersion(this.model, deleteContext);
    deleteContext.planIds.forEach((pId) => {
      if (pId) {
        this.recalculatePlanTotal(pId);
      }
    });
    const breakdownPlanId = document.getElementById("breakdown-plan-id")?.value;
    const modalBreakdown = document.getElementById("modal-plan-breakdown");
    if (modalBreakdown && modalBreakdown.classList.contains("active") && breakdownPlanId) {
      this.renderBreakdownPackagesList(breakdownPlanId);
      this.updateBreakdownTotal(breakdownPlanId);
    }
    const changedPackages = this.model.state.goithau.filter(
      (pkg) => String(pkg.rootId || pkg.id) === String(deleteContext.rootId),
    );
    const changedPlans = this.model.state.kehoach.filter(
      (plan) => deleteContext.planIds.some((id) => String(id) === String(plan.id)),
    );
    stageLocalRecords(this.model, "goithau", changedPackages);
    stageLocalRecords(this.model, "kehoach", changedPlans);
    try {
      const syncResult = await persistAndSync(this, ["goithau", "thongtinmothau", "kehoach"], {
        changes: {
          upserts: { goithau: changedPackages, kehoach: changedPlans },
          deletions: {
            goithau: deleted.deletedPackages,
            thongtinmothau: deleted.deletedBids,
          },
        },
        afterPersist: () => {
          this.view.renderGoiThauTable();
          this.view.renderKeHoachTable();
        }
      });
      if (!syncResult?.ok) {
        await this.view.customAlert("Không thể xóa", "Máy chủ chưa xác nhận thao tác. Dữ liệu mới nhất sẽ được tải lại.", "alert-triangle");
        return;
      }
    } catch {
      await this.view.customAlert("Không thể xóa", "Máy chủ không xác nhận thao tác xóa. Vui lòng kiểm tra kết nối và thử lại.", "x-circle");
      return;
    }
  } else if (deleteChoice === 2 || deleteConfirmed) {
    const deleted = deleteAllPackageVersions(this.model, deleteContext);
    deleteContext.planIds.forEach((pId) => {
      if (pId) {
        this.recalculatePlanTotal(pId);
      }
    });
    const breakdownPlanId = document.getElementById("breakdown-plan-id")?.value;
    const modalBreakdown = document.getElementById("modal-plan-breakdown");
    if (modalBreakdown && modalBreakdown.classList.contains("active") && breakdownPlanId) {
      this.renderBreakdownPackagesList(breakdownPlanId);
      this.updateBreakdownTotal(breakdownPlanId);
    }
    const changedPlans = this.model.state.kehoach.filter(
      (plan) => deleteContext.planIds.some((id) => String(id) === String(plan.id)),
    );
    stageLocalRecords(this.model, "kehoach", changedPlans);
    try {
      const syncResult = await persistAndSync(this, ["goithau", "thongtinmothau", "kehoach"], {
        changes: {
          upserts: { kehoach: changedPlans },
          deletions: {
            goithau: deleted.deletedPackages,
            thongtinmothau: deleted.deletedBids,
          },
        },
        afterPersist: () => {
          this.view.renderGoiThauTable();
          this.view.renderKeHoachTable();
        }
      });
      if (!syncResult?.ok) {
        await this.view.customAlert("Không thể xóa", "Máy chủ chưa xác nhận thao tác. Dữ liệu mới nhất sẽ được tải lại.", "alert-triangle");
        return;
      }
    } catch {
      await this.view.customAlert("Không thể xóa", "Máy chủ không xác nhận thao tác xóa. Vui lòng kiểm tra kết nối và thử lại.", "x-circle");
      return;
    }
  }
}
