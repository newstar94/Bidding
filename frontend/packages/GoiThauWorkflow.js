import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { validateExtensionRows } from "./packageValidation.js";
import { captureModalReturnState, hasModalReturnState, updateModalReturnAction } from "../app/modalReturnState.js";
import { escapeHtml } from "../shared/view_helpers.js";
import {
  resetPackageFormEditableState,
  setPackageEditorState,
  setPackageSubTableActionsVisible,
} from "./packageFormState.js";
import { clearCompetitiveQuotationAppraisal, isCompetitiveQuotationPackage } from "./packageAppraisal.js";
import { persistAndSync, stageLocalRecords } from "../shared/MutationService.js";
import {
  createInitialVersion,
  ensureVersionEhsmtAdjustment,
  getNextVersion,
  rememberSelectedVersion
} from "../shared/VersionedEntityService.js";
import { organizationEmployeeLabel, organizationEmployeeProfile } from "../auth/accessContext.js";
import { loadWorkspaceEmployees } from "../shared/workspaceEmployeeLoader.js";
import {
  hasServerCapability,
  PROCUREMENT_LOOKUP_CAPABILITY,
} from "../auth/serverCapabilities.js";
import {
  derivePackageAssigneeControlState,
  ensureCurrentUserAssignee,
  resolvePackageAssigneeIds,
} from "./packageAssignmentPolicy.js";
import {
  applyAssignmentDelta,
  initializeMultiAssigneeSelect,
  selectedAssigneeIds,
} from "../shared/MultiAssigneeSelect.js";
import { derivePackagePrice } from "./packagePricing.js";
import { parseLotListForDisplay } from "./lotJsonParser.js";
import { getGoiThauFormInputValues } from "./GoiThauModals.js";
import { loadPaginatedRecords } from "../shared/tableDataUtils.js";
import { assignNewPackageLotIds, clonePackageGoodsForSnapshot } from "./packageGoodsVersioning.js";
import { snapshotPackageAggregate } from "./packageAggregateSnapshot.js";
import { createOfficialAggregateVersion } from "../shared/AggregateVersionClient.js";
import { presentStatus } from "./LifecyclePolicy.js";
import { bindProcurementCodeAutoLookup } from "../procurement/ProcurementAutoLookup.js";
import {
  captureWorkspaceLease,
  isWorkspaceLeaseCurrent,
  workspaceChangedError,
} from "../app/workspaceLease.js";

function stalePackageFlowError() {
  const error = new Error("Package import flow changed before the operation completed");
  error.name = "AbortError";
  error.code = "FLOW_CHANGED";
  return error;
}

export function shouldCreatePackageVersion(previousPackage, nextPackage, sourceRevision = null) {
  const effectiveSourceRevision = sourceRevision
    || (previousPackage?._procurementImportCurrent === true
      ? previousPackage?.sourceRevision
      : null);
  const authoritative = effectiveSourceRevision?.provider === "MUASAMCONG";
  const sourceVersion = Number(
    effectiveSourceRevision?.packageRevisionNumber
      ?? effectiveSourceRevision?.revisionNumber,
  );
  if (authoritative) {
    return Number.isInteger(sourceVersion)
      && sourceVersion > Number(previousPackage?.phienBan || 0);
  }
  const previousPublishedAt = String(previousPackage?.thoiGianDangTai || "").trim();
  if (!previousPublishedAt) return false;
  const changed = (before, after) => {
    const oldValue = String(before || "").trim();
    const newValue = String(after || "").trim();
    if (!oldValue && !newValue) return false;
    if (!oldValue || !newValue) return true;
    const oldDate = new Date(oldValue);
    const newDate = new Date(newValue);
    if (Number.isNaN(oldDate.getTime()) || Number.isNaN(newDate.getTime())) {
      return oldValue !== newValue;
    }
    return oldDate.getTime() !== newDate.getTime();
  };
  return changed(previousPublishedAt, nextPackage?.thoiGianDangTai)
    || changed(previousPackage?.thoiGianDongThau, nextPackage?.thoiGianDongThau)
    || changed(previousPackage?.thoiGianMoThau, nextPackage?.thoiGianMoThau);
}
import {
  evaluationMethodLabel,
  isCombinedEvaluationMethod,
} from "./evaluationMethodRules.js";
import { waitForPackageInheritance } from "./packageRebidWorkflow.js";
import {
  applyDraftAssignmentSelection,
  isPlanBreakdownDraftActive,
} from "../plans/planBreakdownDraft.js";
import {
  materializeProcurementPackageGoods,
} from "../procurement/ProcurementDraftWorkflow.js";
import {
  findPlanVersionDraftSession,
  persistActivePlanVersionDraftSession,
} from "../plans/PlanVersionDraftSession.js";
export { deleteGoiThau, openPackageWizardStep } from "./packageLifecycleWorkflow.js";

export async function persistPackageFormChanges(controller, explicitUpserts, {
  draft = false,
  afterPersist,
  baseUpserts = {},
} = {}) {
  const planId = explicitUpserts?.goithau?.[0]?.keHoachId
    || explicitUpserts?.kehoach?.[0]?.id
    || controller?.planBreakdownDraft?.planId;
  if (draft || isPackageDraftSaveActive(controller, planId)) {
    await persistActivePlanVersionDraftSession(controller, planId);
    return { ok: true, draft: true };
  }
  const aggregateUpserts = Object.fromEntries(
    Object.entries(explicitUpserts).filter(([table]) => table !== "assignments"),
  );
  Object.entries(aggregateUpserts).forEach(([table, records]) => {
    stageLocalRecords(controller.model, table, records, null, baseUpserts[table] || []);
  });
  return persistAndSync(controller, [
    "goithau",
    "goithauhanghoa",
    "hanghoaduthaunhathau",
    "kehoach",
    "thongtinmothau",
  ], {
    changes: { upserts: aggregateUpserts },
    afterPersist,
  });
}

const PACKAGE_SAVE_AGGREGATE_TABLES = [
  "goithau",
  "goithauhanghoa",
  "hanghoaduthaunhathau",
  "kehoach",
  "thongtinmothau",
];

export function capturePackageSaveBaseState(state) {
  return Object.fromEntries(PACKAGE_SAVE_AGGREGATE_TABLES.map((table) => [
    table,
    structuredClone(Array.isArray(state?.[table]) ? state[table] : []),
  ]));
}

export function packageSaveBaseUpserts(baseState, explicitUpserts) {
  return Object.fromEntries(PACKAGE_SAVE_AGGREGATE_TABLES.map((table) => {
    const stagedIds = new Set((explicitUpserts?.[table] || []).map((record) => String(record?.id || "")));
    return [table, (baseState?.[table] || []).filter((record) => stagedIds.has(String(record?.id || "")))];
  }));
}

export function isPackageDraftSaveActive(controller, planId) {
  return isPlanBreakdownDraftActive(controller, planId)
    || Boolean(findPlanVersionDraftSession(controller?.model, planId));
}

export function shouldShowPackageSyncFailureDialog(syncResult) {
  return Boolean(
    syncResult?.ok === false
    && syncResult?.conflictQuarantined !== true
    && syncResult?.reloadRequired !== true,
  );
}

export function packageSyncRequiresReload(syncResult) {
  return Boolean(
    syncResult?.conflictQuarantined === true
    || syncResult?.reloadRequired === true
    || syncResult?.conflict === true
    || syncResult?.status === 409,
  );
}

export function renderPackageSaveTables(view) {
  view?.renderGoiThauTable?.();
  view?.renderKeHoachTable?.();
}

export function restorePackageEditorAfterSyncConflict(form, modal) {
  if (form) form.dataset.submitState = "ready";
  setPackageEditorState(modal, "ready");
}

export function showPackageSyncReloadToast(view) {
  return view?.showToast?.(
    "Dữ liệu đã thay đổi trên máy chủ",
    "Nhấn F5 để tải trạng thái mới nhất trước khi chỉnh sửa lại.",
    "warning",
  );
}

export function packageFamilyUpsertsForPlan(packages, finalPackage) {
  const rootId = String(finalPackage?.rootId || finalPackage?.id || "");
  const planId = String(finalPackage?.keHoachId || "");
  return packages.filter((item) => (
    String(item.rootId || item.id) === rootId
    && String(item.keHoachId || "") === planId
  ));
}

/**
 * The package form needs the complete organization expert catalog to build its
 * two team selectors. Route startup intentionally loads only the data needed
 * to render a list page, so a cold cache must hydrate this catalog on demand
 * before the modal is populated.
 */
