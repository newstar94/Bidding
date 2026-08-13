import { trustedHTML } from "../shared/trustedTypes.js";
import { deleteAllPackageVersions, getPackageDeleteContext } from "./packageDeleteHelpers.js";
import {
  persistAndSync,
  refreshRecordBeforeDelete,
  stageLocalRecords,
} from "../shared/MutationService.js";
import { hydratePlanPackageRecords, loadPaginatedRecords } from "../shared/tableDataUtils.js";
import {
  isPlanBreakdownDraftActive,
  removeDraftPackageAggregate,
} from "../plans/planBreakdownDraft.js";

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

async function hydratePackageFamilyAcrossPlanVersions(controller, target) {
  const model = controller.model;
  const targetPlanId = String(target?.keHoachId || "").trim();
  if (!model?.useServerSidePagination || !targetPlanId) return;

  let targetPlan = (model.state.kehoach || []).find(
    (plan) => String(plan?.id) === targetPlanId,
  );
  if (typeof controller.fetchRecordByLookup === "function") {
    targetPlan = await controller.fetchRecordByLookup("kehoach", targetPlanId)
      || targetPlan;
  }
  const planIds = new Set([targetPlanId]);
  (targetPlan?.allVersions || []).forEach((plan) => {
    if (plan?.id) planIds.add(String(plan.id));
  });
  const planRootId = String(targetPlan?.rootId || targetPlan?.id || "");
  (model.state.kehoach || []).forEach((plan) => {
    if (planRootId && String(plan?.rootId || plan?.id || "") === planRootId) {
      planIds.add(String(plan.id));
    }
  });

  await Promise.all([...planIds].map((planId) => (
    hydratePlanPackageRecords(model, planId)
  )));
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
  const localTarget = this.model.state.goithau.find((pkg) => String(pkg.id) === String(id));
  if (localTarget && isPlanBreakdownDraftActive(this, localTarget.keHoachId)) {
    const confirmed = await this.view.customConfirm(
      "Xóa gói thầu khỏi bản nháp",
      `Bạn có chắc muốn xóa gói thầu "${localTarget.tenGoiThau || ""}" khỏi kế hoạch đang nhập?`,
      "trash-2",
    );
    if (!confirmed) return;
    removeDraftPackageAggregate(this.model, id);
    this.recalculatePlanTotal(localTarget.keHoachId);
    this.renderBreakdownPackagesList(localTarget.keHoachId);
    this.updateBreakdownTotal(localTarget.keHoachId);
    globalThis.lucide?.createIcons?.();
    return { ok: true, draft: true };
  }
  const refreshedTarget = await refreshRecordBeforeDelete(this, "goithau", id);
  await hydratePackageFamilyAcrossPlanVersions(this, refreshedTarget);
  let deleteContext = getPackageDeleteContext(this.model.state.goithau, id);
  if (!deleteContext) return;
  for (const planId of deleteContext.planIds.filter(Boolean)) {
    await hydratePackageOwnedRows(this, planId);
  }
  deleteContext = getPackageDeleteContext(this.model.state.goithau, id);
  if (!deleteContext) return;
  deleteContext = await refreshPackageDeleteDependencies(this, deleteContext);
  if (!deleteContext) return;
  const confirmed = await this.view.customConfirm(
    "Xác nhận xóa",
    `Bạn có chắc muốn xóa gói thầu "${deleteContext.targetPackage.tenGoiThau || ""}"? Gói thầu và tất cả snapshot của gói trong mọi phiên bản kế hoạch sẽ bị xóa.`,
    "trash-2",
  );
  if (!confirmed) return;

  const deleted = deleteAllPackageVersions(this.model, deleteContext);
  const changedPlans = this.model.state.kehoach.filter(
    (plan) => (
      Number(plan?.isLatest) === 1
      && deleteContext.planIds.some((id) => String(id) === String(plan.id))
    ),
  );
  changedPlans.forEach((plan) => this.recalculatePlanTotal(plan.id));
  const breakdownPlanId = document.getElementById("breakdown-plan-id")?.value;
  const modalBreakdown = document.getElementById("modal-plan-breakdown");
  if (modalBreakdown && modalBreakdown.classList.contains("active") && breakdownPlanId) {
    this.renderBreakdownPackagesList(breakdownPlanId);
    this.updateBreakdownTotal(breakdownPlanId);
  }
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
