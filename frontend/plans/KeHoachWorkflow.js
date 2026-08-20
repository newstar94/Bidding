import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { captureModalReturnState, hasModalReturnState, updateModalReturnAction } from "../app/modalReturnState.js";
import { bindCurrencyElement } from "../app/domUtils.js";
import {
  canDeleteVersions,
  createNextVersion,
  rememberSelectedVersion,
  removeAllVersions,
  removeLatestVersion
} from "../shared/VersionedEntityService.js";
import {
  mutatePersistAndSync,
  persistAndSync,
  refreshRecordBeforeDelete,
} from "../shared/MutationService.js";
import { restoreRecordSnapshot } from "../shared/recordSnapshot.js";
import { getHolidays } from "../shared/runtimeState.js";
import { generateRecordId } from "../shared/idUtils.js";
import { escapeHtml } from "../shared/view_helpers.js";
import {
  hasServerCapability,
  PROCUREMENT_LOOKUP_CAPABILITY,
} from "../auth/serverCapabilities.js";
import { loadPaginatedRecords } from "../shared/tableDataUtils.js";
import { resolvePackageResultStatus } from "../packages/lotEvaluationScope.js";
import { applyPlanAggregateSnapshot, snapshotPlanAggregate } from "./planAggregateSnapshot.js";
import { createOfficialAggregateVersion } from "../shared/AggregateVersionClient.js";
import {
  captureWorkspaceLease,
  isWorkspaceLeaseCurrent,
} from "../app/workspaceLease.js";
import {
  capturePlanBreakdownDraft,
  boundProcurementRevisionChanges,
  collectPlanBreakdownDraftChanges,
  isPlanBreakdownDraftActive,
  rebasePlanBreakdownDraftAfterServerMerge,
} from "./planBreakdownDraft.js";
import { bindProcurementCodeAutoLookup } from "../procurement/ProcurementAutoLookup.js";
import {
  createPlanVersionDraftSession,
  finalizePlanVersionDraft,
  findPlanVersionDraftSession,
  refreshPlanVersionDraftSession,
  savePlanVersionDraftSession,
} from "./PlanVersionDraftSession.js";

const INTERMEDIATE_DRAFT_STATE_KEYS = Object.freeze([
  "kehoach",
  "goithau",
  "goithauhanghoa",
  "thongtinmothau",
  "hanghoaduthaunhathau",
  "assignments",
  "selectedPlanVersion",
  "selectedPackageVersion",
  "selectedPackageVersionIntent",
]);