export async function hydratePackageExpertOptions(model, {
  loadRecords = loadPaginatedRecords,
  pageSize = 200,
} = {}) {
  if (!model?.useServerSidePagination) return model?.state?.chuyengia || [];

  const experts = [];
  let cursor = "";
  do {
    const page = await loadRecords(model, "chuyengia", {
      pageSize,
      pagination: "cursor",
      sortBy: "id",
      sortOrder: "asc",
      ...(cursor ? { cursor } : {}),
    });
    experts.push(...(Array.isArray(page?.items) ? page.items : []));
    const nextCursor = String(page?.nextCursor || "");
    if (!page?.hasMore || !nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  } while (cursor);
  return experts;
}

export async function createOfficialPackageVersionFromForm(
  controller,
  sourcePackage,
  changes,
  { generateId = generateRecordId } = {},
) {
  if (!(Number(sourcePackage?.rowVersion) > 0)) {
    return { authoritative: false, fallbackRequired: true };
  }
  const createAggregateVersion = controller.createAggregateVersion
    || createOfficialAggregateVersion;
  const result = await createAggregateVersion(controller, {
    kind: "package",
    sourceId: sourcePackage.id,
    expectedRowVersion: Number(sourcePackage.rowVersion),
    changes,
    clientMutationId: generateId("version-command"),
  });
  if (!result?.authoritative) return result;
  const rootId = String(sourcePackage.rootId || sourcePackage.id);
  const packageRecord = controller.model.state.goithau.find((candidate) => (
    String(candidate.rootId || candidate.id) === rootId
    && String(candidate.keHoachId) === String(changes?.keHoachId || sourcePackage.keHoachId)
    && candidate.isLatest == 1
    && String(candidate.id) !== String(sourcePackage.id)
  ));
  if (!packageRecord) {
    throw new Error("Máy chủ đã tạo phiên bản nhưng gói thầu mới chưa được tải về.");
  }
  rememberSelectedVersion(
    controller.model.state,
    "selectedPackageVersion",
    packageRecord,
  );
  return { ...result, packageRecord };
}

// eslint-disable-next-line complexity -- Legacy package form orchestration is isolated for a dedicated refactor.
export async function editGoiThau(id, isReadOnly = false) {
  const editLease = captureWorkspaceLease(this.model);
  const editStorage = this.model.workspaceStorage;
  const editPackageFlow = this.procurementPackageImport;
  const assertEditWorkspaceCurrent = () => {
    if (
      !isWorkspaceLeaseCurrent(this.model, editLease)
      || this.model.workspaceStorage !== editStorage
    ) {
      throw workspaceChangedError();
    }
    if (this.procurementPackageImport !== editPackageFlow) throw stalePackageFlowError();
  };
  if (!document.getElementById("modal-goithau")) {
    await this.ensureLazyModal?.("modal-goithau");
  }
  assertEditWorkspaceCurrent();
  const packageModal = document.getElementById("modal-goithau");
  const form = document.getElementById("form-goithau");
  setPackageEditorState(packageModal, "loading");
  form.dataset.submitState = "loading";
  const storedPackage = id
    ? this.model.state.goithau.find((g) => String(g.id) === String(id))
    : null;
  const gt = storedPackage
    ? { ...storedPackage, trangThai: presentStatus(storedPackage.trangThai).label }
    : null;
  const procurementLookupEnabled = hasServerCapability(
    PROCUREMENT_LOOKUP_CAPABILITY,
  );
  resetPackageFormEditableState(form);
  setPackageSubTableActionsVisible(true);
  const khSelect = document.getElementById("gt-kehoachid");
  khSelect.innerHTML = trustedHTML('<option value="">-- Chọn Kế hoạch --</option>' + this.model.getLatestPlans().map((k) => `<option value="${escapeHtml(k.id)}" data-search="${escapeHtml(`${k.maKeHoach || ""} ${k.tenKeHoach || ""}`)}">${escapeHtml(k.tenKeHoach)}</option>`).join(""));
  khSelect.disabled = false;
  this.makeSearchableSelect(khSelect, "Tìm kiếm Kế hoạch LCNT...");
  const ntSelect = document.getElementById("gt-nhathautrungthauid");
  let filteredBids = [];
  if (id) {
    filteredBids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(id));
  }
  if (filteredBids.length > 0) {
    ntSelect.innerHTML = trustedHTML('<option value="">-- Chọn Nhà thầu trúng thầu --</option>' + filteredBids.map((b) => `<option value="${escapeHtml(b.nhaThauId)}" data-search="${escapeHtml(`${b.maNhaThau || ""} ${b.tenNhaThau || ""}`)}">${escapeHtml(b.tenNhaThau)}</option>`).join(""));
  } else {
    ntSelect.innerHTML = trustedHTML('<option value="">-- (Chưa có nhà thầu tham gia mở thầu) --</option>');
  }
  this.makeSearchableSelect(ntSelect, "Tìm kiếm Nhà thầu trúng thầu...");
  const currentUserId = String(this.model.state.activeuser?.id || globalThis.sessionStorage?.getItem("bf_user_id") || "").trim();
  const currentUserEmployeeProfile = organizationEmployeeProfile(this.model.state.activeuser || {});
  const currentUserCandidate = {
    id: currentUserId,
    name: currentUserEmployeeProfile.name,
    email: this.model.state.activeuser?.email || "",
    role: this.model.state.activerole || this.model.state.activeuser?.dbRole || "employee"
  };
  const restoreEmpValue = () => {
    const empSelect = document.getElementById("gt-nhanvienphutrach");
    if (empSelect) {
      const assignedEmpIds = id
        ? this.model.state.assignments
          .filter((a) => String(a.targetId) === String(gt.id) && a.type === "goithau")
          .map((assignment) => assignment.empId)
        : [];
      const controlState = derivePackageAssigneeControlState({
        activeRole: this.model.state.activerole,
        packageId: id,
        assignedEmpIds,
      });
      initializeMultiAssigneeSelect(empSelect, {
        selectedIds: controlState.values,
        disabled: controlState.disabled || isReadOnly,
      });
    }
  };
  const _populateEmpDropdown = () => {
    const empDropdown = document.getElementById("gt-nhanvienphutrach");
    if (!empDropdown) return;
    const employees = ensureCurrentUserAssignee(this.model.state.employees, currentUserCandidate);
    const knownEmployeeIds = new Set(employees.map((employee) => String(employee.id)));
    const inactiveAssignedIds = id
      ? this.model.state.assignments
        .filter((assignment) => String(assignment.targetId) === String(gt.id) && assignment.type === "goithau")
        .map((assignment) => String(assignment.empId))
        .filter((employeeId) => !knownEmployeeIds.has(employeeId))
      : [];
    const optHtml = employees.map((e) => {
      const employeeProfile = organizationEmployeeProfile(e);
      const employeeName = employeeProfile.name;
      const employeeLabel = organizationEmployeeLabel(e);
      const matchedExpert = this.model.state.chuyengia.find((cg) => cg.hoTen.toLowerCase().trim() === employeeName.toLowerCase().trim());
      const extraSearch = matchedExpert ? `${matchedExpert.soCCCD || ""} ${matchedExpert.soChungChi || ""}` : "";
      return `<option value="${escapeHtml(e.id)}" data-search="${escapeHtml(`${employeeName} ${e.email || ""} ${extraSearch}`)}">${escapeHtml(employeeLabel)}</option>`;
    }).join("") + inactiveAssignedIds.map((employeeId) => (
      `<option value="${escapeHtml(employeeId)}" data-inactive="true" disabled>${escapeHtml(employeeId)} (không còn hoạt động)</option>`
    )).join("");
    empDropdown.innerHTML = trustedHTML('<option value="" disabled>-- Chọn một hoặc nhiều Chuyên viên phụ trách --</option>' + optHtml);
    restoreEmpValue();
  };
  const loadAndPopulateEmpDropdown = async () => {
    if (!this.model.state.employees || this.model.state.employees.length === 0) {
      try {
        await loadWorkspaceEmployees(this.model);
        assertEditWorkspaceCurrent();
        _populateEmpDropdown();
      } catch (err) {
        if (err?.code === "WORKSPACE_CHANGED" || err?.code === "FLOW_CHANGED") throw err;
        if (err?.code !== "WORKSPACE_CHANGED") {
          console.error("Failed to load users:", err);
          assertEditWorkspaceCurrent();
          _populateEmpDropdown();
        }
      }
    } else {
      assertEditWorkspaceCurrent();
      _populateEmpDropdown();
    }
  };
  try {
    await hydratePackageExpertOptions(this.model);
    assertEditWorkspaceCurrent();
  } catch (error) {
    if (["WORKSPACE_CHANGED", "FLOW_CHANGED"].includes(error?.code)) throw error;
    console.error("Failed to load experts for the package team selectors:", error);
    this.view.showToast(
      "Không thể tải chuyên gia",
      "Không thể tải danh sách chuyên gia để lập tổ. Vui lòng thử lại.",
      "error",
    );
    setPackageEditorState(packageModal, "error");
    form.dataset.submitState = "error";
    return;
  }
  const toChuyenGiaTbody = document.getElementById("to-chuyengia-tbody");
  toChuyenGiaTbody.innerHTML = trustedHTML(this.model.state.chuyengia.map((cg) => `
        <tr data-expert-id="${escapeHtml(cg.id)}">
            <td class="bf-s-0c5104285b">
                <input type="checkbox" name="tochuyengia-select" value="${escapeHtml(cg.id)}" class="bf-s-e3145ce1fc">
            </td>
            <td class="bf-s-fc40eefe32">${escapeHtml(cg.hoTen)} <small class="text-muted bf-s-bd877e16c3">Số CC: ${escapeHtml(cg.soChungChi)}</small></td>
            <td class="bf-s-e3cb7ade2b">
                <select name="tochuyengia-chucvu" disabled class="bf-s-ee9dcf138f">
                    <option value="Tổ viên">Tổ viên</option>
                    <option value="Tổ trưởng">Tổ trưởng</option>
                </select>
            </td>
            <td class="bf-s-e3cb7ade2b">
                <input type="text" name="tochuyengia-congviec" placeholder="Nhập công việc..." disabled class="bf-s-ee9dcf138f">
            </td>
        </tr>
    `).join(""));
  const toThamDinhTbody = document.getElementById("to-thamdinh-tbody");
  toThamDinhTbody.innerHTML = trustedHTML(this.model.state.chuyengia.map((cg) => `
        <tr data-expert-id="${escapeHtml(cg.id)}">
            <td class="bf-s-0c5104285b">
                <input type="checkbox" name="tothamdinh-select" value="${escapeHtml(cg.id)}" class="bf-s-e3145ce1fc">
            </td>
            <td class="bf-s-fc40eefe32">${escapeHtml(cg.hoTen)} <small class="text-muted bf-s-bd877e16c3">Số CC: ${escapeHtml(cg.soChungChi)}</small></td>
            <td class="bf-s-e3cb7ade2b">
                <select name="tothamdinh-chucvu" disabled class="bf-s-ee9dcf138f">
                    <option value="Tổ viên">Tổ viên</option>
                    <option value="Tổ trưởng">Tổ trưởng</option>
                </select>
            </td>
            <td class="bf-s-e3cb7ade2b">
                <input type="text" name="tothamdinh-congviec" placeholder="Nhập công việc..." disabled class="bf-s-ee9dcf138f">
            </td>
        </tr>
    `).join(""));
  const setupCheckboxListeners = (tbodyId, selectName, roleName, jobName, otherTbodyId) => {
    const tbody = document.getElementById(tbodyId);
    const checkboxes = tbody.querySelectorAll(`input[name="${selectName}"]`);
    const hasAnotherSelectedExpert = (currentCheckbox) => Array.from(checkboxes).some((input) => input !== currentCheckbox && input.checked);
    checkboxes.forEach((cb) => {
      const row = cb.closest("tr");
      const roleSelect = row.querySelector(`select[name="${roleName}"]`);
      if (roleSelect) {
        roleSelect.addEventListener("change", () => {
          this.enforceSingleLeader(tbodyId, roleName, roleSelect);
          const jobInput = row.querySelector(`input[name="${jobName}"]`);
          if (jobInput) {
            if (tbodyId === "to-chuyengia-tbody") {
              jobInput.value = roleSelect.value === "Tổ trưởng" ? "Tổng hợp, lập HSMT, đánh giá HSDT" : "Lập HSMT, đánh giá HSDT";
            } else if (tbodyId === "to-thamdinh-tbody") {
              jobInput.value = roleSelect.value === "Tổ trưởng" ? "Tổng hợp, thẩm định HSMT, thẩm định KQLCNT" : "Thẩm định HSMT, thẩm định KQLCNT";
            }
          }
        });
      }
      cb.addEventListener("change", () => {
        const newChecked = cb.checked;
        const expertId = cb.value;
        const roleSelect2 = row.querySelector(`select[name="${roleName}"]`);
        const jobInput = row.querySelector(`input[name="${jobName}"]`);
        if (roleSelect2) {
          if (newChecked) {
            roleSelect2.disabled = false;
            if (!hasAnotherSelectedExpert(cb)) {
              const leaderOption = Array.from(roleSelect2.options).find((option) => option.value === "Tổ trưởng") || roleSelect2.options[1] || roleSelect2.options[0];
              if (leaderOption) {
                roleSelect2.value = leaderOption.value;
                roleSelect2.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          } else {
            roleSelect2.value = "Tổ viên";
            roleSelect2.disabled = true;
          }
        }
        if (jobInput) {
          jobInput.disabled = !newChecked;
          if (newChecked) {
            if (tbodyId === "to-chuyengia-tbody") {
              jobInput.value = roleSelect2.value === "Tổ trưởng" ? "Tổng hợp, lập HSMT, đánh giá HSDT" : "Lập HSMT, đánh giá HSDT";
            } else if (tbodyId === "to-thamdinh-tbody") {
              jobInput.value = roleSelect2.value === "Tổ trưởng" ? "Tổng hợp, thẩm định HSMT, thẩm định KQLCNT" : "Thẩm định HSMT, thẩm định KQLCNT";
            }
          } else {
            jobInput.value = "";
          }
        }
        const otherRow = document.querySelector(`#${otherTbodyId} tr[data-expert-id="${expertId}"]`);
        if (otherRow) {
          setRuntimeStyle(otherRow, "display", newChecked ? "none" : "");
        }
        this.enforceSingleLeader(tbodyId, roleName, roleSelect2);
      });
    });
  };
  setupCheckboxListeners("to-chuyengia-tbody", "tochuyengia-select", "tochuyengia-chucvu", "tochuyengia-congviec", "to-thamdinh-tbody");
  setupCheckboxListeners("to-thamdinh-tbody", "tothamdinh-select", "tothamdinh-chucvu", "tothamdinh-congviec", "to-chuyengia-tbody");
  if (id) {
    await loadAndPopulateEmpDropdown();
    assertEditWorkspaceCurrent();
    captureModalReturnState(this.model.state.activetab || "goithau", this.model.state.activeaction || null);
    this.switchTab("goithau", "chinhsua", true);
    document.getElementById("modal-goithau-title").textContent = isReadOnly ? "Chi tiết Gói thầu" : "Cập nhật Gói thầu";
    document.getElementById("form-goithau").setAttribute("data-original-status", gt.trangThai);
    document.getElementById("form-goithau-id").value = gt.id;
    const existingGtCode = this.model.getPackageBaseCode(gt.maGoiThau);
    document.getElementById("gt-ma").value = existingGtCode;
    const gtMaInput = document.getElementById("gt-ma");
    if (gtMaInput) {
      if (existingGtCode && existingGtCode.trim() !== "" && gt.trangThai !== "Chuẩn bị") {
        gtMaInput.setAttribute("readonly", "true");
      } else {
        gtMaInput.removeAttribute("readonly");
      }
    }
    const khSelect2 = document.getElementById("gt-kehoachid");
    const latestPlan = this.model.getLatestPlan(gt.keHoachId);
    khSelect2.value = latestPlan ? latestPlan.id : gt.keHoachId;
    khSelect2.dispatchEvent(new Event("change"));
    document.getElementById("gt-ten").value = gt.tenGoiThau;
    document.getElementById("gt-gia").value = this.model.formatVND(gt.giaGoiThau);
    document.getElementById("gt-thoigian").value = gt.thoiGianThucHien;
    document.getElementById("gt-hinhthuc").value = gt.hinhThucLuaChon;
    document.getElementById("gt-phuongthuc").value = gt.phuongThucLuaChon;
    document.getElementById("gt-trangthai").value = gt.trangThai;
    document.getElementById("gt-linhvuc").value = gt.linhVuc || "";
    const isThuocVal = gt.isThuoc === 1 || gt.isThuoc === "1" ? "1" : "0";
    const radioToCheck = document.querySelector(`input[name="gt-goithauthuoc"][value="${isThuocVal}"]`);
    if (radioToCheck) radioToCheck.checked = true;
    document.getElementById("gt-tuychonmuathem").value = gt.tuyChonMuaThem || "Không";
    document.getElementById("gt-nguonvon").value = gt.nguonVon || "Ngân sách nhà nước";
    document.getElementById("gt-loaihopdong").value = gt.loaiHopDong || "Trọn gói";
    document.getElementById("gt-thoigiantochuc").value = gt.thoiGianToChuc || "";
    document.getElementById("gt-thoigianbatdautochuc").value = gt.thoiGianBatDauToChuc || "";
    document.getElementById("gt-quatmang").value = gt.quaMang || "Qua mạng";
    document.getElementById("gt-trongnuocquocte").value = gt.trongNuocQuocTe || "Trong nước";
    document.getElementById("gt-phanlo").value = gt.phanLo || "Không";
    document.getElementById("gt-giatribaomothau").value = gt.giaTriDamBaoDuThau ? this.model.formatVND(gt.giaTriDamBaoDuThau) : "";
    document.getElementById("gt-hieuluchsdt").value = gt.hieuLucHsdt || "";
    document.getElementById("gt-hieuluchbaomothau").value = gt.hieuLucDamBaoDuThau || "";
    document.getElementById("gt-tylebaodamhopdong").value = gt.tyLeBaoDamHopDong !== void 0 && gt.tyLeBaoDamHopDong !== null ? gt.tyLeBaoDamHopDong : "";
    this.updatePackageFieldsVisibility(isReadOnly);
    const gtHinhThucEl = document.getElementById("gt-hinhthuc");
    if (gtHinhThucEl) {
      gtHinhThucEl.dispatchEvent(new Event("change"));
    }
    this._isEditMode = true;
    this._loadPhanLoRows(gt.phanLoList || []);
    this._loadTuyChonMuaThemRows(gt.tuyChonMuaThemList || []);
    this._loadGiaHanRows(gt.giaHanList || []);
    this._loadYeuCauLamRoRows(gt.yeuCauLamRoList || []);
    this._loadTraLoiLamRoRows(gt.traLoiLamRoList || []);
    if (gt.trangThai === "Đã có kết quả") {
      if (gt.phanLo !== "Có") {
        const ntSelectVal = document.getElementById("gt-nhathautrungthauid");
        ntSelectVal.value = gt.nhaThauTrungThauId || "";
        ntSelectVal.dispatchEvent(new Event("change"));
        document.getElementById("gt-giatrungthau").value = gt.giaTrungThau ? this.model.formatVND(gt.giaTrungThau) : "";
        document.getElementById("gt-thoigian-goithau").value = gt.thoiGianGoiThau || "";
        document.getElementById("gt-thoigian-hopdong").value = gt.thoiGianHopDong || "";
      }
    }
    let defaultAwardedList = parseLotListForDisplay(gt.awardedPhanLoList, { context: "package_form" });
    if ((!defaultAwardedList || defaultAwardedList.length === 0) && gt.phanLoList) {
      const plList = parseLotListForDisplay(gt.phanLoList, { context: "package_form" });
      defaultAwardedList = plList.map((pl) => ({
        tenPhanLo: pl.tenPhanLo,
        nhaThauTrungThauId: pl.nhaThauTrungThauId,
        giaTrungThau: pl.giaTrungThau,
        thoiGianGoiThau: pl.thoiGianGoiThau,
        thoiGianHopDong: pl.thoiGianHopDong
      }));
    }
    this.updateAwardedContractorUI(defaultAwardedList || []);
    document.getElementById("gt-soquyetdinh").value = gt.soQuyetDinh || "";
    document.getElementById("gt-ngayquyetdinh").value = gt.ngayQuyetDinh ? this.model.formatForDateInput(gt.ngayQuyetDinh) : "";
    document.getElementById("gt-thoigiandangtai").value = gt.thoiGianDangTai ? this.model.formatForDatetimeLocal(gt.thoiGianDangTai) : "";
    document.getElementById("gt-thoigiandongthau").value = gt.thoiGianDongThau ? this.model.formatForDatetimeLocal(gt.thoiGianDongThau) : "";
    document.getElementById("gt-thoigianmothau").value = gt.thoiGianMoThau ? this.model.formatForDatetimeLocal(gt.thoiGianMoThau) : "";
    const inputMoEhsdxtc = document.getElementById("gt-thoigianmoehsdxtc");
    if (inputMoEhsdxtc) {
      inputMoEhsdxtc.value = gt.thoiGianMoEhsdxtc ? this.model.formatForDatetimeLocal(gt.thoiGianMoEhsdxtc) : "";
    }
    const savedToChuyenGia = gt.toChuyenGia || [];
    savedToChuyenGia.forEach((item) => {
      const row = document.querySelector(`#to-chuyengia-tbody tr[data-expert-id="${item.chuyenGiaId}"]`);
      if (row) {
        const cb = row.querySelector('input[name="tochuyengia-select"]');
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change"));
        }
        const roleSelect = row.querySelector('select[name="tochuyengia-chucvu"]');
        const jobInput = row.querySelector('input[name="tochuyengia-congviec"]');
        if (roleSelect) roleSelect.value = item.chucVu || "Tổ viên";
        if (jobInput) jobInput.value = item.congViec || "";
      }
    });
    const savedToThamDinh = gt.toThamDinh || [];
    savedToThamDinh.forEach((item) => {
      const row = document.querySelector(`#to-thamdinh-tbody tr[data-expert-id="${item.chuyenGiaId}"]`);
      if (row) {
        const cb = row.querySelector('input[name="tothamdinh-select"]');
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change"));
        }
        const roleSelect = row.querySelector('select[name="tothamdinh-chucvu"]');
        const jobInput = row.querySelector('input[name="tothamdinh-congviec"]');
        if (roleSelect) roleSelect.value = item.chucVu || "Tổ viên";
        if (jobInput) jobInput.value = item.congViec || "";
      }
    });
    this.enforceSingleLeader("to-chuyengia-tbody", "tochuyengia-chucvu");
    this.enforceSingleLeader("to-thamdinh-tbody", "tothamdinh-chucvu");
    if (this.updatePhuongPhapDanhGiaOptions) {
      this.updatePhuongPhapDanhGiaOptions();
    }
    document.getElementById("gt-phuongphapdanhgia").value = evaluationMethodLabel(gt);
    if (this.updateTrongSoKyThuatVisibility) {
      this.updateTrongSoKyThuatVisibility();
    }
    document.getElementById("gt-trongsokythuat").value = gt.trongSoKyThuat !== void 0 && gt.trongSoKyThuat !== null ? gt.trongSoKyThuat : "";
  } else {
    captureModalReturnState(this.model.state.activetab || "goithau", this.model.state.activeaction || null);
    this.switchTab("goithau", "taomoi", true);
    document.getElementById("gt-ngayquyetdinh").value = "";
    document.getElementById("gt-thoigiandangtai").value = "";
    document.getElementById("gt-thoigiandongthau").value = "";
    document.getElementById("gt-thoigianmothau").value = "";
    document.getElementById("gt-thoigianmoehsdxtc").value = "";
    const inputMoEhsdxtc = document.getElementById("gt-thoigianmoehsdxtc");
    if (inputMoEhsdxtc) inputMoEhsdxtc.value = "";
    document.getElementById("modal-goithau-title").textContent = isReadOnly ? "Chi tiết Gói thầu" : "Thêm Gói thầu mới";
    form.reset();
    await loadAndPopulateEmpDropdown();
    assertEditWorkspaceCurrent();
    if (this.updatePhuongPhapDanhGiaOptions) {
      this.updatePhuongPhapDanhGiaOptions();
    }
    if (this.updateTrongSoKyThuatVisibility) {
      this.updateTrongSoKyThuatVisibility();
    }
    form.removeAttribute("data-original-status");
    form.removeAttribute("data-rebid-from");
    document.getElementById("form-goithau-id").value = "";
    document.getElementById("gt-linhvuc").value = "Hàng hóa";
    document.getElementById("gt-tuychonmuathem").value = "Không";
    document.getElementById("gt-nguonvon").value = "";
    document.getElementById("gt-loaihopdong").value = "Trọn gói";
    document.getElementById("gt-thoigiantochuc").value = "";
    document.getElementById("gt-thoigianbatdautochuc").value = "";
    document.getElementById("gt-quatmang").value = "Qua mạng";
    document.getElementById("gt-trongnuocquocte").value = "Trong nước";
    document.getElementById("gt-phanlo").value = "Không";
    document.getElementById("gt-giatribaomothau").value = "";
    document.getElementById("gt-hieuluchsdt").value = "";
    document.getElementById("gt-hieuluchbaomothau").value = "";
    document.getElementById("gt-tylebaodamhopdong").value = "";
    const statusSelectReset = document.getElementById("gt-trangthai");
    if (statusSelectReset) {
      statusSelectReset.querySelectorAll("option").forEach((opt) => {
        opt.disabled = false;
      });
      statusSelectReset.value = "Chuẩn bị";
    }
    this.updatePackageFieldsVisibility(isReadOnly);
    this._isEditMode = false;
    this._loadPhanLoRows([]);
    this._loadTuyChonMuaThemRows([]);
    this._loadGiaHanRows([]);
    this._loadYeuCauLamRoRows([]);
    this._loadTraLoiLamRoRows([]);
    document.getElementById("gt-nhathautrungthauid").value = "";
    document.getElementById("gt-giatrungthau").value = "";
    document.getElementById("gt-thoigian-goithau").value = "";
    document.getElementById("gt-thoigian-hopdong").value = "";
    this.updateAwardedContractorUI([]);
    const gtMaInput = document.getElementById("gt-ma");
    if (gtMaInput) {
      gtMaInput.removeAttribute("readonly");
    }
  }
  if (this.handleLinhVucChange) {
    this.handleLinhVucChange();
  } else if (this.handleHinhThucChange) {
    this.handleHinhThucChange();
  }
  if (this.handleQuaMangChange) {
    this.handleQuaMangChange();
  }
  if (this.handlePhanLoChange) {
    this.handlePhanLoChange();
  }
  if (this.handleTuyChonMuaThemChange) {
    this.handleTuyChonMuaThemChange();
  }
  const selectedPlanId = document.getElementById("gt-kehoachid").value;
  this.updateNguonVonFieldState(selectedPlanId);
  this.updatePackageFieldsVisibility(isReadOnly);
  const isOpenedOrLater = gt && ["Đã mở thầu", "Đang chấm thầu", "Đã có kết quả một phần", "Đã có kết quả"].includes(gt.trangThai);
  const preOpeningFields = [
    "gt-ma",
    "gt-kehoachid",
    "gt-ten",
    "gt-gia",
    "gt-thoigian",
    "gt-hinhthuc",
    "gt-phuongthuc",
    "gt-quatmang",
    "gt-trongnuocquocte",
    "gt-tuychonmuathem",
    "gt-phanlo",
    "gt-nguonvon",
    "gt-loaihopdong",
    "gt-thoigiantochuc",
    "gt-thoigianbatdautochuc",
    "gt-soquyetdinh",
    "gt-ngayquyetdinh",
    "gt-thoigiandangtai",
    "gt-thoigiandongthau",
    "gt-thoigianmothau",
    "gt-giatribaomothau",
    "gt-hieuluchsdt",
    "gt-hieuluchbaomothau"
  ];
  preOpeningFields.forEach((fieldId) => {
    const el = document.getElementById(fieldId);
    if (el) {
      el.disabled = !!isOpenedOrLater;
      const wrapper = el.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${fieldId}"]`);
      if (wrapper) {
        const searchInput = wrapper.querySelector(".custom-select-search");
        if (searchInput) {
          searchInput.disabled = !!isOpenedOrLater;
        }
      }
    }
  });
  ["gt-ngayquyetdinh", "gt-thoigiandangtai", "gt-thoigiandongthau", "gt-thoigianmothau"].forEach((id2) => {
    const el = document.getElementById(id2);
    if (el) {
      el.disabled = !!isOpenedOrLater;
    }
  });
  if (isOpenedOrLater) {
    document.querySelectorAll("#to-chuyengia-tbody input, #to-chuyengia-tbody select, #to-thamdinh-tbody input, #to-thamdinh-tbody select").forEach((el) => {
      el.disabled = true;
    });
  } else {
    document.querySelectorAll('#to-chuyengia-tbody input[type="checkbox"], #to-thamdinh-tbody input[type="checkbox"]').forEach((cb) => {
      cb.disabled = false;
    });
    document.querySelectorAll('#to-chuyengia-tbody select, #to-chuyengia-tbody input[type="text"], #to-thamdinh-tbody select, #to-thamdinh-tbody input[type="text"]').forEach((el) => {
      const row = el.closest("tr");
      const cb = row ? row.querySelector('input[type="checkbox"]') : null;
      el.disabled = !(cb && cb.checked);
    });
  }
  if (!isReadOnly && !isOpenedOrLater) {
    this.enforceSingleLeader("to-chuyengia-tbody", "tochuyengia-chucvu");
    this.enforceSingleLeader("to-thamdinh-tbody", "tothamdinh-chucvu");
  }
  document.querySelectorAll("#phanlo-tbody input, #phanlo-tbody select, #phanlo-tbody button, #tuychonmuathem-tbody input, #tuychonmuathem-tbody select, #tuychonmuathem-tbody button").forEach((el) => {
    el.disabled = !!isOpenedOrLater;
  });
  ["btn-them-phanlo", "btn-template-phanlo", "btn-import-excel-phanlo", "btn-them-tuychonmuathem", "btn-template-tuychonmuathem", "btn-import-excel-tuychonmuathem"].forEach((btnId) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = !!isOpenedOrLater;
    }
  });
  if (this.model.state.activerole === "employee") {
    const empSelect = document.getElementById("gt-nhanvienphutrach");
    if (empSelect) {
      empSelect.disabled = true;
      const wrapper = empSelect.parentNode.querySelector(`.custom-select-wrapper[data-select-id="gt-nhanvienphutrach"]`);
      if (wrapper) {
        const searchInput = wrapper.querySelector(".custom-select-search");
        if (searchInput) {
          searchInput.disabled = true;
        }
      }
    }
  }
  if (!isReadOnly && !isOpenedOrLater && this.handleHinhThucChange) {
    this.handleHinhThucChange();
  }
  // Legacy modal setup toggles several controls after applying lifecycle
  // policy. Re-apply the policy last so INVITED packages stay visible but
  // their source/base fields cannot be edited.
  this.updatePackageFieldsVisibility(isReadOnly);
  if (isReadOnly) {
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      el.disabled = true;
      const wrapper = el.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${el.id}"]`);
      if (wrapper) {
        const searchInput = wrapper.querySelector(".custom-select-search");
        if (searchInput) searchInput.disabled = true;
      }
    });
    form.querySelectorAll("button:not([data-close])").forEach((btn) => {
      btn.disabled = true;
    });
    const formSubmitBtn = form.querySelector('button[type="submit"]');
    if (formSubmitBtn) setRuntimeStyle(formSubmitBtn, "display", "none");
    document.querySelectorAll("#phanlo-tbody input, #phanlo-tbody select, #phanlo-tbody button, #tuychonmuathem-tbody input, #tuychonmuathem-tbody select, #tuychonmuathem-tbody button").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#to-chuyengia-tbody input, #to-chuyengia-tbody select, #to-thamdinh-tbody input, #to-thamdinh-tbody select").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#gt-giahan-tbody input, #gt-giahan-tbody select, #gt-giahan-tbody button").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#gt-yeucaulamro-tbody input, #gt-yeucaulamro-tbody select, #gt-yeucaulamro-tbody button").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#gt-traloilamro-tbody input, #gt-traloilamro-tbody select, #gt-traloilamro-tbody button").forEach((el) => {
      el.disabled = true;
    });
    document.querySelectorAll("#awarded-phanlo-tbody input, #awarded-phanlo-tbody select, #awarded-phanlo-tbody button").forEach((el) => {
      el.disabled = true;
    });
    const addButtons = [
      "btn-them-phanlo",
      "btn-template-phanlo",
      "btn-import-excel-phanlo",
      "btn-them-tuychonmuathem",
      "btn-template-tuychonmuathem",
      "btn-import-excel-tuychonmuathem",
      "btn-them-giahan",
      "btn-them-yeucaulamro",
      "btn-them-traloilamro"
    ];
    addButtons.forEach((btnId) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.disabled = true;
        setRuntimeStyle(btn, "display", "none");
      }
    });
    setPackageSubTableActionsVisible(false);
  }
  const procurementLookupCheckbox = document.getElementById(
    "procurement-lookup-package-enabled",
  );
  const procurementLookupControl = document.getElementById(
    "procurement-lookup-package-control",
  );
  const procurementLookupStatus = document.getElementById(
    "procurement-lookup-package-status",
  );
  const canLookupProcurement = procurementLookupEnabled && !isReadOnly;
  if (procurementLookupControl) {
    procurementLookupControl.hidden = !canLookupProcurement;
  }
  if (procurementLookupCheckbox) {
    procurementLookupCheckbox.checked = false;
    procurementLookupCheckbox.disabled = !canLookupProcurement;
  }
  if (procurementLookupStatus) {
    procurementLookupStatus.hidden = true;
    procurementLookupStatus.textContent = "";
    delete procurementLookupStatus.dataset.state;
    procurementLookupStatus.setAttribute("aria-live", "polite");
  }
  bindProcurementCodeAutoLookup({
    codeInput: document.getElementById("gt-ma"),
    checkbox: procurementLookupCheckbox,
    enabled: canLookupProcurement,
    runLookup: () => this.runProcurementInlineLookup?.({
      kind: "PACKAGE",
      formId: "form-goithau",
      codeInputId: "gt-ma",
      triggerId: "procurement-lookup-package-enabled",
      statusId: "procurement-lookup-package-status",
    }),
  });
  assertEditWorkspaceCurrent();
  form.dataset.submitState = "ready";
  setPackageEditorState(packageModal, "ready");
  this.view.openModal("modal-goithau");
}
// eslint-disable-next-line complexity -- Legacy package persistence orchestration is isolated for a dedicated refactor.
export async function handleGoiThauSubmit(e) {
  e.preventDefault();
  await waitForPackageInheritance(this);
  const form = document.getElementById("form-goithau");
  const assignedEmpSelect = document.getElementById("gt-nhanvienphutrach");
  const assignedEmpIds = resolvePackageAssigneeIds(selectedAssigneeIds(assignedEmpSelect));
  if (!this.view.validateForm(form)) return;
  const formVals = getGoiThauFormInputValues(this.model);
  if (formVals.giaGoiThau < 0) {
    await this.view.customAlert("Dữ liệu không hợp lệ", "Giá gói thầu không được nhỏ hơn 0.", "alert-triangle", document.getElementById("gt-giagoithau"));
    return;
  }
  const mainDongThauStr = formVals.thoiGianDongThau;
  const extensionInputRows = Array.from(document.querySelectorAll("#gt-giahan-tbody tr")).map((tr) => {
    const timeInput = tr.querySelector(".gh-time-input").value.trim();
    const reasonInput = tr.querySelector(".gh-reason-input").value.trim();
    return { timeStr: timeInput, reason: reasonInput };
  });
  const extensionValidation = validateExtensionRows(mainDongThauStr, extensionInputRows);
  if (!extensionValidation.valid) {
    const extensionRow = document.querySelectorAll("#gt-giahan-tbody tr")[extensionValidation.rowIndex];
    const extensionInput = extensionRow?.querySelector(extensionValidation.field === "reason" ? ".gh-reason-input" : ".gh-time-input");
    await this.view.customAlert("Dữ liệu không hợp lệ", extensionValidation.error, "alert-triangle", extensionInput);
    return;
  }
  const id = formVals.id;
  let finalGtId = id;
  let oldPlanId = null;
  if (id) {
    const oldGt = this.model.state.goithau.find((g) => g.id === id);
    if (oldGt) {
      oldPlanId = oldGt.keHoachId;
    }
  }
  const packageSaveBaseState = capturePackageSaveBaseState(this.model.state);
  let inputCode = document.getElementById("gt-ma").value.trim();
  if (inputCode) {
    let isDuplicate = false;
    if (id) {
      const oldGt = this.model.state.goithau.find((g) => g.id === id);
      const root = oldGt.rootId || oldGt.id;
      isDuplicate = this.model.state.goithau.some(
        (g) => g.maGoiThau.toLowerCase() === inputCode.toLowerCase() && (g.rootId || g.id) !== root
      );
    } else {
      isDuplicate = this.model.state.goithau.some((g) => g.maGoiThau.toLowerCase() === inputCode.toLowerCase());
    }
    if (isDuplicate) {
      const inputEl = document.getElementById("gt-ma");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Mã gói thầu đã tồn tại ở một gói thầu khác. Vui lòng nhập mã duy nhất!";
          inputEl.addEventListener("input", () => {
            formGroup.classList.remove("invalid");
            errText.textContent = originalErr;
          }, { once: true });
        }
      }
      this.view.focusInvalidControl(inputEl);
      return;
    }
  }
  const valueDate1 = document.getElementById("gt-thoigiandangtai").value;
  const valueDate2 = document.getElementById("gt-thoigiandongthau").value;
  const valueDate3 = document.getElementById("gt-thoigianmothau").value;
  const valueDate4 = document.getElementById("gt-ngayquyetdinh").value;
  const inputMoEhsdxtc = document.getElementById("gt-thoigianmoehsdxtc");
  const valueDate5 = inputMoEhsdxtc ? inputMoEhsdxtc.value : "";
  const formattedDate1 = valueDate1 ? this.model.convertDMYHMSToYMDHMS(valueDate1) : "";
  const formattedDate2 = valueDate2 ? this.model.convertDMYHMSToYMDHMS(valueDate2) : "";
  const formattedDate3 = valueDate3 ? this.model.convertDMYHMSToYMDHMS(valueDate3) : "";
  const formattedDate4 = valueDate4 ? this.model.convertDMYToYMD(valueDate4) : "";
  const formattedDate5 = valueDate5 ? this.model.convertDMYHMSToYMDHMS(valueDate5) : "";
  if (formattedDate1 && formattedDate2) {
    const dangTai = new Date(formattedDate1);
    const dongThau = new Date(formattedDate2);
    if (!isNaN(dangTai.getTime()) && !isNaN(dongThau.getTime()) && dongThau <= dangTai) {
      await this.view.customAlert("Dữ liệu không hợp lệ", "Thời gian đóng thầu phải sau thời gian đăng tải.", "alert-triangle", document.getElementById("gt-thoigiandongthau"));
      return;
    }
  }
  if (formattedDate2 && formattedDate3) {
    const dongThau = new Date(formattedDate2);
    const moThau = new Date(formattedDate3);
    if (!isNaN(dongThau.getTime()) && !isNaN(moThau.getTime()) && moThau < dongThau) {
      await this.view.customAlert("Dữ liệu không hợp lệ", "Thời gian mở thầu phải bằng hoặc sau thời gian đóng thầu.", "alert-triangle", document.getElementById("gt-thoigianmothau"));
      return;
    }
  }
  const toChuyenGia = [];
  document.querySelectorAll("#to-chuyengia-tbody tr").forEach((row) => {
    const cb = row.querySelector('input[name="tochuyengia-select"]');
    if (cb && cb.checked) {
      const roleSelect = row.querySelector('select[name="tochuyengia-chucvu"]');
      const jobInput = row.querySelector('input[name="tochuyengia-congviec"]');
      toChuyenGia.push({
        chuyenGiaId: cb.value,
        chucVu: roleSelect ? roleSelect.value : "Tổ viên",
        congViec: jobInput ? jobInput.value.trim() : ""
      });
    }
  });
  const toThamDinh = [];
  document.querySelectorAll("#to-thamdinh-tbody tr").forEach((row) => {
    const cb = row.querySelector('input[name="tothamdinh-select"]');
    if (cb && cb.checked) {
      const roleSelect = row.querySelector('select[name="tothamdinh-chucvu"]');
      const jobInput = row.querySelector('input[name="tothamdinh-congviec"]');
      toThamDinh.push({
        chuyenGiaId: cb.value,
        chucVu: roleSelect ? roleSelect.value : "Tổ viên",
        congViec: jobInput ? jobInput.value.trim() : ""
      });
    }
  });
  const toChuyenGiaSection = document.getElementById("to-chuyengia-section");
  const isChuyenGiaVisible = toChuyenGiaSection && getComputedStyle(toChuyenGiaSection).display !== "none";
  if (isChuyenGiaVisible) {
    const hasLeaderChuyenGia = toChuyenGia.some((cg) => cg.chucVu === "Tổ trưởng");
    if (!hasLeaderChuyenGia) {
      const target = document.querySelector('#to-chuyengia-tbody select[name="tochuyengia-chucvu"]') || toChuyenGiaSection;
      await this.view.customAlert("Lỗi kiểm tra", "Tổ chuyên gia chấm thầu bắt buộc phải có 1 Tổ trưởng!", "x-circle", target);
      return;
    }
  }
  const toThamDinhSection = document.getElementById("to-thamdinh-section");
  const isThamDinhVisible = toThamDinhSection && getComputedStyle(toThamDinhSection).display !== "none";
  if (isThamDinhVisible) {
    const hasLeaderThamDinh = toThamDinh.some((cg) => cg.chucVu === "Tổ trưởng");
    if (!hasLeaderThamDinh) {
      const target = document.querySelector('#to-thamdinh-tbody select[name="tothamdinh-chucvu"]') || toThamDinhSection;
      await this.view.customAlert("Lỗi kiểm tra", "Tổ thẩm định bắt buộc phải có 1 Tổ trưởng!", "x-circle", target);
      return;
    }
  }
  if (id) {
    const originalPackage = this.model.state.goithau.find((g) => g.id === id);
    if (originalPackage && originalPackage.trangThai && originalPackage.trangThai !== "Chuẩn bị") {
      const isTeamChanged = (newTeam, oldTeam) => {
        const oldT = oldTeam || [];
        if (newTeam.length !== oldT.length) return true;
        for (const item of newTeam) {
          const match = oldT.find((x) => x.chuyenGiaId === item.chuyenGiaId);
          if (!match) return true;
          if (match.chucVu !== item.chucVu || match.congViec !== item.congViec) return true;
        }
        return false;
      };
      if (isTeamChanged(toChuyenGia, originalPackage.toChuyenGia) || isTeamChanged(toThamDinh, originalPackage.toThamDinh)) {
        const confirmed = await this.view.customConfirm(
          "Xác nhận thay đổi",
          "Bạn có chắc chắn muốn thay đổi trạng thái tham gia của chuyên gia này trong tổ không?",
          "help-circle"
        );
        if (!confirmed) {
          return;
        }
      }
    }
  }
  const targetStatus = document.getElementById("gt-trangthai").value;
  const linhVuc = document.getElementById("gt-linhvuc").value;
  const isPhanLo = document.getElementById("gt-phanlo").value === "Có";
  if (targetStatus !== "Chuẩn bị") {
    const hieuLucHsdtVal = parseInt(document.getElementById("gt-hieuluchsdt")?.value) || 0;
    if (hieuLucHsdtVal <= 0) {
      const inputEl = document.getElementById("gt-hieuluchsdt");
      const formGroup = inputEl ? inputEl.closest(".form-group") : null;
      if (formGroup) formGroup.classList.add("invalid");
      await this.view.customAlert("Thiếu thông tin", "Gói thầu bắt buộc phải có Thời gian hiệu lực hồ sơ dự thầu lớn hơn 0 khi ở trạng thái Đang mời thầu hoặc muộn hơn!", "alert-triangle", inputEl);
      return;
    }
    if (linhVuc !== "Tư vấn" && !isPhanLo) {
      const giaTriDbVal = this.model.parseVND(document.getElementById("gt-giatribaomothau")?.value || "0");
      if (giaTriDbVal <= 0) {
        const inputEl = document.getElementById("gt-giatribaomothau");
        const formGroup = inputEl ? inputEl.closest(".form-group") : null;
        if (formGroup) formGroup.classList.add("invalid");
        await this.view.customAlert("Thiếu thông tin", "Gói thầu bắt buộc phải có Giá trị bảo đảm dự thầu lớn hơn 0 khi ở trạng thái Đang mời thầu hoặc muộn hơn (trừ gói tư vấn)!", "alert-triangle", inputEl);
        return;
      }
    }
  }
  const collectedPhanLoList = this._collectPhanLoRows();
  const collectedTuyChonList = this._collectTuyChonMuaThemRows();
  const packagePriceToSave = derivePackagePrice({
    phanLo: formVals.phanLo,
    giaGoiThau: formVals.giaGoiThau,
    phanLoList: collectedPhanLoList
  });
  if (isPhanLo) {
    const codes = collectedPhanLoList.map((item) => item.maPhanLo ? item.maPhanLo.trim().toLowerCase() : "");
    const duplicateCodes = codes.filter((code, idx) => code !== "" && codes.indexOf(code) !== idx);
    if (duplicateCodes.length > 0) {
      let duplicateInput = null;
      const duplicateCodeValue = duplicateCodes[0];
      document.querySelectorAll("#phanlo-tbody tr").forEach((tr) => {
        const inp = tr.querySelector(".pl-code-input");
        if (inp && inp.value.trim().toLowerCase() === duplicateCodeValue) {
          duplicateInput = inp;
        }
      });
      if (duplicateInput) {
        setRuntimeStyle(duplicateInput, "borderColor", "var(--danger)");
        const clearError = () => {
          setRuntimeStyle(duplicateInput, "borderColor", "");
          duplicateInput.removeEventListener("input", clearError);
          duplicateInput.removeEventListener("change", clearError);
        };
        duplicateInput.addEventListener("input", clearError);
        duplicateInput.addEventListener("change", clearError);
      }
      await this.view.customAlert(
        "Mã phần lô trùng lặp",
        `Mã phần lô "${duplicateCodes[0].toUpperCase()}" bị trùng lặp. Vui lòng nhập các mã phần lô khác nhau!`,
        "alert-triangle",
        duplicateInput
      );
      return;
    }
    if (targetStatus !== "Chuẩn bị") {
      let emptyInput = null;
      let invalidBaoDamInput = null;
      document.querySelectorAll("#phanlo-tbody tr").forEach((tr) => {
        const inp = tr.querySelector(".pl-code-input");
        if (inp && !inp.value.trim() && !emptyInput) {
          emptyInput = inp;
        }
        const bdInp = tr.querySelector(".pl-baodam-input");
        if (bdInp && linhVuc !== "Tư vấn") {
          const bdVal = this.model.parseVND(bdInp.value) || 0;
          if (BigInt(bdVal) <= 0n && !invalidBaoDamInput) {
            invalidBaoDamInput = bdInp;
          }
        }
      });
      if (emptyInput) {
        this.view.customAlert("Thiếu dữ liệu", "Vui lòng nhập đầy đủ tên phần lô!", "alert-triangle", emptyInput);
        return;
      }
      if (invalidBaoDamInput) {
        this.view.customAlert("Thiếu dữ liệu", "Vui lòng nhập đầy đủ giá trị bảo đảm dự thầu lớn hơn 0 cho tất cả các phần lô!", "alert-triangle", invalidBaoDamInput);
        return;
      }
    }
  }
  const phuongPhapDanhGia = formVals.phuongPhapDanhGia;
  const trongSoKyThuat = isCombinedEvaluationMethod(phuongPhapDanhGia)
    ? formVals.trongSoKyThuat
    : null;
  const phuongThucLuaChon = formVals.phuongThucLuaChon;
  if (this.validateTrongSoKyThuat) {
    if (!this.validateTrongSoKyThuat(true)) {
      const inputEl = document.getElementById("gt-trongsokythuat");
      await this.view.customAlert("Lỗi kiểm tra", "Giá trị trọng số kỹ thuật không hợp lệ, vui lòng kiểm tra lại thông tin lỗi bên dưới trường nhập liệu!", "x-circle", inputEl);
      return;
    }
    if (isCombinedEvaluationMethod(phuongPhapDanhGia) && linhVuc !== "Tư vấn" && (phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ" || phuongThucLuaChon === "Hai giai đoạn hai túi hồ sơ")) {
      if (trongSoKyThuat > 30 && trongSoKyThuat <= 50) {
        await this.view.customAlert("Cảnh báo", "Cảnh báo: Trọng số kỹ thuật lớn hơn 30% (mức khuyến nghị thông thường là 10% - 30%).", "alert-triangle");
      }
    }
  }
  const selectedPlanId = formVals.keHoachId;
  const latestPlan = this.model.getLatestPlan(selectedPlanId);
  const planIdToSave = latestPlan ? latestPlan.id : selectedPlanId;
  // A plan-version draft is the durable boundary for the whole aggregate.
  // The child package modal can be opened after the breakdown controller has
  // moved to another version (or after its transient breakdown marker was
  // rebased), so relying on that marker alone would route this save through
  // /api/sync and commit the MSC revision prematurely. Keep package changes
  // memory-only whenever either draft marker identifies the target plan.
  const draftPackageSave = isPackageDraftSaveActive(this, planIdToSave);
  const updateAssignments = async (targetId) => {
    if (draftPackageSave) {
      applyDraftAssignmentSelection(this.model, {
        targetId,
        type: "goithau",
        selectedIds: assignedEmpIds,
      });
      return;
    }
    await applyAssignmentDelta(this.model, {
      targetId,
      type: "goithau",
      selectedIds: assignedEmpIds,
    });
  };
  const gtData = {
    keHoachId: planIdToSave,
    tenGoiThau: formVals.tenGoiThau,
    giaGoiThau: packagePriceToSave,
    thoiGianThucHien: formVals.thoiGianThucHien,
    hinhThucLuaChon: formVals.hinhThucLuaChon,
    phuongThucLuaChon,
    phuongPhapDanhGia,
    trongSoKyThuat,
    trangThai: formVals.trangThai,
    linhVuc,
    isThuoc: linhVuc === "Hàng hóa" ? formVals.isThuoc : 0,
    tuyChonMuaThem: formVals.tuyChonMuaThem,
    nguonVon: formVals.nguonVon,
    loaiHopDong: formVals.loaiHopDong,
    thoiGianToChuc: formVals.thoiGianToChuc,
    thoiGianBatDauToChuc: formVals.thoiGianBatDauToChuc,
    quaMang: formVals.quaMang,
    trongNuocQuocTe: formVals.trongNuocQuocTe,
    phanLo: formVals.phanLo,
    phanLoList: collectedPhanLoList,
    tuyChonMuaThemList: collectedTuyChonList,
    giaHanList: this._collectGiaHanRows(),
    yeuCauLamRoList: this._collectYeuCauLamRoRows(),
    traLoiLamRoList: this._collectTraLoiLamRoRows(),
    soQuyetDinh: formVals.soQuyetDinh,
    ngayQuyetDinh: formattedDate4,
    thoiGianDangTai: formattedDate1,
    thoiGianDongThau: formattedDate2,
    thoiGianMoThau: formattedDate3,
    thoiGianMoEhsdxtc: formattedDate5,
    toChuyenGia,
    toThamDinh: isCompetitiveQuotationPackage({ hinhThucLuaChon: formVals.hinhThucLuaChon }) ? [] : toThamDinh,
    giaTriDamBaoDuThau: linhVuc === "Tư vấn" ? 0 : isPhanLo ? this.model.sumVND(collectedPhanLoList.map((item) => item.baoDamDuThau || 0)) : this.model.parseVND(formVals.giaTriDamBaoDuThau || "0"),
    hieuLucHsdt: formVals.hieuLucHsdt,
    hieuLucDamBaoDuThau: formVals.hieuLucDamBaoDuThau,
    tyLeBaoDamHopDong: formVals.tyLeBaoDamHopDong
  };
  const procurementPackageDraft = this.procurementPackageImport?.sourcePackageDraft;
  if (procurementPackageDraft?.sourceRevision) {
    gtData.sourceRevision = procurementPackageDraft.sourceRevision;
    gtData._procurementImportCurrent = true;
  }
  clearCompetitiveQuotationAppraisal(gtData);
  if (gtData.trangThai === "Đã có kết quả") {
    if (!isPhanLo) {
      gtData.nhaThauTrungThauId = formVals.nhaThauTrungThauId;
      gtData.giaTrungThau = formVals.giaTrungThau;
      gtData.thoiGianGoiThau = formVals.thoiGianGoiThau;
      gtData.thoiGianHopDong = formVals.thoiGianHopDong;
      gtData.awardedPhanLoList = [];
    } else {
      gtData.awardedPhanLoList = this._collectAwardedPhanLoRows();
      gtData.nhaThauTrungThauId = "";
      gtData.giaTrungThau = null;
    }
  } else {
    gtData.nhaThauTrungThauId = "";
    gtData.giaTrungThau = null;
    gtData.thoiGianGoiThau = "";
    gtData.thoiGianHopDong = "";
    gtData.awardedPhanLoList = [];
  }
  if (id) {
    const oldGt = this.model.state.goithau.find((g) => g.id === id);
    const sourceAuthoritativeImport = Boolean(
      procurementPackageDraft?.sourceRevision?.provider === "MUASAMCONG",
    );
    const saveAsNewVersion = shouldCreatePackageVersion(
      oldGt, gtData, procurementPackageDraft?.sourceRevision,
    );
    if (saveAsNewVersion) {
      const requestedChanges = { maGoiThau: inputCode, ...gtData };
      const officialVersion = draftPackageSave || sourceAuthoritativeImport
        ? { authoritative: false, fallbackRequired: true }
        : await createOfficialPackageVersionFromForm(
          this,
          oldGt,
          requestedChanges,
        );
      if (officialVersion?.authoritative) {
        finalGtId = officialVersion.packageRecord.id;
      } else {
        const newGtId = generateRecordId("goithau");
        finalGtId = newGtId;
        const timestamp = this.model.getCurrentDateTimeString();
        const newPackageSnapshot = snapshotPackageAggregate(this.model.state, oldGt, {
          targetPackageId: newGtId,
          targetPlanId: gtData.keHoachId,
          packageVersion: sourceAuthoritativeImport
            ? String(procurementPackageDraft.sourceRevision.revisionNumber)
            : getNextVersion(this.model.state.goithau, oldGt),
          timestamp,
          overrides: requestedChanges,
        });
        const newPackageVersion = newPackageSnapshot.packageRecord;
        const packageRootId = String(oldGt.rootId || oldGt.id);
        this.model.state.goithau.forEach((candidate) => {
          if (
            String(candidate.rootId || candidate.id) === packageRootId
            && String(candidate.keHoachId) === String(gtData.keHoachId)
          ) {
            candidate.isLatest = 0;
            candidate._procurementImportCurrent = false;
          }
        });
        ensureVersionEhsmtAdjustment(newPackageVersion);
        clearCompetitiveQuotationAppraisal(newPackageVersion);
        this.model.state.goithau.push(newPackageVersion);
        ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau", "assignments"].forEach((key) => {
          this.model.state[key] ||= [];
          this.model.state[key].push(...newPackageSnapshot[key]);
        });
        rememberSelectedVersion(this.model.state, "selectedPackageVersion", newPackageVersion);
      }
      await updateAssignments(finalGtId);
    } else {
      oldGt.maGoiThau = inputCode;
      Object.assign(oldGt, gtData);
      clearCompetitiveQuotationAppraisal(oldGt);
      oldGt.updatedAt = this.model.getCurrentDateTimeString();
      await updateAssignments(id);
    }
  } else {
    const newGtId = generateRecordId("goithau");
    finalGtId = newGtId;
    const formEl = document.getElementById("form-goithau");
    const rebidFrom = formEl ? formEl.getAttribute("data-rebid-from") : null;
    const timestamp = this.model.getCurrentDateTimeString();
    const newPackage = createInitialVersion({
      maGoiThau: inputCode,
      isRebid: !!rebidFrom,
      rebidFromPackageId: rebidFrom || null,
      ...gtData
    }, { id: newGtId, timestamp });
    if (Number.isInteger(Number(procurementPackageDraft?.sourceRevision?.revisionNumber))) {
      newPackage.phienBan = String(procurementPackageDraft.sourceRevision.revisionNumber);
    }
    assignNewPackageLotIds(newPackage);
    if (procurementPackageDraft?.danhSachHangHoa) {
      materializeProcurementPackageGoods(
        this.model.state,
        newPackage,
        procurementPackageDraft,
        { lots: newPackage.phanLoList },
      );
    }
    if (rebidFrom) {
      const sourcePackage = this.model.state.goithau.find((item) => String(item.id) === String(rebidFrom));
      if (sourcePackage) {
        this.model.state.goithauhanghoa.push(...clonePackageGoodsForSnapshot(
          this.model.state.goithauhanghoa,
          sourcePackage,
          newPackage,
        ));
      }
    }
    clearCompetitiveQuotationAppraisal(newPackage);
    this.model.state.goithau.push(newPackage);
    await updateAssignments(newGtId);
  }
  if (oldPlanId) {
    this.recalculatePlanTotal(oldPlanId);
  }
  if (gtData.keHoachId && gtData.keHoachId !== oldPlanId) {
    this.recalculatePlanTotal(gtData.keHoachId);
  }
  const breakdownPlanId = document.getElementById("breakdown-plan-id")?.value;
  const modalBreakdown = document.getElementById("modal-plan-breakdown");
  if (modalBreakdown && modalBreakdown.classList.contains("active") && breakdownPlanId) {
    this.renderBreakdownPackagesList(breakdownPlanId);
    this.updateBreakdownTotal(breakdownPlanId);
  }
  if (hasModalReturnState("goithau-detail") && finalGtId) {
    updateModalReturnAction(finalGtId);
  }
  const finalPackage = this.model.state.goithau.find((item) => String(item.id) === String(finalGtId));
  const explicitUpserts = {
    goithau: this.procurementPackageImport?.controller
      ? this.model.state.goithau.filter(
        (item) => String(item.id) === String(finalGtId),
      )
      : packageFamilyUpsertsForPlan(this.model.state.goithau, finalPackage),
    goithauhanghoa: this.model.state.goithauhanghoa.filter(
      (item) => String(item.goiThauId) === String(finalGtId),
    ),
    thongtinmothau: this.model.state.thongtinmothau.filter(
      (item) => String(item.goiThauId) === String(finalGtId),
    ),
    hanghoaduthaunhathau: this.model.state.hanghoaduthaunhathau.filter(
      (item) => String(item.goiThauId) === String(finalGtId),
    ),
    assignments: this.model.state.assignments.filter(
      (item) => String(item.targetId) === String(finalGtId) && item.type === "goithau",
    ),
  };
  const affectedPlanIds = new Set([oldPlanId, gtData.keHoachId].filter(Boolean).map(String));
  explicitUpserts.kehoach = this.model.state.kehoach.filter(
    (item) => affectedPlanIds.has(String(item.id)),
  );
  const syncResult = await persistPackageFormChanges(this, explicitUpserts, {
    draft: draftPackageSave,
    baseUpserts: packageSaveBaseUpserts(packageSaveBaseState, explicitUpserts),
    afterPersist: () => {
      renderPackageSaveTables(this.view);
    },
  });
  if (packageSyncRequiresReload(syncResult)) {
    const packageModal = document.getElementById("modal-goithau");
    restorePackageEditorAfterSyncConflict(form, packageModal);
    if (
      syncResult?.conflictQuarantined !== true
      && syncResult?.reloadRequired !== true
    ) {
      showPackageSyncReloadToast(this.view);
    }
    return;
  }
  if (shouldShowPackageSyncFailureDialog(syncResult)) {
    await this.view.customAlert(
      "Lỗi đồng bộ",
      "Dữ liệu đã được lưu tạm trên máy nhưng chưa ghi được vào cơ sở dữ liệu. Vui lòng kiểm tra lỗi đồng bộ và thử lưu lại.",
      "alert-triangle"
    );
    return;
  }
  const packageModal = document.getElementById("modal-goithau");
  setPackageEditorState(packageModal, "closing");
  await this.closeModal("modal-goithau", {
    restoreRoute: false,
    preserveProcurementImport: true,
  });
  setPackageEditorState(packageModal, "closed");
  if (this.procurementPackageImport?.controller) {
    await this.completeProcurementPackageImportRevision?.(finalGtId);
    return;
  }
  if (this.packageWizard.active) {
    if (this.packageWizard.currentCount < this.packageWizard.totalCount) {
      this.packageWizard.currentCount++;
      setTimeout(() => {
        this.openPackageWizardStep();
      }, 300);
    } else {
      this.packageWizard.active = false;
      this.packageWizard.planId = null;
      this.packageWizard.totalCount = 0;
      this.packageWizard.currentCount = 0;
      await this.view.customAlert("Thành công", "Đã thêm toàn bộ các gói thầu theo kế hoạch thành công!", "check-circle");
    }
  } else if (draftPackageSave) {
    await this.view.customAlert(
      "Đã thêm vào bản nháp",
      "Gói thầu chỉ được lưu tạm. Dữ liệu sẽ được ghi chính thức khi bạn bấm Lưu & hoàn tất.",
      "check-circle",
    );
  } else {
    await this.view.customAlert("Thành công", "Đã lưu thông tin gói thầu thành công!", "check-circle");
  }
}
export { checkAndInheritCanceledPackage, restoreCanceledPackage } from "./packageRebidWorkflow.js";

export { unifyTableInputsHeight } from "./packageFormState.js";
import { generateRecordId } from "../shared/idUtils.js";
