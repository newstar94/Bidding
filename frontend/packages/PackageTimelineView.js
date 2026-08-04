import { trustedHTML } from "../shared/trustedTypes.js";
import { getAppController } from "../app/controllerRef.js";
import { appendExportSnapshotVersion } from "../shared/exportSnapshot.js";
import { getJson } from "../shared/apiClient.js";
import { loadPaginatedRecords } from "../shared/tableDataUtils.js";
import { authFetchDownload } from "../shared/workflow_helpers.js";
import { escapeHtml, safeAttr } from "../shared/view_helpers.js";
import { getVersionLabel } from "../shared/formatters.js";
import { initAccessibleCombobox } from "../shared/accessibleCombobox.js";
import {
  applyTimelineApplicability,
  applyAutomaticTimelineSources,
  copyTimelineForNewVersion,
  mergeTimelineRows,
  preserveHiddenTimelineRows,
  timelineDisplayCode,
  timelineIsOverdue
} from "./packageTimelineRows.js";

const STATUS_LABELS = Object.freeze({
  PENDING: "Chưa thực hiện",
  IN_PROGRESS: "Đang thực hiện",
  DONE: "Đã hoàn thành",
  NOT_APPLICABLE: "Không áp dụng"
});

const TIMELINE_SELECTION_KEY = "bf_timeline_selection";
const TERMINAL_PACKAGE_STATUSES = new Set(["Đã có kết quả", "Hủy thầu", "Huỷ thầu", "AWARDED", "CANCELLED"]);
const PREPARING_PACKAGE_STATUSES = new Set(["Chuẩn bị", "PREPARING"]);

export function readTimelineSelection(model) {
  try {
    const stored = model?.workspaceSessionStorage?.readJson(TIMELINE_SELECTION_KEY, null);
    const planId = String(stored?.planId || "").trim();
    const packageId = String(stored?.packageId || "").trim();
    return planId && packageId ? { planId, packageId } : null;
  } catch {
    return null;
  }
}

export function saveTimelineSelection(model, selection) {
  const planId = String(selection?.planId || "").trim();
  const packageId = String(selection?.packageId || "").trim();
  if (!planId || !packageId) {
    clearTimelineSelection(model);
    return false;
  }
  const storage = model?.workspaceSessionStorage;
  if (typeof storage?.writeJson !== "function") return false;
  try {
    storage.writeJson(TIMELINE_SELECTION_KEY, { planId, packageId });
    return true;
  } catch {
    return false;
  }
}