function cloneDraftValue(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function stalePlanFinalizeResult() {
  return {
    ok: false,
    stale: true,
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
  };
}

function captureIntermediateDraftCheckpoint(controller) {
  const state = controller.model.state;
  return {
    state: Object.fromEntries(INTERMEDIATE_DRAFT_STATE_KEYS.map((key) => [
      key,
      {
        present: Object.prototype.hasOwnProperty.call(state, key),
        value: cloneDraftValue(state[key]),
      },
    ])),
    sessions: cloneDraftValue(controller.model.planVersionDraftSessions || []),
    tempPlanData: cloneDraftValue(controller.tempPlanData),
    tempPlanAction: controller.tempPlanAction,
    planBreakdownDraft: controller.planBreakdownDraft,
    breakdownPlanId: controller.planBreakdownDraft?.planId,
    backupKeHoachState: cloneDraftValue(controller.backupKeHoachState),
    backupGoiThauState: cloneDraftValue(controller.backupGoiThauState),
  };
}

async function restoreIntermediateDraftCheckpoint(controller, checkpoint) {
  for (const [key, captured] of Object.entries(checkpoint.state)) {
    if (!captured.present) delete controller.model.state[key];
    else controller.model.state[key] = cloneDraftValue(captured.value);
    controller.model.entityIndexes?.invalidate?.(key);
  }
  controller.model.planVersionDraftSessions = cloneDraftValue(checkpoint.sessions);
  controller.tempPlanData = cloneDraftValue(checkpoint.tempPlanData);
  controller.tempPlanAction = checkpoint.tempPlanAction;
  controller.planBreakdownDraft = checkpoint.planBreakdownDraft;
  if (checkpoint.planBreakdownDraft) {
    checkpoint.planBreakdownDraft.planId = checkpoint.breakdownPlanId;
  }
  controller.backupKeHoachState = cloneDraftValue(checkpoint.backupKeHoachState);
  controller.backupGoiThauState = cloneDraftValue(checkpoint.backupGoiThauState);
  const renderResults = await Promise.allSettled([
    Promise.resolve(controller.view?.renderKeHoachTable?.()),
    Promise.resolve(controller.view?.renderGoiThauTable?.()),
  ]);
  renderResults.filter((result) => result.status === "rejected").forEach((result) => {
    console.warn("Failed to render restored intermediate plan draft state:", result.reason);
  });
}

/**
 * Load every package attached to the given plan versions so reference guards
 * decide against server truth instead of whatever happens to be cached locally.
 */
async function loadPackagesForPlans(controller, planIds) {
  const model = controller.model;
  if (!model?.useServerSidePagination) return;
  const targets = [...new Set((planIds || []).filter(Boolean).map(String))];
  await Promise.all(targets.map(async (planId) => {
    let cursor = "";
    do {
      const page = await loadPaginatedRecords(model, "goithau", {
        pageSize: 200,
        pagination: "cursor",
        sortBy: "id",
        sortOrder: "asc",
        keHoachId: planId,
        ...(cursor ? { cursor } : {}),
      }).catch((error) => {
        console.error(`Failed to load packages of plan ${planId} before deletion:`, error);
        return null;
      });
      const nextCursor = String(page?.nextCursor || "");
      if (!page?.hasMore || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    } while (cursor);
  }));
}

export async function deleteKeHoach(id) {
  const targetPlan = await refreshRecordBeforeDelete(this, "kehoach", id);
  if (!targetPlan) return;
  const rootId = targetPlan.rootId || targetPlan.id;
  const relatedPlans = this.model.state.kehoach.filter((kh) => (kh.rootId || kh.id) === rootId);
  if (relatedPlans.length >= 2) {
    const choice = await this.view.customVersionDeleteChoice(
      "Xác nhận xóa",
      `Kế hoạch "${targetPlan.tenKeHoach}" có ${relatedPlans.length} phiên bản. Vui lòng chọn cách thức xóa:`,
      "Xóa phiên bản gần nhất",
      "Xóa toàn bộ"
    );
    if (choice === null) return;
    if (choice === 1) {
      const preview = removeLatestVersion(this.model.state.kehoach, targetPlan);
      const latestKh = preview.removed[0];
      if (!latestKh) return;
      // Each plan version owns a frozen snapshot of its packages. Those rows may
      // not be in local state (server-side pagination loads them on demand), so
      // the reference guard has to read the plan's packages from the server;
      // otherwise the plan version is deleted and its packages stay behind,
      // making the previous version's packages reappear.
      await loadPackagesForPlans(this, preview.removed.map((plan) => plan.id));
      const deletionCheck = canDeleteVersions(latestKh, [{
        name: "goithau", records: this.model.state.goithau, foreignKey: "keHoachId"
      }]);
      if (!deletionCheck.allowed) {
        await this.view.customAlert(
          "Không thể xóa",
          "Không thể xóa phiên bản gần nhất này vì có các Gói thầu đang liên kết trực tiếp với phiên bản này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.",
          "x-circle"
        );
        return;
      }
      this.model.replaceTableState("kehoach", preview.records);
      this.model.markDeleted("kehoach", preview.removed);
      await persistAndSync(this, "kehoach", {
        changes: { deletions: { kehoach: preview.removed } },
        afterPersist: () => this.view.renderKeHoachTable()
      });
      return;
    } else if (choice === 2) {
      await loadPackagesForPlans(this, relatedPlans.map((plan) => plan.id));
      const deletionCheck = canDeleteVersions(relatedPlans, [{
        name: "goithau", records: this.model.state.goithau, foreignKey: "keHoachId"
      }]);
      if (!deletionCheck.allowed) {
        await this.view.customAlert(
          "Không thể xóa",
          "Không thể xóa kế hoạch này vì có các Gói thầu đang liên kết trực tiếp với các phiên bản của kế hoạch này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.",
          "x-circle"
        );
        return;
      }
      const result = removeAllVersions(this.model.state.kehoach, targetPlan);
      this.model.replaceTableState("kehoach", result.records);
      this.model.markDeleted("kehoach", result.removed);
      await persistAndSync(this, "kehoach", {
        changes: { deletions: { kehoach: result.removed } },
        afterPersist: () => this.view.renderKeHoachTable()
      });
      return;
    }
  } else {
    await loadPackagesForPlans(this, relatedPlans.map((plan) => plan.id));
    const deletionCheck = canDeleteVersions(relatedPlans, [{
      name: "goithau", records: this.model.state.goithau, foreignKey: "keHoachId"
    }]);
    if (!deletionCheck.allowed) {
      await this.view.customAlert(
        "Không thể xóa",
        "Không thể xóa kế hoạch này vì có các Gói thầu đang liên kết trực tiếp với kế hoạch này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.",
        "x-circle"
      );
      return;
    }
    const confirmed = await this.view.customConfirm(
      "Xác nhận xóa",
      `Bạn có chắc chắn muốn xóa kế hoạch "${targetPlan.tenKeHoach}"? Dữ liệu sẽ mất vĩnh viễn.`,
      "trash-2"
    );
    if (confirmed) {
      this.model.replaceTableState(
        "kehoach",
        this.model.state.kehoach.filter((kh) => kh.id !== id),
      );
      this.model.markDeleted("kehoach", targetPlan);
      await persistAndSync(this, "kehoach", {
        changes: { deletions: { kehoach: [targetPlan] } },
        afterPersist: () => this.view.renderKeHoachTable()
      });
    }
  }
}
export async function handlePlanInvestorChange(event) {
  if (event.target.value !== "__NEW_INVESTOR__") return;
  event.target.value = "";
  return this.partners.editInvestor(null);
}
export async function editKeHoach(id, {
  keepProcurementCodeEditable = false,
  preserveProcurementLookupSelection = false,
} = {}) {
  if (!document.getElementById("modal-kehoach")) {
    await this.ensureLazyModal?.("modal-kehoach");
  }
  const form = document.getElementById("form-kehoach");
  const existingProcurementLookupCheckbox = document.getElementById(
    "procurement-lookup-plan-enabled",
  );
  const procurementLookupState = {
    checked: Boolean(existingProcurementLookupCheckbox?.checked),
    disabled: Boolean(existingProcurementLookupCheckbox?.disabled),
  };
  const procurementLookupEnabled = hasServerCapability(
    PROCUREMENT_LOOKUP_CAPABILITY,
  );
  form.querySelectorAll(".form-group").forEach((fg) => fg.classList.remove("invalid"));
  const cdtSelect = document.getElementById("kh-chudautuid");
  const latestCDTs = this.model.getLatestChuDauTu() || [];
  cdtSelect.innerHTML = trustedHTML('<option value="">-- Chọn Chủ đầu tư --</option>' + latestCDTs.map((c) => `<option value="${escapeHtml(c.id)}" data-investor-code="${escapeHtml(c.maChuDauTu || "")}" data-search="${escapeHtml(`${c.maChuDauTu || ""} ${c.tenChuDauTu || ""}`)}">${escapeHtml(c.tenChuDauTu)}</option>`).join("") + '<option value="__NEW_INVESTOR__" class="bf-s-5762556293">+ Thêm chủ đầu tư mới</option>');
  // The plan modal is lazy-loaded, so this select does not exist when the
  // application's one-time conditional handlers are registered.
  cdtSelect.onchange = handlePlanInvestorChange.bind(this);
  this.makeSearchableSelect(cdtSelect, "Tìm kiếm Chủ đầu tư...");
  const setSectionAvailability = (section, visible) => {
    if (!section) return;
    setRuntimeStyle(section, "display", visible ? "block" : "none");
    section.querySelectorAll("input, select, textarea").forEach((control) => {
      control.disabled = !visible;
    });
  };
  const setFieldAvailability = (containerId, inputId, visible, required = false) => {
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    if (container) setRuntimeStyle(container, "display", visible ? "flex" : "none");
    if (!input) return;
    input.disabled = !visible;
    input.required = visible && required;
  };
  const loaiHinhSelect = document.getElementById("kh-loaihinh");
  const projectFields = document.getElementById("kh-project-fields");
  const projectIdentityFields = document.getElementById("kh-project-identity-fields");
  const projectCodeGroup = document.getElementById("kh-project-code-group");
  const projectNameLabel = document.getElementById("lbl-kh-duan");
  const projectNameInput = document.getElementById("kh-duan");
  const totalInvestmentLabel = document.getElementById("lbl-kh-tongmuc");
  const totalInvestmentInput = document.getElementById("kh-tongmuc");
  const toggleProjectFields = () => {
    const isProject = loaiHinhSelect.value === "Dự án";
    const isBudget = loaiHinhSelect.value === "Dự toán mua sắm";
    setSectionAvailability(projectFields, isProject);
    if (projectCodeGroup) setRuntimeStyle(projectCodeGroup, "display", isProject ? "flex" : "none");
    document.getElementById("kh-maduan").disabled = !isProject;
    document.getElementById("kh-maduan").required = isProject;
    projectIdentityFields?.classList.toggle("is-budget", !isProject);
    if (projectNameLabel) {
      projectNameLabel.firstChild.textContent = isProject
        ? "Tên dự án "
        : loaiHinhSelect.value === "Dự toán mua sắm"
          ? "Tên dự toán "
          : "Tên dự án/dự toán ";
    }
    if (projectNameInput) {
      projectNameInput.placeholder = isProject
        ? "Ví dụ: Dự án Tăng cường Năng lực CNTT ngành Y tế"
        : "Ví dụ: Dự toán mua sắm thiết bị CNTT";
    }
    const totalFieldName = isProject
      ? "Tổng mức đầu tư"
      : isBudget
        ? "Tổng dự toán"
        : "Tổng dự toán/Tổng mức đầu tư";
    if (totalInvestmentLabel) totalInvestmentLabel.textContent = totalFieldName;
    if (totalInvestmentInput && !totalInvestmentInput.value.trim()) {
      totalInvestmentInput.placeholder = `Nhập ${totalFieldName.toLowerCase()}`;
    }
  };
  loaiHinhSelect.onchange = toggleProjectFields;
  const pheDuyetSelect = document.getElementById("kh-pheduyet");
  const approvalRecords = document.getElementById("kh-approval-records");
  const pheDuyetFields = document.getElementById("kh-pheduyet-kehoach-fields");
  const commonPheDuyetFields = document.getElementById("kh-pheduyet-common-fields");
  const setRequiredLabel = (label, text) => {
    if (!label) return;
    label.textContent = `${text} `;
    const marker = document.createElement("span");
    marker.className = "required";
    marker.textContent = "*";
    label.append(marker);
  };
  const setOptionalLabel = (label, text) => {
    if (!label) return;
    label.textContent = text;
  };
  const togglePheDuyetFields = () => {
    const label = document.getElementById("lbl-ngaytrinhkehoach");
    const labelPheDuyet = document.getElementById("lbl-ngaypheduyet");
    const labelQuyetDinh = document.getElementById("lbl-quyetdinh");
    const findLabel = (selector) => document.querySelector?.(selector) || null;
    const labelSoTrinhDuToan = findLabel('label[for="kh-sototrinhdutoan"]');
    const labelNgayTrinhDuToan = findLabel('label[for="kh-ngaytrinhdutoan"]');
    const labelSoTrinhKeHoach = findLabel('label[for="kh-sototrinhkehoach"]');
    const labelSoTrinhDuToanKeHoach = findLabel('label[for="kh-sototrinhdutoankehoach"]');
    setRuntimeStyle(approvalRecords, "display", pheDuyetSelect.value ? "grid" : "none");
    if (pheDuyetSelect.value === "Kế hoạch") {
      setSectionAvailability(pheDuyetFields, true);
      setSectionAvailability(commonPheDuyetFields, true);
      setFieldAvailability("kh-ngaytrinhkehoach-container", "kh-ngaytrinhkehoach", true);
      setFieldAvailability("kh-sototrinhkehoach-container", "kh-sototrinhkehoach", true);
      setFieldAvailability("kh-sototrinhdutoankehoach-container", "kh-sototrinhdutoankehoach", false);
      setOptionalLabel(label, "Ngày trình kế hoạch");
      setOptionalLabel(labelSoTrinhDuToan, "Số tờ trình dự toán");
      setOptionalLabel(labelNgayTrinhDuToan, "Ngày trình dự toán");
      setOptionalLabel(labelSoTrinhKeHoach, "Số tờ trình kế hoạch");
      setOptionalLabel(labelSoTrinhDuToanKeHoach, "Số tờ trình dự toán và kế hoạch");
      setRequiredLabel(labelPheDuyet, "Ngày phê duyệt kế hoạch");
      setRequiredLabel(labelQuyetDinh, "Số QĐ phê duyệt kế hoạch");
    } else if (pheDuyetSelect.value === "Dự toán và kế hoạch") {
      setSectionAvailability(pheDuyetFields, false);
      setSectionAvailability(commonPheDuyetFields, true);
      setFieldAvailability("kh-ngaytrinhkehoach-container", "kh-ngaytrinhkehoach", true);
      setFieldAvailability("kh-sototrinhkehoach-container", "kh-sototrinhkehoach", false);
      setFieldAvailability("kh-sototrinhdutoankehoach-container", "kh-sototrinhdutoankehoach", true);
      setOptionalLabel(label, "Ngày trình dự toán và kế hoạch");
      setOptionalLabel(labelSoTrinhDuToanKeHoach, "Số tờ trình dự toán và kế hoạch");
      setRequiredLabel(labelPheDuyet, "Ngày phê duyệt dự toán và kế hoạch");
      setRequiredLabel(labelQuyetDinh, "Số QĐ phê duyệt dự toán và kế hoạch");
    } else {
      setSectionAvailability(pheDuyetFields, false);
      setSectionAvailability(commonPheDuyetFields, false);
      setFieldAvailability("kh-ngaytrinhkehoach-container", "kh-ngaytrinhkehoach", false);
      setFieldAvailability("kh-sototrinhkehoach-container", "kh-sototrinhkehoach", false);
      setFieldAvailability("kh-sototrinhdutoankehoach-container", "kh-sototrinhdutoankehoach", false);
      setRequiredLabel(labelPheDuyet, "Ngày phê duyệt");
      setRequiredLabel(labelQuyetDinh, "Số QĐ phê duyệt");
    }
  };
  pheDuyetSelect.onchange = togglePheDuyetFields;
  if (id) {
    captureModalReturnState(this.model.state.activetab || "kehoach", this.model.state.activeaction || null);
    this.switchTab("kehoach", "chinhsua", true);
    document.getElementById("modal-kehoach-title").textContent = "Cập nhật Kế hoạch LCNT";
    const kh = this.model.state.kehoach.find((k) => String(k.id) === String(id));
    const existingCode = this.model.getPlanBaseCode(kh.maKeHoach);
    document.getElementById("form-kehoach-id").value = kh.id;
    document.getElementById("kh-ma").value = existingCode;
    const khMaInput = document.getElementById("kh-ma");
    if (khMaInput) {
      if (keepProcurementCodeEditable) {
        khMaInput.disabled = false;
        khMaInput.removeAttribute("readonly");
      } else if (existingCode && existingCode.trim() !== "" && kh.thoiGianDangMa) {
        khMaInput.setAttribute("readonly", "true");
      } else {
        khMaInput.removeAttribute("readonly");
      }
    }
    document.getElementById("kh-ten").value = kh.tenKeHoach;
    document.getElementById("kh-loaihinh").value = kh.loaiHinhMuaSam || "";
    document.getElementById("kh-duan").value = kh.tenDuAnDuToan || "";
    document.getElementById("kh-chudautuid").value = kh.chuDauTuId;
    document.getElementById("kh-donvitrinhcdt").value = kh.donViTrinhCdt || "";
    document.getElementById("kh-tenviettatdonvitrinh").value = kh.tenVietTatDonViTrinh || "";
    const tmInput = document.getElementById("kh-tongmuc");
    tmInput.value = kh.tongMucDauTu ? this.model.formatVND(kh.tongMucDauTu) : "";
    tmInput.placeholder = kh.isTongMucTuDong === true || kh.isTongMucTuDong === 1 || !kh.tongMucDauTu ? "Tổng Dự toán/Tổng mức đầu tư" : "Nhập số tiền";
    tmInput.setAttribute("data-initial-val", tmInput.value);
    tmInput.setAttribute("data-was-auto", kh.isTongMucTuDong === true || kh.isTongMucTuDong === 1 || !kh.tongMucDauTu ? "true" : "false");
    tmInput.disabled = false;
    document.getElementById("kh-pheduyet").value = kh.pheDuyet || "";
    togglePheDuyetFields();
    document.getElementById("kh-ngaytrinhkehoach").value = this.model.formatForDateInput(kh.ngayTrinhKeHoach);
    document.getElementById("kh-sototrinhkehoach").value = kh.soToTrinhKeHoach || "";
    document.getElementById("kh-sototrinhdutoankehoach").value = kh.soToTrinhDuToanKeHoach || "";
    document.getElementById("kh-ngaytrinhdutoan").value = this.model.formatForDateInput(kh.ngayTrinhDuToan);
    document.getElementById("kh-sototrinhdutoan").value = kh.soToTrinhDuToan || "";
    document.getElementById("kh-ngaypheduyetdutoan").value = this.model.formatForDateInput(kh.ngayPheDuyetDuToan);
    document.getElementById("kh-quyetdinhpheduyetdutoan").value = kh.soQdPheDuyetDuToan || "";
    document.getElementById("kh-maduan").value = kh.maDuan || "";
    document.getElementById("kh-nguonvon").value = kh.nguonVon || "";
    document.getElementById("kh-thoigian-duan").value = kh.thoiGianDuAn || "";
    document.getElementById("kh-soqdpheduyetduan").value = kh.soQdPheDuyetDuAn || "";
    document.getElementById("kh-ngayqdpheduyetduan").value = this.model.formatForDateInput(kh.ngayQdPheDuyetDuAn);
    document.getElementById("kh-coquanpheduyetduan").value = kh.coQuanPheDuyetDuAn || "";
    document.getElementById("kh-diadiem-quymo").value = kh.diaDiemQuyMo || "";
    document.getElementById("kh-thongtinkhac").value = kh.thongTinKhac || "";
    toggleProjectFields();
    document.getElementById("kh-ngaypheduyet").value = this.model.formatForDateInput(kh.ngayPheDuyet);
    document.getElementById("kh-quyetdinh").value = kh.quyetDinhPheDuyet;
    document.getElementById("kh-thoigiandang").value = kh.thoiGianDangMa ? this.model.formatForDatetimeLocal(kh.thoiGianDangMa) : "";
  } else {
    captureModalReturnState(this.model.state.activetab || "kehoach", this.model.state.activeaction || null);
    this.switchTab("kehoach", "taomoi", true);
    document.getElementById("modal-kehoach-title").textContent = "Thêm Kế hoạch LCNT mới";
    form.reset();
    document.getElementById("form-kehoach-id").value = "";
    const tmInput = document.getElementById("kh-tongmuc");
    tmInput.value = "";
    tmInput.placeholder = "Tổng Dự toán/Tổng mức đầu tư";
    tmInput.removeAttribute("data-initial-val");
    tmInput.removeAttribute("data-was-auto");
    tmInput.disabled = false;
    document.getElementById("kh-pheduyet").value = "Dự toán và kế hoạch";
    togglePheDuyetFields();
    document.getElementById("kh-ngaytrinhkehoach").value = "";
    document.getElementById("kh-sototrinhkehoach").value = "";
    document.getElementById("kh-sototrinhdutoankehoach").value = "";
    document.getElementById("kh-ngaytrinhdutoan").value = "";
    document.getElementById("kh-sototrinhdutoan").value = "";
    document.getElementById("kh-ngaypheduyetdutoan").value = "";
    document.getElementById("kh-quyetdinhpheduyetdutoan").value = "";
    document.getElementById("kh-donvitrinhcdt").value = "";
    document.getElementById("kh-tenviettatdonvitrinh").value = "";
    document.getElementById("kh-maduan").value = "";
    document.getElementById("kh-nguonvon").value = "";
    document.getElementById("kh-thoigian-duan").value = "";
    document.getElementById("kh-soqdpheduyetduan").value = "";
    document.getElementById("kh-ngayqdpheduyetduan").value = "";
    document.getElementById("kh-coquanpheduyetduan").value = "";
    document.getElementById("kh-diadiem-quymo").value = "";
    document.getElementById("kh-thongtinkhac").value = "";
    toggleProjectFields();
    document.getElementById("kh-ngaypheduyet").value = "";
    document.getElementById("kh-thoigiandang").value = "";
    const khMaInput = document.getElementById("kh-ma");
    if (khMaInput) {
      khMaInput.removeAttribute("readonly");
    }
  }
  const procurementLookupCheckbox = document.getElementById(
    "procurement-lookup-plan-enabled",
  );
  const procurementLookupControl = document.getElementById(
    "procurement-lookup-plan-control",
  );
  const procurementLookupStatus = document.getElementById(
    "procurement-lookup-plan-status",
  );
  if (procurementLookupControl) {
    procurementLookupControl.hidden = !procurementLookupEnabled;
  }
  if (procurementLookupCheckbox) {
    procurementLookupCheckbox.checked = preserveProcurementLookupSelection
      ? procurementLookupState.checked
      : false;
    procurementLookupCheckbox.disabled = preserveProcurementLookupSelection
      ? procurementLookupState.disabled || !procurementLookupEnabled
      : !procurementLookupEnabled;
  }
  if (procurementLookupStatus) {
    procurementLookupStatus.hidden = true;
    procurementLookupStatus.textContent = "";
    delete procurementLookupStatus.dataset.state;
    procurementLookupStatus.setAttribute("aria-live", "polite");
  }
  bindProcurementCodeAutoLookup({
    codeInput: document.getElementById("kh-ma"),
    checkbox: procurementLookupCheckbox,
    enabled: procurementLookupEnabled,
    runLookup: () => this.runProcurementInlineLookup?.({
      kind: "PLAN",
      formId: "form-kehoach",
      codeInputId: "kh-ma",
      triggerId: "procurement-lookup-plan-enabled",
      statusId: "procurement-lookup-plan-status",
    }),
  });
  lucide.createIcons();
  this.view.openModal("modal-kehoach");
  const addWorkingDays = (startDateStr, days) => {
    if (!startDateStr) return "";
    const parts = startDateStr.split("/");
    if (parts.length !== 3) return "";
    let date = new Date(parts[2], parts[1] - 1, parts[0]);
    if (isNaN(date.getTime())) return "";
    const holidaysData = getHolidays();
    let direction = days < 0 ? -1 : 1;
    let remainingDays = Math.abs(days);
    while (remainingDays > 0) {
      date.setDate(date.getDate() + direction);
      let dayOfWeek = date.getDay();
      let dateStr = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
      let yearStr = String(date.getFullYear());
      let isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const yearWorkingWeekends = holidaysData[yearStr]?.working_weekends || [];
      if (isWeekend && yearWorkingWeekends.includes(dateStr)) {
        isWeekend = false;
      }
      const yearHolidays = holidaysData[yearStr]?.holidays || [];
      const isHoliday = yearHolidays.includes(dateStr);
      if (!isWeekend && !isHoliday) {
        remainingDays--;
      }
    }
    return String(date.getDate()).padStart(2, "0") + "/" + String(date.getMonth() + 1).padStart(2, "0") + "/" + date.getFullYear();
  };
  const trinhDuToanInp = document.getElementById("kh-ngaytrinhdutoan");
  const pheDuyetDuToanInp = document.getElementById("kh-ngaypheduyetdutoan");
  const trinhKeHoachInp = document.getElementById("kh-ngaytrinhkehoach");
  const pheDuyetKeHoachInp = document.getElementById("kh-ngaypheduyet");
  const pheDuyetSel = document.getElementById("kh-pheduyet");
  const updateFlatpickrValue = (inputEl, val) => {
    if (!inputEl) return;
    inputEl.value = val;
    if (inputEl._flatpickr) {
      inputEl._flatpickr.setDate(val, false);
    }
    inputEl.dispatchEvent(new Event("change"));
  };
  if (trinhDuToanInp && !trinhDuToanInp.dataset.hasDateListeners) {
    trinhDuToanInp.dataset.hasDateListeners = "true";
    trinhDuToanInp.addEventListener("change", () => {
      if (pheDuyetSel.value === "Kế hoạch") {
        const nextDate = addWorkingDays(trinhDuToanInp.value, 1);
        updateFlatpickrValue(pheDuyetDuToanInp, nextDate);
      }
    });
  }
  if (pheDuyetDuToanInp && !pheDuyetDuToanInp.dataset.hasDateListeners) {
    pheDuyetDuToanInp.dataset.hasDateListeners = "true";
    pheDuyetDuToanInp.addEventListener("change", () => {
      if (pheDuyetSel.value === "Kế hoạch") {
        updateFlatpickrValue(trinhKeHoachInp, pheDuyetDuToanInp.value);
      }
    });
  }
  if (trinhKeHoachInp && !trinhKeHoachInp.dataset.hasDateListeners) {
    trinhKeHoachInp.dataset.hasDateListeners = "true";
    trinhKeHoachInp.addEventListener("change", () => {
      const nextDate = addWorkingDays(trinhKeHoachInp.value, 1);
      updateFlatpickrValue(pheDuyetKeHoachInp, nextDate);
    });
  }
}
export async function handleKeHoachSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-kehoach");
  if (!this.view.validateForm(form)) return;
  const id = document.getElementById("form-kehoach-id").value;
  let targetPlanId = id;
  let inputCode = document.getElementById("kh-ma").value.trim();
  if (inputCode) {
    let isDuplicate = false;
    if (id) {
      const oldKh = this.model.state.kehoach.find((k) => k.id === id);
      const root = oldKh.rootId || oldKh.id;
      isDuplicate = this.model.state.kehoach.some(
        (k) => k.maKeHoach.toLowerCase() === inputCode.toLowerCase() && (k.rootId || k.id) !== root
      );
    } else {
      isDuplicate = this.model.state.kehoach.some((k) => k.maKeHoach.toLowerCase() === inputCode.toLowerCase());
    }
    if (isDuplicate) {
      const inputEl = document.getElementById("kh-ma");
      const formGroup = inputEl.closest(".form-group");
      if (formGroup) {
        formGroup.classList.add("invalid");
        const errText = formGroup.querySelector(".error-text");
        if (errText) {
          const originalErr = errText.textContent;
          errText.textContent = "Mã kế hoạch đã tồn tại ở một kế hoạch khác. Vui lòng nhập mã duy nhất!";
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
  const publishTimeVal = document.getElementById("kh-thoigiandang").value;
  const finalPublishTime = publishTimeVal ? this.model.convertDMYHMSToYMDHMS(publishTimeVal) : null;
  const ngayPheDuyetRaw = document.getElementById("kh-ngaypheduyet").value;
  const ngayPheDuyetYMD = this.model.convertDMYToYMD(ngayPheDuyetRaw);
  const pheDuyet = document.getElementById("kh-pheduyet").value;
  const ngayTrinhKeHoachRaw = document.getElementById("kh-ngaytrinhkehoach").value;
  const ngayTrinhKeHoachYMD = this.model.convertDMYToYMD(ngayTrinhKeHoachRaw);
  const soToTrinhKeHoach = document.getElementById("kh-sototrinhkehoach").value.trim();
  const soToTrinhDuToanKeHoach = document.getElementById("kh-sototrinhdutoankehoach").value.trim();
  const ngayTrinhDuToanRaw = document.getElementById("kh-ngaytrinhdutoan").value;
  const ngayTrinhDuToanYMD = this.model.convertDMYToYMD(ngayTrinhDuToanRaw);
  const soToTrinhDuToan = document.getElementById("kh-sototrinhdutoan").value.trim();
  const ngayPheDuyetDuToanRaw = document.getElementById("kh-ngaypheduyetdutoan").value;
  const ngayPheDuyetDuToanYMD = this.model.convertDMYToYMD(ngayPheDuyetDuToanRaw);
  const soQdPheDuyetDuToan = document.getElementById("kh-quyetdinhpheduyetdutoan").value.trim();
  const donViTrinhCdt = document.getElementById("kh-donvitrinhcdt").value.trim();
  const tenVietTatDonViTrinh = document.getElementById("kh-tenviettatdonvitrinh").value.trim();
  const maDuan = document.getElementById("kh-maduan").value.trim();
  const nguonVon = document.getElementById("kh-nguonvon").value.trim();
  const thoiGianDuAn = document.getElementById("kh-thoigian-duan").value.trim();
  const soQdPheDuyetDuAn = document.getElementById("kh-soqdpheduyetduan").value.trim();
  const ngayQdPheDuyetDuAnRaw = document.getElementById("kh-ngayqdpheduyetduan").value;
  const ngayQdPheDuyetDuAnYMD = this.model.convertDMYToYMD(ngayQdPheDuyetDuAnRaw);
  const coQuanPheDuyetDuAn = document.getElementById("kh-coquanpheduyetduan").value.trim();
  const diaDiemQuyMo = document.getElementById("kh-diadiem-quymo").value.trim();
  const thongTinKhac = document.getElementById("kh-thongtinkhac").value.trim();
  const tmInput = document.getElementById("kh-tongmuc");
  const currentVal = tmInput.value.trim();
  const initialVal = tmInput.getAttribute("data-initial-val") || "";
  const wasAuto = tmInput.getAttribute("data-was-auto") === "true";
  let isTongMucTuDong = false;
  if (!currentVal) {
    isTongMucTuDong = true;
  } else if (wasAuto && currentVal === initialVal) {
    isTongMucTuDong = true;
  }
  const parsedTongMuc = isTongMucTuDong ? 0 : this.model.parseVND(currentVal);
  if (parsedTongMuc < 0) {
    const totalFieldName = document.getElementById("kh-loaihinh").value === "Dự án"
      ? "Tổng mức đầu tư"
      : "Tổng dự toán";
    await this.view.customAlert("Dữ liệu không hợp lệ", `${totalFieldName} không được nhỏ hơn 0.`, "alert-triangle", tmInput);
    return;
  }
  const initialDraftCheckpoint = captureIntermediateDraftCheckpoint(this);
  const resumingPlanDraft = isPlanBreakdownDraftActive(this, id);
  const durableVersionDraft = findPlanVersionDraftSession(this.model, id);
  if (!resumingPlanDraft) {
    this.backupKeHoachState = JSON.parse(JSON.stringify(this.model.state.kehoach));
    this.backupGoiThauState = JSON.parse(JSON.stringify(this.model.state.goithau));
    this.planBreakdownDraft = capturePlanBreakdownDraft(this.model.state, {
      planId: id,
      action: durableVersionDraft ? "create" : (id ? "edit" : "create"),
    });
  }
  const loaiHinhVal = document.getElementById("kh-loaihinh").value;
  this.tempPlanData = {
    maKeHoach: inputCode,
    tenKeHoach: document.getElementById("kh-ten").value.trim(),
    loaiHinhMuaSam: loaiHinhVal,
    tenDuAnDuToan: document.getElementById("kh-duan").value.trim(),
    chuDauTuId: document.getElementById("kh-chudautuid").value,
    donViTrinhCdt,
    tenVietTatDonViTrinh,
    tongMucDauTu: isTongMucTuDong ? 0 : this.model.parseVND(currentVal),
    isTongMucTuDong,
    ngayPheDuyet: ngayPheDuyetYMD,
    quyetDinhPheDuyet: document.getElementById("kh-quyetdinh").value.trim(),
    thoiGianDangMa: finalPublishTime,
    nguonVon,
    thoiGianDuAn,
    maDuan: loaiHinhVal === "Dự án" ? maDuan : "",
    soQdPheDuyetDuAn: loaiHinhVal === "Dự án" ? soQdPheDuyetDuAn : "",
    ngayQdPheDuyetDuAn: loaiHinhVal === "Dự án" ? ngayQdPheDuyetDuAnYMD : "",
    coQuanPheDuyetDuAn: loaiHinhVal === "Dự án" ? coQuanPheDuyetDuAn : "",
    diaDiemQuyMo,
    thongTinKhac,
    pheDuyet,
    ngayTrinhKeHoach: ngayTrinhKeHoachYMD,
    soToTrinhKeHoach: pheDuyet === "Kế hoạch" ? soToTrinhKeHoach : "",
    soToTrinhDuToanKeHoach: pheDuyet === "Dự toán và kế hoạch" ? soToTrinhDuToanKeHoach : "",
    ngayTrinhDuToan: pheDuyet === "Kế hoạch" ? ngayTrinhDuToanYMD : "",
    soToTrinhDuToan: pheDuyet === "Kế hoạch" ? soToTrinhDuToan : "",
    ngayPheDuyetDuToan: pheDuyet === "Kế hoạch" ? ngayPheDuyetDuToanYMD : "",
    soQdPheDuyetDuToan: pheDuyet === "Kế hoạch" ? soQdPheDuyetDuToan : ""
  };
  if (id) {
    this.tempPlanAction = this.planBreakdownDraft?.action === "create" ? "create" : "edit";
    this.tempPlanData.id = id;
    const oldKh = this.model.state.kehoach.find((k) => k.id === id);
    if (oldKh) {
      Object.assign(oldKh, this.tempPlanData);
      oldKh.updatedAt = this.model.getCurrentDateTimeString();
    }
  } else {
    this.tempPlanAction = "create";
    const planId = generateRecordId("kehoach");
    targetPlanId = planId;
    this.tempPlanData.id = planId;
    this.planBreakdownDraft.planId = planId;
    this.model.state.kehoach.push({
      id: planId,
      phienBan: "00",
      isLatest: 1,
      rootId: planId,
      createdAt: this.model.getCurrentDateTimeString(),
      updatedAt: this.model.getCurrentDateTimeString(),
      ...this.tempPlanData
    });
    const versionDraft = createPlanVersionDraftSession(this.model.state, planId);
    try {
      await savePlanVersionDraftSession(this.model, versionDraft);
    } catch (error) {
      await restoreIntermediateDraftCheckpoint(this, initialDraftCheckpoint);
      throw error;
    }
  }
  if (isTongMucTuDong) {
    this.recalculatePlanTotal(targetPlanId);
  }
  this.view.closeModal("modal-kehoach");
  await this.openPlanBreakdownModal(targetPlanId);
}
export async function openPlanBreakdownModal(planId) {
  if (!document.getElementById("modal-plan-breakdown")) {
    this.ensureLazyModal?.("modal-plan-breakdown").then(() => this.openPlanBreakdownModal(planId));
    return;
  }
  const kh = this.model.state.kehoach.find((k) => k.id === planId);
  if (!kh) return;
  document.getElementById("breakdown-plan-id").value = planId;
  document.getElementById("breakdown-modal-subtitle").innerHTML = trustedHTML(`
        <strong>Kế hoạch:</strong> ${escapeHtml(kh.tenKeHoach)} <span class="badge badge-info bf-s-9d5367afed">${escapeHtml(this.model.getVersionLabel(kh.phienBan))}</span><br>
        <span class="bf-s-d922053a79"><strong>Mã:</strong> ${escapeHtml(this.model.getPlanBaseCode(kh.maKeHoach) || "(Chưa có)")} | <span id="breakdown-total-display"></span></span>
    `);
  const tbody1 = document.getElementById("tbody-breakdown-dathuchien");
  tbody1.innerHTML = trustedHTML("");
  const list1 = kh.cvDaThucHienList || [];
  if (list1.length === 0) {
    this.addBreakdownRow("dathuchien");
  } else {
    list1.forEach((item) => this.addBreakdownRow("dathuchien", item));
  }
  const tbody2 = document.getElementById("tbody-breakdown-khongapdung");
  tbody2.innerHTML = trustedHTML("");
  const list2 = kh.cvKhongApDungList || [];
  if (list2.length === 0) {
    this.addBreakdownRow("khongapdung");
  } else {
    list2.forEach((item) => this.addBreakdownRow("khongapdung", item));
  }
  const tbody3 = document.getElementById("tbody-breakdown-chuadudieuKien");
  tbody3.innerHTML = trustedHTML("");
  const list3 = kh.cvChuaDuDieuKienList || [];
  if (list3.length === 0) {
    this.addBreakdownRow("chuadudieuKien");
  } else {
    list3.forEach((item) => this.addBreakdownRow("chuadudieuKien", item));
  }
  this.renderBreakdownPackagesList(planId);
  const btnAddPkg = document.getElementById("btn-breakdown-add-package");
  if (btnAddPkg) {
    btnAddPkg.onclick = async () => {
      await this.packages.edit(null);
      const planSelect = document.getElementById("gt-kehoachid");
      if (planSelect) {
        planSelect.value = planId;
        planSelect.setAttribute("readonly", "true");
        setRuntimeStyle(planSelect, "pointerEvents", "none");
        setRuntimeStyle(planSelect, "background", "var(--neutral-soft)");
        planSelect.dispatchEvent(new Event("change"));
      }
    };
  }
  const btnSave = document.getElementById("btn-save-plan-breakdown");
  const versionDraft = findPlanVersionDraftSession(this.model, planId);
  const hasActiveProcurementSequence = Boolean(
    versionDraft && this.procurementPlanImport?.controller,
  );
  const hasNextProcurementRevision = Boolean(
    hasActiveProcurementSequence
    && this.procurementPlanImport.controller.hasNext(),
  );
  const canFinalize = !hasNextProcurementRevision;
  btnSave.hidden = !canFinalize;
  btnSave.disabled = !canFinalize;
  btnSave.onclick = canFinalize
    ? async () => {
      if (btnSave.disabled) return;
      btnSave.disabled = true;
      btnSave.setAttribute("aria-busy", "true");
      try {
        await this.savePlanBreakdown();
      } finally {
        btnSave.disabled = false;
        btnSave.removeAttribute("aria-busy");
      }
    }
    : null;
  const btnIntermediate = document.getElementById("btn-save-plan-version-draft");
  if (btnIntermediate) {
    const canSaveIntermediate = Boolean(
      versionDraft
      && (!hasActiveProcurementSequence || hasNextProcurementRevision),
    );
    btnIntermediate.hidden = !canSaveIntermediate;
    btnIntermediate.disabled = false;
    btnIntermediate.onclick = canSaveIntermediate
      ? async () => {
        if (btnIntermediate.disabled) return;
        btnIntermediate.disabled = true;
        btnIntermediate.setAttribute("aria-busy", "true");
        try {
          await this.saveIntermediatePlanVersion();
        } finally {
          btnIntermediate.disabled = false;
          btnIntermediate.removeAttribute("aria-busy");
        }
      }
      : null;
  }
  btnSave.textContent = versionDraft ? "Lưu & hoàn tất" : "Lưu kế hoạch";
  const btnBack = document.getElementById("btn-back-plan-breakdown");
  if (btnBack) btnBack.onclick = () => this.backToPlanDraft();
  const tabBtns = document.querySelectorAll(".breakdown-tab-btn");
  const panes = document.querySelectorAll(".breakdown-pane");
  tabBtns.forEach((btn) => {
    btn.onclick = () => {
      tabBtns.forEach((b) => {
        b.classList.remove("active");
        setRuntimeStyle(b, "borderBottomColor", "transparent");
        setRuntimeStyle(b, "color", "var(--text-muted)");
      });
      panes.forEach((p) => setRuntimeStyle(p, "display", "none"));
      btn.classList.add("active");
      setRuntimeStyle(btn, "borderBottomColor", "var(--primary)");
      setRuntimeStyle(btn, "color", "var(--primary)");
      const targetTab = btn.getAttribute("data-breakdown-tab");
      setRuntimeStyle(document.getElementById(`pane-${targetTab}`), "display", "block");
    };
  });
  tabBtns[0].click();
  this.updateBreakdownTotal(planId);
  this.view.openModal("modal-plan-breakdown");
  lucide.createIcons();
  await this.loadBreakdownPackageDetails(planId);
}
async function loadBreakdownPackageDetailsForPlan(controller, planId) {
  const packages = controller.model.getLatestPackagesForPlan(planId);
  const incompletePackages = packages.filter((gt) => gt.referenceOnly === true ||
    gt.giaGoiThau === void 0 || gt.giaGoiThau === null ||
    gt.hinhThucLuaChon === void 0 || gt.hinhThucLuaChon === null || gt.hinhThucLuaChon === "");
  if (incompletePackages.length > 0) {
    await Promise.all(incompletePackages.map((gt) =>
      controller.fetchRecordByLookup("goithau", gt.id || gt.maGoiThau).catch((error) => {
        console.error("Failed to load package details for plan breakdown:", error);
        return null;
      })
    ));
  }
  const loadPlanTable = async (table) => {
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
      const nextCursor = String(page.nextCursor || "");
      if (!page.hasMore || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    } while (cursor);
  };
  await Promise.all([
    loadPlanTable("goithauhanghoa"),
    loadPlanTable("thongtinmothau"),
    loadPlanTable("hanghoaduthaunhathau"),
    loadPlanTable("assignments"),
  ]);
  if (String(document.getElementById("breakdown-plan-id")?.value || "") !== String(planId)) return;
  controller.renderBreakdownPackagesList(planId);
  controller.updateBreakdownTotal(planId);
  lucide.createIcons();
}

export function loadBreakdownPackageDetails(planId) {
  if (!planId || typeof this.fetchRecordByLookup !== "function") return Promise.resolve();
  const requestKey = String(planId);
  this._breakdownPackageDetailRequests ||= new Map();
  const existing = this._breakdownPackageDetailRequests.get(requestKey);
  if (existing) return existing;

  const hydratedTables = [
    "goithau",
    "goithauhanghoa",
    "thongtinmothau",
    "hanghoaduthaunhathau",
    "assignments",
  ];
  const activeDraft = isPlanBreakdownDraftActive(this, planId)
    ? this.planBreakdownDraft
    : null;
  const localBefore = activeDraft
    ? Object.fromEntries(hydratedTables.map((table) => [
      table,
      structuredClone(this.model.state?.[table] || []),
    ]))
    : null;

  const request = loadBreakdownPackageDetailsForPlan(this, planId)
    .then(() => {
      if (activeDraft?.active && this.planBreakdownDraft === activeDraft) {
        rebasePlanBreakdownDraftAfterServerMerge(
          this.model,
          activeDraft,
          localBefore,
          new Set(hydratedTables),
        );
      }
    })
    .finally(() => {
      if (this._breakdownPackageDetailRequests.get(requestKey) === request) {
        this._breakdownPackageDetailRequests.delete(requestKey);
      }
    });
  this._breakdownPackageDetailRequests.set(requestKey, request);
  return request;
}
export function renderBreakdownPackagesList(planId) {
  const tbody = document.getElementById("tbody-breakdown-goithau");
  if (!tbody) return;
  const pkgs = this.model.getLatestPackagesForPlan(planId);
  if (pkgs.length === 0) {
    tbody.innerHTML = trustedHTML(`<tr><td colspan="6" class="bf-s-058d4c8b3d"><small>Chưa có gói thầu nào được tạo cho kế hoạch này.</small></td></tr>`);
    return;
  }
  tbody.innerHTML = trustedHTML(pkgs.map((gt) => {
    const hinhThuc = gt.hinhThucLuaChon || "--";
    const effectiveStatus = resolvePackageResultStatus(gt);
    const getStatusBadge = this.view?.getStatusBadge || this.getStatusBadge;
    const trangThaiBadge = typeof getStatusBadge === "function"
      ? getStatusBadge.call(this.view || this, effectiveStatus)
      : escapeHtml(effectiveStatus || "--");
    return `
            <tr class="bf-s-ddc4ced4b2">
                <td class="bf-s-e69a70165f">${escapeHtml(this.model.getPackageBaseCode(gt.maGoiThau) || "--")}</td>
                <td class="bf-s-5af3dfe0e6">${escapeHtml(gt.tenGoiThau)}</td>
                <td class="bf-s-fa7d102d10">${this.model.formatCurrency(gt.giaGoiThau)}</td>
                <td class="bf-s-c6760d4ab4">${escapeHtml(hinhThuc)}</td>
                <td class="bf-s-69a042494b">${trangThaiBadge}</td>
                <td class="bf-s-59809c145b">
                    <div class="action-btn-group">
                      ${["Đã có kết quả một phần", "Đã có kết quả", "Hủy thầu"].includes(effectiveStatus) ? `<button type="button" class="action-btn btn-view breakdown-package-action" data-bf-action="show-package" data-close-before="modal-plan-breakdown" data-id="${escapeHtml(gt.id)}" aria-label="Xem gói thầu" title="Xem gói thầu"><i data-lucide="eye" aria-hidden="true"></i></button>` : `<button type="button" class="action-btn btn-edit breakdown-package-action" data-bf-action="edit-package" data-id="${escapeHtml(gt.id)}" aria-label="Sửa gói thầu" title="Sửa gói thầu"><i data-lucide="pencil" aria-hidden="true"></i></button>`}
                      <button type="button" class="action-btn btn-delete breakdown-package-action" data-bf-action="delete-package" data-id="${escapeHtml(gt.id)}" aria-label="Xóa gói thầu" title="Xóa gói thầu"><i data-lucide="trash-2" aria-hidden="true"></i></button>
                    </div>
                </td>
            </tr>
        `;
  }).join(""));
  lucide.createIcons({ root: tbody });
}
export function addBreakdownRow(type, data = null) {
  const tbody = document.getElementById(`tbody-breakdown-${type}`);
  if (!tbody) return;
  const planId = document.getElementById("breakdown-plan-id").value;
  const row = document.createElement("tr");
  setRuntimeStyle(row, "borderBottom", "1px solid var(--border-color)");
  if (type === "dathuchien") {
    row.innerHTML = trustedHTML(`
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-name bf-s-fa7eceb10a" required value="${escapeHtml(data?.tenCongViec || "")}" placeholder="Nhập tên phần công việc..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-value text-right bf-s-3f7d24416d" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ""}" placeholder="Nhập giá trị..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-unit bf-s-fa7eceb10a" value="${escapeHtml(data?.donViThucHien || "")}" placeholder="Đơn vị thực hiện..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-doc bf-s-fa7eceb10a" value="${escapeHtml(data?.vanBanPheDuyet || "")}" placeholder="Văn bản phê duyệt..."></td>
            <td class="bf-s-4f08020cfe"><button type="button" class="action-btn btn-delete btn-delete-row" data-bf-action="call" data-fn="removeBreakdownRow" data-args='[null,"dathuchien"]' aria-label="Xóa công việc" title="Xóa công việc"><i data-lucide="trash-2" aria-hidden="true"></i></button></td>
        `);
  } else if (type === "khongapdung") {
    row.innerHTML = trustedHTML(`
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-name bf-s-fa7eceb10a" required value="${escapeHtml(data?.tenCongViec || "")}" placeholder="Nhập tên phần công việc..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-value text-right bf-s-3f7d24416d" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ""}" placeholder="Nhập giá trị..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-unit bf-s-fa7eceb10a" value="${escapeHtml(data?.donViThucHien || "")}" placeholder="Đơn vị thực hiện..."></td>
            <td class="bf-s-4f08020cfe"><button type="button" class="action-btn btn-delete btn-delete-row" data-bf-action="call" data-fn="removeBreakdownRow" data-args='[null,"khongapdung"]' aria-label="Xóa công việc" title="Xóa công việc"><i data-lucide="trash-2" aria-hidden="true"></i></button></td>
        `);
  } else if (type === "chuadudieuKien") {
    row.innerHTML = trustedHTML(`
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-name bf-s-fa7eceb10a" required value="${escapeHtml(data?.tenCongViec || "")}" placeholder="Nhập tên phần công việc..."></td>
            <td class="bf-s-8befdbbc51"><input type="text" class="breakdown-value text-right bf-s-3f7d24416d" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ""}" placeholder="Nhập giá trị..."></td>
            <td class="bf-s-4f08020cfe"><button type="button" class="action-btn btn-delete btn-delete-row" data-bf-action="call" data-fn="removeBreakdownRow" data-args='[null,"chuadudieuKien"]' aria-label="Xóa công việc" title="Xóa công việc"><i data-lucide="trash-2" aria-hidden="true"></i></button></td>
        `);
  }
  const priceInput = row.querySelector(".breakdown-value");
  if (priceInput) {
    bindCurrencyElement(priceInput, (value) => this.model.formatVND(value));
    priceInput.addEventListener("input", () => {
      if (planId) {
        this.updateBreakdownTotal(planId);
      }
    });
  }
  tbody.appendChild(row);
  lucide.createIcons({ root: row });
}
export function removeBreakdownRow(btn) {
  const planId = document.getElementById("breakdown-plan-id").value;
  const row = btn.closest("tr");
  if (row) {
    row.remove();
    if (planId) {
      this.updateBreakdownTotal(planId);
    }
  }
}
export function updateBreakdownTotal(planId) {
  const kh = this.model.state.kehoach.find((k) => k.id === planId);
  if (!kh) return;
  const parseInputsVal = (type) => {
    const tbody = document.getElementById(`tbody-breakdown-${type}`);
    if (!tbody) return 0;
    return this.model.sumVND(Array.from(tbody.querySelectorAll(".breakdown-value"), (input) => input.value));
  };
  const sumI = parseInputsVal("dathuchien");
  const sumII = parseInputsVal("khongapdung");
  const sumIII = parseInputsVal("chuadudieuKien");
  const pkgs = this.model.getLatestPackagesForPlan(planId);
  const sumIV = this.model.sumVND(pkgs.filter((item) => !item.isRebid).map((item) => item.giaGoiThau || 0));
  const isProject = kh.loaiHinhMuaSam === "Dự án";
  const total = this.model.sumVND(isProject ? [sumI, sumII, sumIII, sumIV] : [sumII, sumIII, sumIV]);
  if (kh.tongMucDauTu && kh.tongMucDauTu > 1 && kh.isTongMucTuDong !== true) {
  } else {
    kh.tongMucDauTu = total;
    kh.isTongMucTuDong = true;
  }
  const labelTitle = isProject ? "Tổng mức đầu tư" : "Tổng dự toán";
  const totalSpan = document.getElementById("breakdown-total-display");
  if (totalSpan) {
    totalSpan.innerHTML = trustedHTML(`<strong>${labelTitle}:</strong> <span class="text-blue bf-s-9ffafcc45f">${this.model.formatCurrency(kh.tongMucDauTu)}</span>`);
  }
}
export function recalculatePlanTotal(planId) {
  const kh = this.model.state.kehoach.find((k) => k.id === planId);
  if (!kh) return;
  if (kh.tongMucDauTu && kh.tongMucDauTu > 1 && kh.isTongMucTuDong !== true) {
    return;
  }
  const sumI = this.model.sumVND((kh.cvDaThucHienList || []).map((item) => item.giaTri || 0));
  const sumII = this.model.sumVND((kh.cvKhongApDungList || []).map((item) => item.giaTri || 0));
  const sumIII = this.model.sumVND((kh.cvChuaDuDieuKienList || []).map((item) => item.giaTri || 0));
  const pkgs = this.model.getLatestPackagesForPlan(planId);
  const sumIV = this.model.sumVND(pkgs.filter((item) => !item.isRebid).map((item) => item.giaGoiThau || 0));
  const isProject = kh.loaiHinhMuaSam === "Dự án";
  kh.tongMucDauTu = this.model.sumVND(isProject ? [sumI, sumII, sumIII, sumIV] : [sumII, sumIII, sumIV]);
  kh.isTongMucTuDong = true;
}

function collectBreakdownRows(controller, type) {
  const tbody = document.getElementById(`tbody-breakdown-${type}`);
  if (!tbody) return [];
  const rows = [];
  tbody.querySelectorAll("tr").forEach((tr) => {
    const name = tr.querySelector(".breakdown-name")?.value.trim();
    if (!name) return;
    const giaTri = controller.model.parseVND(
      tr.querySelector(".breakdown-value")?.value || "0",
    );
    if (type === "dathuchien") {
      rows.push({
        tenCongViec: name,
        giaTri,
        donViThucHien: tr.querySelector(".breakdown-unit")?.value.trim() || "",
        vanBanPheDuyet: tr.querySelector(".breakdown-doc")?.value.trim() || "",
      });
    } else if (type === "khongapdung") {
      rows.push({
        tenCongViec: name,
        giaTri,
        donViThucHien: tr.querySelector(".breakdown-unit")?.value.trim() || "",
      });
    } else {
      rows.push({ tenCongViec: name, giaTri });
    }
  });
  return rows;
}

export function updatePlanBreakdownDraftRows(controller, planId) {
  const plan = controller.model.state.kehoach.find(
    (candidate) => String(candidate.id) === String(planId),
  );
  if (!plan) return null;
  plan.cvDaThucHienList = collectBreakdownRows(controller, "dathuchien");
  plan.cvKhongApDungList = collectBreakdownRows(controller, "khongapdung");
  plan.cvChuaDuDieuKienList = collectBreakdownRows(controller, "chuadudieuKien");
  return plan;
}

export async function saveIntermediatePlanVersion() {
  const planId = document.getElementById("breakdown-plan-id")?.value;
  if (!planId) return null;
  const retryingPendingNextRevision = Boolean(
    this.procurementPlanImport?.controller?.state === "WAITING_NEXT_CONFIRMATION"
    && this.procurementPlanImport?.pendingNextRevisionNumber,
  );
  if (retryingPendingNextRevision) {
    await this.completeProcurementPlanImportRevision?.(planId);
    const nextPlanId = this.procurementPlanImport?.currentPlanId || planId;
    const nextPlan = this.model.state.kehoach.find(
      (candidate) => String(candidate.id) === String(nextPlanId),
    );
    return {
      ok: true,
      planId: nextPlan?.id || nextPlanId,
      version: nextPlan?.phienBan,
    };
  }
  if (typeof this.loadBreakdownPackageDetails === "function") {
    await this.loadBreakdownPackageDetails(planId);
  }
  const checkpoint = captureIntermediateDraftCheckpoint(this);
  if (this.procurementPlanImport?.controller) {
    let currentRevisionDurable = false;
    try {
      const currentPlan = updatePlanBreakdownDraftRows(this, planId);
      const currentSession = findPlanVersionDraftSession(this.model, planId);
      if (!currentPlan || !currentSession) {
        throw new Error("Không thể lưu phiên bản nguồn hiện tại vào bản nháp kế hoạch.");
      }
      const refreshedSession = refreshPlanVersionDraftSession(
        cloneDraftValue(currentSession), this.model.state, planId,
      );
      await savePlanVersionDraftSession(this.model, refreshedSession);
      currentRevisionDurable = true;
      await this.completeProcurementPlanImportRevision?.(planId);
      const nextPlanId = this.procurementPlanImport?.currentPlanId || planId;
      const nextPlan = this.model.state.kehoach.find(
        (candidate) => String(candidate.id) === String(nextPlanId),
      ) || currentPlan;
      return { ok: true, planId: nextPlan.id, version: nextPlan.phienBan };
    } catch (error) {
      if (!currentRevisionDurable) {
        await restoreIntermediateDraftCheckpoint(this, checkpoint);
      }
      throw error;
    }
  }
  let nextPlan;
  try {
    const currentPlan = updatePlanBreakdownDraftRows(this, planId);
    const currentSession = findPlanVersionDraftSession(this.model, planId);
    if (!currentPlan || !currentSession) {
      throw new Error("Chỉ kế hoạch mới chưa lưu mới có thể lưu phiên bản nháp.");
    }
    const timestamp = this.model.getCurrentDateTimeString();
    const nextPlanId = generateRecordId("kehoach");
    nextPlan = createNextVersion(
      this.model.state.kehoach,
      currentPlan,
      currentPlan,
      { id: nextPlanId, timestamp },
    );
    nextPlan.createdAt = currentPlan.createdAt || timestamp;
    this.model.state.kehoach.push(nextPlan);

    const inheritedAggregate = snapshotPlanAggregate(this.model.state, {
      sourcePlanId: currentPlan.id,
      targetPlanId: nextPlan.id,
      timestamp,
      sourcePackages: this.model.state.goithau,
    });
    applyPlanAggregateSnapshot(this.model.state, inheritedAggregate);
    const planAssignments = (this.model.state.assignments || []).filter((assignment) => (
      assignment.type === "kehoach"
      && String(assignment.targetId) === String(currentPlan.id)
    ));
    planAssignments.forEach((assignment) => {
      const cloned = { ...assignment };
      delete cloned.rowVersion;
      delete cloned.expectedVersion;
      cloned.id = generateRecordId("assignments");
      cloned.targetId = nextPlan.id;
      this.model.state.assignments.push(cloned);
    });
    rememberSelectedVersion(this.model.state, "selectedPlanVersion", nextPlan);
    const refreshedSession = refreshPlanVersionDraftSession(
      cloneDraftValue(currentSession), this.model.state, nextPlan.id,
    );
    await savePlanVersionDraftSession(this.model, refreshedSession);
  } catch (error) {
    await restoreIntermediateDraftCheckpoint(this, checkpoint);
    throw error;
  }

  if (this.planBreakdownDraft?.active) this.planBreakdownDraft.planId = nextPlan.id;
  this.tempPlanAction = "create";
  this.tempPlanData = { ...nextPlan };
  this.view.renderKeHoachTable?.();
  this.view.renderGoiThauTable?.();
  await this.openPlanBreakdownModal(nextPlan.id);
  return { ok: true, planId: nextPlan.id, version: nextPlan.phienBan };
}

export async function backToPlanDraft() {
  const planId = document.getElementById("breakdown-plan-id")?.value;
  if (!planId) return;
  updatePlanBreakdownDraftRows(this, planId);
  this.view.closeModal("modal-plan-breakdown");
  await this.plans.edit(planId);
}

export async function savePlanBreakdown() {
  const planId = document.getElementById("breakdown-plan-id").value;
  const kh = this.model.state.kehoach.find((k) => k.id === planId);
  if (!kh) return;
  const activeVersionDraft = findPlanVersionDraftSession(this.model, planId);
  if (
    activeVersionDraft
    && this.procurementPlanImport?.controller?.hasNext()
  ) {
    return { ok: false, code: "PROCUREMENT_REVISIONS_REMAINING" };
  }
  if (typeof this.loadBreakdownPackageDetails === "function") {
    await this.loadBreakdownPackageDetails(planId);
  }
  const currentDraftPlan = updatePlanBreakdownDraftRows(this, planId);
  const cvDaThucHien = currentDraftPlan?.cvDaThucHienList || [];
  const cvKhongApDung = currentDraftPlan?.cvKhongApDungList || [];
  const cvChuaDuDieuKien = currentDraftPlan?.cvChuaDuDieuKienList || [];
  let finalPlanId = planId;
  let officialVersionCommitted = false;
  if (this.tempPlanAction === "edit") {
    const backupKh = this.backupKeHoachState.find((k) => k.id === this.tempPlanData.id);
    let saveAsNewVersion = false;
    if (backupKh) {
      const oldTime = backupKh.thoiGianDangMa ? String(backupKh.thoiGianDangMa).trim() : "";
      const newTime = this.tempPlanData.thoiGianDangMa ? String(this.tempPlanData.thoiGianDangMa).trim() : "";
      if (oldTime !== "") {
        const oldDate = new Date(oldTime);
        const newDate = new Date(newTime);
        if (isNaN(oldDate.getTime()) || isNaN(newDate.getTime())) {
          saveAsNewVersion = oldTime !== newTime;
        } else {
          saveAsNewVersion = oldDate.getTime() !== newDate.getTime();
        }
      }
    }
    if (saveAsNewVersion) {
      this.model.replaceTableState(
        "kehoach",
        restoreRecordSnapshot(this.model.state.kehoach, this.backupKeHoachState),
      );
      const oldKh = this.model.state.kehoach.find((k) => k.id === this.tempPlanData.id);
      const versionChanges = {
        ...this.tempPlanData,
        cvDaThucHienList: cvDaThucHien,
        cvKhongApDungList: cvKhongApDung,
        cvChuaDuDieuKienList: cvChuaDuDieuKien
      };
      if (Number(oldKh?.rowVersion) > 0) {
        const createAggregateVersion = this.createAggregateVersion
          || createOfficialAggregateVersion;
        const result = await createAggregateVersion(this, {
          kind: "plan",
          sourceId: oldKh.id,
          expectedRowVersion: Number(oldKh.rowVersion),
          changes: versionChanges,
          clientMutationId: generateRecordId("version-command"),
        });
        if (result?.authoritative) {
          const rootId = String(oldKh.rootId || oldKh.id);
          const nextPlan = this.model.state.kehoach.find((candidate) => (
            String(candidate.rootId || candidate.id) === rootId
            && candidate.isLatest == 1
            && String(candidate.id) !== String(oldKh.id)
          ));
          if (!nextPlan) {
            throw new Error("Máy chủ đã tạo phiên bản nhưng kế hoạch mới chưa được tải về.");
          }
          finalPlanId = nextPlan.id;
          rememberSelectedVersion(this.model.state, "selectedPlanVersion", nextPlan);
          officialVersionCommitted = true;
        }
      }
      if (!officialVersionCommitted) {
        const newId = generateRecordId("kehoach");
        finalPlanId = newId;
        const timestamp = this.model.getCurrentDateTimeString();
        const nextPlan = createNextVersion(this.model.state.kehoach, oldKh, versionChanges, {
          id: newId,
          timestamp
        });
        nextPlan.createdAt = oldKh.createdAt || timestamp;
        this.model.state.kehoach.push(nextPlan);
        const inheritedAggregate = snapshotPlanAggregate(this.model.state, {
          sourcePlanId: oldKh.id,
          targetPlanId: nextPlan.id,
          timestamp,
          sourcePackages: this.model.state.goithau,
        });
        applyPlanAggregateSnapshot(this.model.state, inheritedAggregate);
        rememberSelectedVersion(this.model.state, "selectedPlanVersion", nextPlan);
        const previousPlanAssigneeIds = this.model.state.assignments
          .filter((assignment) => String(assignment.targetId) === String(oldKh.id) && assignment.type === "kehoach")
          .map((assignment) => assignment.empId)
          .filter(Boolean);
        const planAssigneeIds = [...new Set(previousPlanAssigneeIds)];
        for (const activeUserId of planAssigneeIds) {
          this.model.state.assignments.push({
            id: generateRecordId("assignments"),
            empId: activeUserId,
            targetId: newId,
            type: "kehoach"
          });
        }
      }
    } else {
      const currentKh = this.model.state.kehoach.find((k) => k.id === planId);
      if (currentKh) {
        currentKh.cvDaThucHienList = cvDaThucHien;
        currentKh.cvKhongApDungList = cvKhongApDung;
        currentKh.cvChuaDuDieuKienList = cvChuaDuDieuKien;
      }
    }
  } else {
    const currentKh = this.model.state.kehoach.find((k) => k.id === planId);
    if (currentKh) {
      currentKh.cvDaThucHienList = cvDaThucHien;
      currentKh.cvKhongApDungList = cvKhongApDung;
      currentKh.cvChuaDuDieuKienList = cvChuaDuDieuKien;
    }
  }
  const targetKh = this.model.state.kehoach.find((k) => k.id === finalPlanId);
  if (targetKh && targetKh.isTongMucTuDong) {
    this.recalculatePlanTotal(finalPlanId);
  }
  this.updateBreakdownTotal(finalPlanId);
  if (hasModalReturnState("kehoach-detail") && finalPlanId) {
    updateModalReturnAction(finalPlanId);
  }
  const renderVersionTables = () => Promise.all([
      this.view.renderKeHoachTable(),
      this.view.renderGoiThauTable()
    ]);
  let explicitChanges = { upserts: {}, deletions: {} };
  if (!officialVersionCommitted) {
    const targetPlan = this.model.state.kehoach.find(
      (plan) => String(plan.id) === String(finalPlanId),
    );
    const targetPlanRootId = String(targetPlan?.rootId || targetPlan?.id || "");
    explicitChanges.upserts.kehoach = this.model.state.kehoach.filter(
      (plan) => String(plan.rootId || plan.id) === targetPlanRootId,
    );
    if (isPlanBreakdownDraftActive(this, finalPlanId)) {
      explicitChanges = collectPlanBreakdownDraftChanges(this.model.state, {
        planId: finalPlanId,
        snapshot: this.planBreakdownDraft.snapshot,
      });
      if (this.procurementPlanImport?.controller) {
        explicitChanges = boundProcurementRevisionChanges(explicitChanges, finalPlanId);
      }
    } else if (String(finalPlanId) !== String(planId)) {
      explicitChanges.upserts.goithau = this.model.state.goithau.filter(
        (pkg) => String(pkg.keHoachId) === String(finalPlanId),
      );
      const inheritedPackageIds = new Set(explicitChanges.upserts.goithau.map((pkg) => String(pkg.id)));
      for (const table of ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau"]) {
        explicitChanges.upserts[table] = this.model.state[table].filter(
          (record) => inheritedPackageIds.has(String(record.goiThauId)),
        );
      }
      explicitChanges.upserts.assignments = this.model.state.assignments.filter((assignment) => (
        (assignment.type === "kehoach" && String(assignment.targetId) === String(finalPlanId))
        || (assignment.type === "goithau" && inheritedPackageIds.has(String(assignment.targetId)))
      ));
    }
  }
  const finalDraftSession = findPlanVersionDraftSession(this.model, finalPlanId);
  let syncResult;
  if (finalDraftSession) {
    const finalizeLease = captureWorkspaceLease(this.model);
    const finalizeStorage = this.model.workspaceStorage;
    const finalizeIsCurrent = () => (
      isWorkspaceLeaseCurrent(this.model, finalizeLease)
      && this.model.workspaceStorage === finalizeStorage
    );
    try {
      const finalizeResult = await finalizePlanVersionDraft(this, finalDraftSession, {
        send: this.finalizePlanDraft,
      });
      if (finalizeResult?.workspaceChanged || !finalizeIsCurrent()) {
        return stalePlanFinalizeResult();
      }
      if (typeof this.forceSyncData === "function") {
        try {
          const pullResult = await this.forceSyncData(true, true);
          if (pullResult?.workspaceChanged || !finalizeIsCurrent()) {
            return stalePlanFinalizeResult();
          }
        } catch (pullError) {
          if (!finalizeIsCurrent()) return stalePlanFinalizeResult();
          console.warn("Plan draft committed but canonical refresh is pending:", pullError);
        }
      }
      await renderVersionTables();
      if (!finalizeIsCurrent()) return stalePlanFinalizeResult();
      syncResult = { ok: true };
    } catch (error) {
      await this.view.customAlert(
        "Chưa thể hoàn tất kế hoạch",
        error?.message || "Máy chủ chưa xác nhận toàn bộ chuỗi phiên bản. Bản nháp vẫn được giữ trên thiết bị.",
        "alert-triangle",
      );
      return { ok: false, error };
    }
  } else {
    syncResult = officialVersionCommitted
      ? (await renderVersionTables(), { ok: true })
      : await mutatePersistAndSync(this, explicitChanges, {
        tableKeys: [
          ...new Set([
            ...Object.keys(explicitChanges.upserts),
            ...Object.keys(explicitChanges.deletions),
          ]),
        ],
        afterPersist: renderVersionTables,
      });
  }
  if (!syncResult?.ok) return;
  this.backupKeHoachState = null;
  this.backupGoiThauState = null;
  this.tempPlanData = null;
  this.tempPlanAction = null;
  this.planBreakdownDraft = null;
  await this.closeModal("modal-plan-breakdown", {
    restoreRoute: false,
    preserveProcurementImport: true,
  });
  if (this.procurementPlanImport?.controller) {
    await this.completeProcurementPlanImportRevision?.(finalPlanId);
  } else {
    await this.view.customAlert("Thành công", "Đã lưu kế hoạch và cấu trúc phân chia chi tiết công việc thành công!", "check-circle");
  }
}