export function clearTimelineSelection(model) {
  try {
    model?.workspaceSessionStorage?.removeItem(TIMELINE_SELECTION_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function timelineState(view) {
  const workspaceToken = view.model?.getWorkspaceToken?.() || view.model?.workspaceScope?.key || "";
  if (view._packageTimelineState?.workspaceToken !== workspaceToken) {
    clearTimeout(view._packageTimelineState?.packageSearchTimer);
    view._packageTimelineState = null;
  }
  view._packageTimelineState ||= {
    workspaceToken,
    package: null,
    plan: null,
    rows: [],
    packageOptions: [],
    packageQuery: "",
    filters: { status: "" },
    dirty: false,
    loading: false,
    restoreAttempted: false,
    restoringSelection: false,
    selectionRequestVersion: 0,
    optionsRequestVersion: 0
  };
  view._packageTimelineState.documentExportEnabled = Boolean(
    view.model?.state?.activeuser?.wordExportEnabled
  );
  return view._packageTimelineState;
}

export function resetTimelineSession(view) {
  const state = view?._packageTimelineState;
  if (state) {
    clearTimeout(state.packageSearchTimer);
    state.package = null;
    state.plan = null;
    state.rows = [];
    state.packageOptions = [];
    state.packageQuery = "";
    state.filters = { status: "" };
    state.dirty = false;
    state.loading = false;
    state.restoreAttempted = true;
    state.restoringSelection = false;
    state.selectionRequestVersion = Number(state.selectionRequestVersion || 0) + 1;
    state.optionsRequestVersion = Number(state.optionsRequestVersion || 0) + 1;
  }
  clearTimelineSelection(view?.model);
  return state || null;
}

function isCurrentTimelineRequest(view, state, key, version) {
  return view?._packageTimelineState === state && state?.[key] === version;
}

function element(id) {
  return document.getElementById(id);
}

function setHidden(id, hidden) {
  const target = element(id);
  if (target) target.hidden = hidden;
}

function updateLiveStatus(message) {
  const target = element("timeline-live-status");
  if (target) target.textContent = message || "";
}

function findPlan(view, packageRecord) {
  return (view.model.state.kehoach || []).find((plan) => String(plan.id) === String(packageRecord?.keHoachId)) || {};
}

export function timelinePlanProgressStatus(planId, packages = []) {
  const planPackages = packages.filter((pkg) => (
    String(pkg.keHoachId || pkg.ke_hoach_id || "") === String(planId || "")
    && pkg.isLatest !== false
    && pkg.isLatest !== 0
    && !pkg.archivedAt
  ));
  const statuses = planPackages.map((pkg) => String(pkg.trangThai || pkg.trang_thai || "Chuẩn bị").trim());
  if (!statuses.length || statuses.every((status) => PREPARING_PACKAGE_STATUSES.has(status))) {
    return "Chưa triển khai";
  }
  return statuses.some((status) => !TERMINAL_PACKAGE_STATUSES.has(status))
    ? "Đang thực hiện"
    : "Hoàn thành";
}

function selectableTimelinePlans(view) {
  const packages = view.model.state.goithau || [];
  return (view.model.state.kehoach || [])
    .filter((plan) => plan.isLatest !== false && plan.isLatest !== 0 && !plan.archivedAt)
    .filter((plan) => timelinePlanProgressStatus(plan.id, packages) !== "Hoàn thành");
}

function isTimelinePlanSelectable(view, planId) {
  return selectableTimelinePlans(view).some((plan) => String(plan.id) === String(planId));
}

function findContracts(view, packageRecord) {
  return (view.model.state.hopdong || []).filter((contract) => (
    Array.isArray(contract.goiThauIds)
    && contract.goiThauIds.some((id) => String(id) === String(packageRecord?.id))
  ));
}

function prepareTimelineSelect(select, label, refreshOptions = {}) {
  if (!select) return null;
  select.setAttribute("data-no-custom", "true");
  select.setAttribute("aria-label", label);
  select.__bfAccessibleCombobox?.refresh(refreshOptions);
  return select;
}

function syncTimelineSelectValue(select, value) {
  if (!select) return;
  select.value = String(value || "");
  select.__bfAccessibleCombobox?.refresh();
}

function initTimelineComboboxes(view) {
  initAccessibleCombobox(element("timeline-plan-select"), {
    placeholder: "Tìm theo mã hoặc tên kế hoạch",
    noResultsText: "Không có kế hoạch chưa hoàn thành phù hợp"
  });
  initAccessibleCombobox(element("timeline-package-select"), {
    placeholder: "Chọn kế hoạch trước",
    noResultsText: "Không tìm thấy gói thầu phù hợp",
    onQuery: (rawQuery) => {
      const state = timelineState(view);
      const query = String(rawQuery || "").trim();
      state.packageQuery = query;
      clearTimeout(state.packageSearchTimer);
      state.packageSearchTimer = setTimeout(() => loadPackageOptions(view, query), 300);
    }
  });
  initAccessibleCombobox(element("timeline-version-select"), {
    searchable: false,
    placeholder: "--",
    noResultsText: "Không có phiên bản khác"
  });
  initAccessibleCombobox(element("timeline-status-filter"), {
    searchable: false,
    includeEmptyOption: true,
    placeholder: "Tất cả trạng thái",
    noResultsText: "Không có trạng thái"
  });
}

function cachePackage(view, rawRecord) {
  const normalized = typeof view.model.normalizeRecordKeys === "function"
    ? view.model.normalizeRecordKeys(rawRecord, "goithau")
    : rawRecord;
  const record = { ...normalized, referenceOnly: false };
  const packages = view.model.state.goithau || (view.model.state.goithau = []);
  const index = packages.findIndex((item) => String(item.id) === String(record.id));
  if (index >= 0) packages[index] = record;
  else packages.push(record);
  return record;
}

function cachePlan(view, rawRecord) {
  const normalized = typeof view.model.normalizeRecordKeys === "function"
    ? view.model.normalizeRecordKeys(rawRecord, "kehoach")
    : rawRecord;
  const record = { ...normalized, referenceOnly: false };
  const plans = view.model.state.kehoach || (view.model.state.kehoach = []);
  const index = plans.findIndex((item) => String(item.id) === String(record.id));
  if (index >= 0) plans[index] = record;
  else plans.push(record);
  return record;
}

async function fetchPackage(view, id) {
  const local = (view.model.state.goithau || []).find((item) => String(item.id) === String(id));
  if (local?.timelineItems && local.referenceOnly !== true && local.hinhThucLuaChon !== undefined) return local;
  const data = await getJson(`/api/record?table=goithau&lookup=${encodeURIComponent(id)}`);
  return data?.item ? cachePackage(view, data.item) : null;
}

async function fetchPlan(view, id) {
  if (!id) return null;
  const local = (view.model.state.kehoach || []).find((item) => String(item.id) === String(id));
  if (local?.referenceOnly !== true && local?.pheDuyet) return local;
  const data = await getJson(`/api/record?table=kehoach&lookup=${encodeURIComponent(id)}`);
  return data?.item ? cachePlan(view, data.item) : local || null;
}

function renderPlanOptions(view) {
  const select = element("timeline-plan-select");
  if (!select) return;
  const plans = selectableTimelinePlans(view)
    .sort((left, right) => String(left.maKeHoach || "").localeCompare(String(right.maKeHoach || ""), "vi"));
  const current = select.value;
  select.innerHTML = trustedHTML(`<option value="">Chọn kế hoạch</option>${plans.map((plan) => (
    `<option value="${safeAttr(plan.id)}" data-search="${safeAttr(`${plan.maKeHoach || ""} ${plan.tenKeHoach || plan.tenDuAnDuToan || ""}`)}">${escapeHtml(plan.maKeHoach || "--")} — ${escapeHtml(plan.tenKeHoach || plan.tenDuAnDuToan || "")}</option>`
  )).join("")}`);
  select.value = plans.some((plan) => String(plan.id) === current) ? current : "";
  prepareTimelineSelect(select, "Chọn kế hoạch theo mã hoặc tên");
}

function renderPackageOptions(view, records, search = "") {
  const state = timelineState(view);
  state.packageOptions = records;
  const select = element("timeline-package-select");
  if (!select) return;
  const hasPlan = Boolean(element("timeline-plan-select")?.value);
  const selectedId = state.package?.id || select.value;
  select.disabled = !hasPlan;
  select.innerHTML = trustedHTML(`<option value="">${hasPlan ? "Chọn gói thầu" : "Chọn kế hoạch trước"}</option>${records.map((pkg) => (
    `<option value="${safeAttr(pkg.id)}" data-search="${safeAttr(`${pkg.maGoiThau || ""} ${pkg.tenGoiThau || ""}`)}">${escapeHtml(pkg.maGoiThau || "--")} — ${escapeHtml(pkg.tenGoiThau || "")}</option>`
  )).join("")}`);
  select.value = records.some((pkg) => String(pkg.id) === String(selectedId)) ? selectedId : "";
  const placeholder = hasPlan ? "Tìm theo mã hoặc tên gói thầu" : "Chọn kế hoạch trước";
  select.__bfAccessibleCombobox?.configure({ placeholder });
  prepareTimelineSelect(
    select,
    hasPlan ? "Chọn gói thầu theo mã hoặc tên" : "Chọn kế hoạch trước",
    { query: search, preserveQuery: Boolean(search), keepOpen: Boolean(search) }
  );
}

async function loadPackageOptions(view, search = timelineState(view).packageQuery) {
  const state = timelineState(view);
  const requestVersion = Number(state.optionsRequestVersion || 0) + 1;
  state.optionsRequestVersion = requestVersion;
  const planId = element("timeline-plan-select")?.value || "";
  if (!planId) {
    state.packageQuery = "";
    renderPackageOptions(view, [], "");
    updateLiveStatus("Chọn kế hoạch LCNT để tải danh sách gói thầu.");
    return;
  }
  state.loading = true;
  updateLiveStatus("Đang tìm gói thầu...");
  try {
    const result = await loadPaginatedRecords(view.model, "goithau", {
      page: 1,
      pageSize: 200,
      search,
      ...(planId ? { keHoachId: planId } : {})
    });
    if (!isCurrentTimelineRequest(view, state, "optionsRequestVersion", requestVersion)) return;
    renderPackageOptions(view, result.items, search);
    updateLiveStatus(`Đã tìm thấy ${result.totalItems} gói thầu.`);
  } catch (error) {
    if (!isCurrentTimelineRequest(view, state, "optionsRequestVersion", requestVersion)) return;
    if (error?.name !== "AbortError") {
      updateLiveStatus("Không thể tải danh sách gói thầu.");
      view.showToast("Thất bại", "Không thể tải danh sách gói thầu. Vui lòng thử lại.", "error");
    }
  } finally {
    if (isCurrentTimelineRequest(view, state, "optionsRequestVersion", requestVersion)) {
      state.loading = false;
    }
  }
}

function renderVersionOptions(pkg) {
  const select = element("timeline-version-select");
  if (!select) return;
  const versions = Array.isArray(pkg?.allVersions) && pkg.allVersions.length
    ? [...pkg.allVersions]
    : pkg ? [{ id: pkg.id, phienBan: pkg.phienBan || "00" }] : [];
  versions.sort((left, right) => Number(right.phienBan || 0) - Number(left.phienBan || 0));
  select.innerHTML = trustedHTML(versions.map((version) => (
    `<option value="${safeAttr(version.id)}">Phiên bản ${escapeHtml(getVersionLabel(version.phienBan))}</option>`
  )).join("") || `<option value="">--</option>`);
  select.value = pkg?.id || "";
  select.disabled = versions.length <= 1;
  prepareTimelineSelect(select, "Chọn phiên bản timeline");
}

function statusOptions(current) {
  return Object.entries(STATUS_LABELS).map(([value, label]) => (
    `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`
  )).join("");
}

function filteredRows(state) {
  return state.rows.filter((row) => {
    if (state.filters.status && row.trangThai !== state.filters.status) return false;
    return true;
  });
}

export function timelineDateBinding(row) {
  const field = row.ngayThucTe || row.trangThai === "DONE" ? "ngayThucTe" : "ngayDuKien";
  return {
    field,
    value: row.ngayThucTe || row.ngayDuKien || "",
    label: field === "ngayThucTe" ? "Thời gian thực tế" : "Thời gian dự kiến"
  };
}

export function formatTimelineDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

export function normalizeTimelineDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const displayMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!displayMatch && !isoMatch) return null;
  const day = Number(displayMatch?.[1] || isoMatch[3]);
  const month = Number(displayMatch?.[2] || isoMatch[2]);
  const year = Number(displayMatch?.[3] || isoMatch[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function renderTimelineTable(view) {
  const state = timelineState(view);
  const tbody = element("timeline-table-body");
  if (!tbody || !state.package) return;
  const editable = state.package.canEdit !== false;
  const disabled = editable ? "" : " disabled";
  let activeGroup = "";
  const html = [];
  filteredRows(state).forEach((row) => {
    if (row.sectionKey !== activeGroup) {
      activeGroup = row.sectionKey;
      html.push(`<tr class="timeline-group-row"><th scope="rowgroup">${escapeHtml(row.displayGroupCode || row.maNhom)}</th><th colspan="6">${escapeHtml(row.tenNhom)}</th></tr>`);
    }
    const overdue = timelineIsOverdue(row);
    const sourceLabel = row.sourceMode === "AUTO" ? "Tự động" : "Thủ công";
    const dateBinding = timelineDateBinding(row);
    const displayCode = timelineDisplayCode(row, state.rows);
    const conditional = row.applicability === "CONDITIONAL";
    const conditionalLabel = row.applicabilityReason === "CONFLICT_E_HSMT_APPRAISAL_DATA" ? "Cần xác nhận" : "Chưa xác định";
    const adjustmentControls = row.milestoneKey === "E_HSMT_ADJUSTMENT_APPROVAL"
      ? `<button type="button" class="timeline-restore-source" data-adjustment-action="remove" aria-label="Ẩn lần điều chỉnh E-HSMT ${safeAttr(row.instanceKey)}"${disabled}><i data-lucide="trash-2"></i></button>`
      : "";
    const appraisalConflictControl = row.applicabilityReason === "CONFLICT_E_HSMT_APPRAISAL_DATA"
      ? `<button type="button" class="timeline-restore-source" data-appraisal-action="require" title="Xác nhận có thẩm định E-HSMT" aria-label="Xác nhận chuyển yêu cầu thẩm định E-HSMT sang Có"${disabled}><i data-lucide="badge-check"></i></button>`
      : "";
    html.push(`
      <tr class="timeline-item-row${overdue ? " is-overdue" : ""}${conditional ? " is-conditional" : ""}" data-entry-id="${safeAttr(row.id)}">
        <th scope="row" title="Mã mốc nghiệp vụ ${safeAttr(row.milestoneKey || row.maMoc)}">${escapeHtml(displayCode)}</th>
        <td><span class="timeline-work-title">${escapeHtml(row.congViec)}</span>${conditional ? `<span class="timeline-conditional" title="${safeAttr(row.applicabilityReason)}">${escapeHtml(conditionalLabel)}</span>` : ""}</td>
        <td><input type="text" data-timeline-field="donViBanHanh" value="${safeAttr(row.donViBanHanh)}" maxlength="300" aria-label="Đơn vị ban hành mốc ${safeAttr(row.maMoc)}"${disabled}></td>
        <td><input type="text" data-timeline-field="soVanBan" value="${safeAttr(row.soVanBan)}" maxlength="300" aria-label="Số văn bản mốc ${safeAttr(row.maMoc)}"${disabled}></td>
        <td><input type="text" class="flatpickr-date" data-timeline-field="${dateBinding.field}" value="${safeAttr(formatTimelineDate(dateBinding.value))}" placeholder="dd/MM/yyyy" aria-label="${dateBinding.label} mốc ${safeAttr(row.maMoc)}"${disabled}></td>
        <td><select data-timeline-field="trangThai" aria-label="Trạng thái mốc ${safeAttr(row.maMoc)}"${disabled}>${statusOptions(row.trangThai)}</select>${overdue ? `<span class="timeline-overdue-label"><i data-lucide="alert-triangle"></i> Quá hạn</span>` : ""}</td>
        <td><button type="button" class="timeline-source-badge ${row.sourceMode === "AUTO" ? "is-auto" : "is-manual"}" data-source-action="toggle" aria-label="Chuyển nguồn mốc ${safeAttr(row.milestoneKey || row.maMoc)}"${disabled}>${sourceLabel}</button>${row.sourceKey && row.sourceMode === "MANUAL" ? `<button type="button" class="timeline-restore-source" data-source-action="restore" title="Khôi phục dữ liệu hệ thống" aria-label="Khôi phục dữ liệu hệ thống mốc ${safeAttr(row.milestoneKey || row.maMoc)}"${disabled}><i data-lucide="rotate-ccw"></i></button>` : ""}${appraisalConflictControl}${adjustmentControls}</td>
      </tr>`);
  });
  if (!html.length) html.push(`<tr><td colspan="7" class="timeline-no-results">Không có mốc phù hợp với bộ lọc.</td></tr>`);
  tbody.querySelectorAll("input.flatpickr-date").forEach((input) => input._flatpickr?.destroy());
  tbody.innerHTML = trustedHTML(html.join(""));
  view.initFlatpickr(tbody);
  view.createIconsScoped(element("timeline-table-wrap"));
}

function setActionAvailability(state) {
  const hasPackage = Boolean(state.package);
  const canEdit = hasPackage && state.package.canEdit !== false;
  ["timeline-save", "timeline-refresh-auto"].forEach((id) => {
    const button = element(id);
    if (button) button.disabled = !canEdit;
  });
  const exportButton = element("timeline-export-excel");
  if (exportButton) {
    exportButton.disabled = !hasPackage || !state.documentExportEnabled;
    exportButton.title = state.documentExportEnabled
      ? "Xuất timeline ra tệp Excel"
      : "Cần gói trả phí đang hoạt động để xuất Excel";
  }
  const versions = state.package?.allVersions || [];
  const copyButton = element("timeline-copy-previous");
  if (copyButton) copyButton.disabled = !canEdit || versions.length < 2;
}

async function removeEhsmtAdjustment(view, row) {
  const state = timelineState(view);
  const confirmed = await view.customConfirm(
    "Ẩn lần điều chỉnh E-HSMT",
    `Chỉ lần điều chỉnh ${row.instanceKey} sẽ được ẩn khỏi timeline. Dữ liệu vẫn được giữ để khôi phục.`,
    "trash-2"
  );
  if (!confirmed) return;
  const list = Array.isArray(state.package.ehsmtAdjustments) ? state.package.ehsmtAdjustments : [];
  state.package.ehsmtAdjustments = list.map((item) => String(item.id) === String(row.instanceKey)
    ? { ...item, archivedAt: new Date().toISOString() }
    : item);
  state.rows = mergeTimelineRows(state.package, state.plan, findContracts(view, state.package));
  state.dirty = true;
  renderTimelineTable(view);
  updateLiveStatus("Đã ẩn lần điều chỉnh; hãy lưu thay đổi.");
}

async function resolveEhsmtAppraisalConflict(view) {
  const state = timelineState(view);
  const confirmed = await view.customConfirm(
    "Xác nhận thẩm định E-HSMT",
    "Dữ liệu thẩm định đã phát sinh. Chuyển lựa chọn của gói thầu sang Có thẩm định E-HSMT?",
    "badge-check"
  );
  if (!confirmed) return;
  state.package.yeuCauThamDinhHsmtCode = "REQUIRED";
  state.package.yeuCauThamDinhHsmt = "Có";
  state.rows = mergeTimelineRows(state.package, state.plan, findContracts(view, state.package));
  state.dirty = true;
  renderTimelineTable(view);
  updateLiveStatus("Đã xác nhận có thẩm định E-HSMT; hãy lưu thay đổi.");
}

async function selectPackage(view, packageId) {
  const state = timelineState(view);
  const requestVersion = Number(state.selectionRequestVersion || 0) + 1;
  state.selectionRequestVersion = requestVersion;
  if (!packageId) {
    state.package = null;
    state.plan = null;
    state.rows = [];
    setHidden("timeline-empty", false);
    setHidden("timeline-table-wrap", true);
    setActionAvailability(state);
    clearTimelineSelection(view.model);
    return;
  }
  setHidden("timeline-empty", true);
  setHidden("timeline-loading", false);
  setHidden("timeline-error", true);
  try {
    const pkg = await fetchPackage(view, packageId);
    if (!isCurrentTimelineRequest(view, state, "selectionRequestVersion", requestVersion)) return;
    if (!pkg) throw new Error("Không tìm thấy gói thầu đã chọn.");
    state.package = pkg;
    state.plan = await fetchPlan(view, pkg.keHoachId) || findPlan(view, pkg);
    if (!isCurrentTimelineRequest(view, state, "selectionRequestVersion", requestVersion)) return;
    state.rows = mergeTimelineRows(pkg, state.plan, findContracts(view, pkg));
    state.dirty = false;
    saveTimelineSelection(view.model, {
      planId: pkg.keHoachId || state.plan?.id,
      packageId: pkg.id
    });
    renderVersionOptions(pkg);
    setHidden("timeline-table-wrap", false);
    renderTimelineTable(view);
    setActionAvailability(state);
    const applicableCount = state.rows.filter((row) => row.applicability === "APPLICABLE").length;
    updateLiveStatus("Đã tải " + applicableCount + " mốc áp dụng của gói " + (pkg.maGoiThau || "") + ".");
  } catch (error) {
    if (!isCurrentTimelineRequest(view, state, "selectionRequestVersion", requestVersion)) return;
    if ([403, 404].includes(Number(error?.status)) || /Không tìm thấy/.test(String(error?.message || ""))) {
      clearTimelineSelection(view.model);
    }
    const errorBox = element("timeline-error");
    if (errorBox) {
      errorBox.textContent = error?.message || "Không thể tải timeline.";
      errorBox.hidden = false;
    }
    setHidden("timeline-table-wrap", true);
  } finally {
    if (isCurrentTimelineRequest(view, state, "selectionRequestVersion", requestVersion)) {
      setHidden("timeline-loading", true);
    }
  }
}

async function restoreTimelineSelection(view, selection) {
  const state = timelineState(view);
  state.restoringSelection = true;
  try {
    if (!isTimelinePlanSelectable(view, selection.planId)) {
      clearTimelineSelection(view.model);
      return;
    }
    const planSelect = element("timeline-plan-select");
    syncTimelineSelectValue(planSelect, selection.planId);
    await selectPackage(view, selection.packageId);
    if (!state.package) return;

    renderPlanOptions(view);
    const actualPlanId = String(state.package.keHoachId || state.plan?.id || selection.planId);
    syncTimelineSelectValue(planSelect, actualPlanId);
    await loadPackageOptions(view, "");

    const selectedId = String(state.package.id);
    if (!state.packageOptions.some((pkg) => String(pkg.id) === selectedId)) {
      renderPackageOptions(view, [state.package, ...state.packageOptions], "");
    }
    const packageSelect = element("timeline-package-select");
    syncTimelineSelectValue(packageSelect, selectedId);
  } finally {
    state.restoringSelection = false;
  }
}

function updateRowFromControl(view, control) {
  const state = timelineState(view);
  const rowElement = control.closest("tr[data-entry-id]");
  const row = state.rows.find((item) => item.id === rowElement?.dataset.entryId);
  const field = control.dataset.timelineField;
  if (!row || !field) return;
  const nextValue = ["ngayDuKien", "ngayThucTe"].includes(field)
    ? normalizeTimelineDate(control.value)
    : control.value;
  if (nextValue === null) {
    view.showToast("Thất bại", "Ngày không hợp lệ. Vui lòng nhập theo định dạng dd/MM/yyyy.", "error");
    renderTimelineTable(view);
    return;
  }
  row[field] = nextValue;
  if (["donViBanHanh", "soVanBan", "ngayThucTe"].includes(field) && row.sourceKey) row.sourceMode = "MANUAL";
  state.dirty = true;
  renderTimelineTable(view);
  updateLiveStatus("Có thay đổi chưa lưu.");
}

async function saveTimeline(view) {
  const state = timelineState(view);
  if (!state.package || state.package.canEdit === false) return;
  const button = element("timeline-save");
  if (button) button.disabled = true;
  try {
    const persistedRows = state.rows.map((row) => ({
      id: row.id,
      milestoneKey: row.milestoneKey,
      instanceKey: row.instanceKey || "",
      sourceEntityId: row.sourceEntityId || "",
      maNhom: row.maNhom,
      tenNhom: row.tenNhom,
      maMoc: row.maMoc,
      congViec: row.congViec,
      donViBanHanh: row.donViBanHanh,
      soVanBan: row.soVanBan,
      ngayDuKien: row.ngayDuKien,
      ngayThucTe: row.ngayThucTe,
      ghiChu: row.ghiChu,
      sourceKey: row.sourceKey,
      sourceMode: row.sourceMode,
      isOptional: row.isOptional,
      trangThai: row.trangThai,
      sortOrder: Math.trunc(Number(row.sortOrder) || 0),
      templateVersion: row.templateVersion
    }));
    state.package.timelineItems = preserveHiddenTimelineRows(state.package.timelineItems, persistedRows);
    view.model.commitLocalMutation("goithau", { records: [state.package] });
    await view.model.persistData("goithau");
    const controller = getAppController();
    if (typeof controller?.forceSyncData === "function") await controller.forceSyncData(false, false, true);
    state.dirty = false;
    const applicableCount = state.rows.filter((row) => row.applicability === "APPLICABLE").length;
    view.showToast("Thành công", `Đã lưu ${applicableCount} mốc áp dụng của gói thầu.`, "success");
    updateLiveStatus("Timeline đã được lưu.");
  } catch {
    view.showToast("Thất bại", "Không thể lưu timeline. Vui lòng thử lại.", "error");
  } finally {
    setActionAvailability(state);
  }
}

async function exportTimeline(view) {
  const state = timelineState(view);
  if (!state.package) return;
  if (!state.documentExportEnabled) {
    view.showToast("Cảnh báo", "Gói dịch vụ hiện tại chưa hỗ trợ xuất Excel.", "warning");
    return;
  }
  const button = element("timeline-export-excel");
  if (button) button.disabled = true;
  try {
    if (state.dirty) await saveTimeline(view);
    const controller = getAppController();
    const snapshotVersion = await controller.prepareExportSnapshot();
    const url = appendExportSnapshotVersion(`/api/export-timeline/${encodeURIComponent(state.package.id)}`, snapshotVersion);
    const code = String(state.package.maGoiThau || "LCNT").replace(/[^A-Za-z0-9_-]+/g, "_");
    await authFetchDownload(url, `Timeline_goi_thau_${code}.xlsx`);
    view.showToast("Thành công", "Đã tải xuống checklist timeline.", "success");
  } catch {
    view.showToast("Thất bại", "Không thể xuất tệp Excel. Vui lòng thử lại.", "error");
  } finally {
    setActionAvailability(state);
  }
}

async function copyPreviousTimeline(view) {
  const state = timelineState(view);
  const pkg = state.package;
  const versions = [...(pkg?.allVersions || [])].sort((a, b) => Number(b.phienBan || 0) - Number(a.phienBan || 0));
  const currentIndex = versions.findIndex((version) => String(version.id) === String(pkg?.id));
  const previous = currentIndex >= 0 ? versions[currentIndex + 1] : null;
  if (!previous) {
    view.showToast("Cảnh báo", "Không có phiên bản trước để sao chép.", "warning");
    return;
  }
  const confirmed = await view.customConfirm(
    "Sao chép timeline",
    "Các mốc E-HSMT, mở thầu, đánh giá, kết quả và hợp đồng sẽ được đặt lại cho phiên bản hiện tại.",
    "copy"
  );
  if (!confirmed) return;
  const previousPackage = await fetchPackage(view, previous.id);
  state.rows = copyTimelineForNewVersion(mergeTimelineRows(
    previousPackage,
    findPlan(view, previousPackage),
    findContracts(view, previousPackage)
  ));
  const contracts = findContracts(view, pkg);
  state.rows = applyAutomaticTimelineSources(state.rows, pkg, state.plan, contracts);
  state.rows = applyTimelineApplicability(state.rows, pkg, state.plan, contracts);
  state.dirty = true;
  renderTimelineTable(view);
  updateLiveStatus("Đã sao chép từ phiên bản trước; hãy lưu thay đổi.");
}

function bindTimelineEvents(view, pane) {
  if (pane.dataset.eventsBound === "true") return;
  pane.dataset.eventsBound = "true";
  initTimelineComboboxes(view);
  element("timeline-plan-select")?.addEventListener("change", async () => {
    const state = timelineState(view);
    state.packageQuery = "";
    const packageSelect = element("timeline-package-select");
    if (packageSelect) packageSelect.value = "";
    await selectPackage(view, "");
    renderPackageOptions(view, [], "");
    await loadPackageOptions(view, "");
  });
  element("timeline-package-select")?.addEventListener("change", (event) => {
    timelineState(view).packageQuery = "";
    selectPackage(view, event.target.value);
  });
  element("timeline-version-select")?.addEventListener("change", (event) => selectPackage(view, event.target.value));
  element("timeline-status-filter")?.addEventListener("change", (event) => {
    timelineState(view).filters.status = event.target.value;
    renderTimelineTable(view);
  });
  element("timeline-table-body")?.addEventListener("change", (event) => {
    const control = event.target.closest("[data-timeline-field]");
    if (control) updateRowFromControl(view, control);
  });
  element("timeline-table-body")?.addEventListener("click", (event) => {
    const appraisalButton = event.target.closest("[data-appraisal-action]");
    if (appraisalButton) {
      resolveEhsmtAppraisalConflict(view);
      return;
    }
    const adjustmentButton = event.target.closest("[data-adjustment-action]");
    if (adjustmentButton) {
      const state = timelineState(view);
      const row = state.rows.find((item) => item.id === adjustmentButton.closest("tr")?.dataset.entryId);
      if (row && adjustmentButton.dataset.adjustmentAction === "remove") removeEhsmtAdjustment(view, row);
      return;
    }
    const button = event.target.closest("[data-source-action]");
    if (!button) return;
    const state = timelineState(view);
    const entryId = button.closest("tr[data-entry-id]")?.dataset.entryId;
    const row = state.rows.find((item) => item.id === entryId);
    if (!row) return;
    row.sourceMode = button.dataset.sourceAction === "restore" || row.sourceMode === "MANUAL" ? "AUTO" : "MANUAL";
    state.rows = applyAutomaticTimelineSources(state.rows, state.package, state.plan, findContracts(view, state.package));
    state.dirty = true;
    renderTimelineTable(view);
  });
  element("timeline-refresh-auto")?.addEventListener("click", () => {
    const state = timelineState(view);
    state.rows = applyAutomaticTimelineSources(state.rows, state.package, state.plan, findContracts(view, state.package));
    state.dirty = true;
    renderTimelineTable(view);
    updateLiveStatus("Đã làm mới các mốc tự động; hãy lưu thay đổi.");
  });
  element("timeline-save")?.addEventListener("click", () => saveTimeline(view));
  element("timeline-export-excel")?.addEventListener("click", () => exportTimeline(view));
  element("timeline-copy-previous")?.addEventListener("click", () => copyPreviousTimeline(view));
}

export function suspendPackageTimeline() {
  const state = this?._packageTimelineState;
  if (!state) return null;
  clearTimeout(state.packageSearchTimer);
  state.loading = false;
  state.restoringSelection = false;
  state.selectionRequestVersion = Number(state.selectionRequestVersion || 0) + 1;
  state.optionsRequestVersion = Number(state.optionsRequestVersion || 0) + 1;
  return state;
}

export function resetPackageTimeline() {
  const state = resetTimelineSession(this);
  const planSelect = element("timeline-plan-select");
  if (planSelect) {
    planSelect.value = "";
    renderPlanOptions(this);
    syncTimelineSelectValue(planSelect, "");
  }
  const packageSelect = element("timeline-package-select");
  if (packageSelect) {
    packageSelect.innerHTML = trustedHTML(`<option value="">Chọn kế hoạch trước</option>`);
    packageSelect.disabled = true;
    packageSelect.__bfAccessibleCombobox?.configure({ placeholder: "Chọn kế hoạch trước" });
    prepareTimelineSelect(packageSelect, "Chọn kế hoạch trước");
    syncTimelineSelectValue(packageSelect, "");
  }
  renderVersionOptions(null);
  const statusFilter = element("timeline-status-filter");
  if (statusFilter) {
    statusFilter.value = "";
    statusFilter.__bfAccessibleCombobox?.refresh();
  }
  const tbody = element("timeline-table-body");
  tbody?.querySelectorAll("input.flatpickr-date").forEach((input) => input._flatpickr?.destroy());
  if (tbody) tbody.innerHTML = trustedHTML("");
  setHidden("timeline-empty", false);
  setHidden("timeline-loading", true);
  setHidden("timeline-error", true);
  setHidden("timeline-table-wrap", true);
  setActionAvailability(state || { package: null });
  updateLiveStatus("");
}

export function renderPackageTimeline() {
  const pane = element("tab-goithau-timeline");
  if (!pane) return;
  const state = timelineState(this);
  bindTimelineEvents(this, pane);
  renderPlanOptions(this);
  const selectedPlanId = state.package?.keHoachId || state.plan?.id;
  if (state.package && !isTimelinePlanSelectable(this, selectedPlanId)) {
    resetPackageTimeline.call(this);
    return;
  }
  if (!state.package && !state.restoreAttempted) {
    state.restoreAttempted = true;
    const selection = readTimelineSelection(this.model);
    if (selection) {
      restoreTimelineSelection(this, selection);
      return;
    }
  }
  if (state.package && !state.dirty) {
    const refreshed = (this.model.state.goithau || []).find((pkg) => String(pkg.id) === String(state.package.id));
    if (refreshed) {
      state.package = refreshed;
      state.plan = findPlan(this, refreshed);
      state.rows = mergeTimelineRows(refreshed, state.plan, findContracts(this, refreshed));
    }
  }
  setActionAvailability(state);
  if (state.package) {
    renderTimelineTable(this);
  } else if (!state.loading && !state.restoringSelection && !state.packageOptions.length) {
    loadPackageOptions(this);
  }
}
