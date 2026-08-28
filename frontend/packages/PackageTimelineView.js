import { trustedHTML } from "../shared/trustedTypes.js";
import { getAppController } from "../app/controllerRef.js";
import { appendExportSnapshotVersion } from "../shared/exportSnapshot.js";
import { getJson } from "../shared/apiClient.js";
import { loadPaginatedRecords } from "../shared/tableDataUtils.js";
import { authFetchDownload } from "../shared/workflow_helpers.js";
import { escapeHtml, safeAttr } from "../shared/view_helpers.js";
import { initAccessibleCombobox } from "../shared/accessibleCombobox.js";
import { cancelChunkedRender, renderChunkedSequence } from "../shared/ChunkedRenderer.js";
import {
  selectLatestVersion,
  selectLatestVersionsByRoot,
  sortVersionsDescending,
  versionNumber,
  versionRootId,
} from "../shared/versionResolver.js";
import {
  assertWorkspaceLeaseCurrent,
  beginWorkspaceRequest,
  finishWorkspaceRequest,
} from "../app/workspaceLease.js";
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
    initialPackage: null,
    plan: null,
    rows: [],
    lineageRows: [],
    displayRows: [],
    dateHistoryByMilestone: {},
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
    state.initialPackage = null;
    state.plan = null;
    state.rows = [];
    state.lineageRows = [];
    state.displayRows = [];
    state.dateHistoryByMilestone = {};
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

function timelineRuleContext(state) {
  return { initialPackage: state?.initialPackage || state?.package || null };
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

export function selectableTimelinePlans(view) {
  const packages = view.model.state.goithau || [];
  const currentPlans = (view.model.state.kehoach || [])
    .filter((plan) => plan.isLatest !== false && plan.isLatest !== 0 && !plan.archivedAt);
  return selectLatestVersionsByRoot(currentPlans)
    .filter((plan) => timelinePlanProgressStatus(plan.id, packages) !== "Hoàn thành");
}

function isTimelinePlanSelectable(view, planId) {
  return selectableTimelinePlans(view).some((plan) => String(plan.id) === String(planId));
}

export function findTimelineContracts(view, packageRecord) {
  const packageIds = new Set((view.model.state.goithau || [])
    .filter((pkg) => String(pkg.rootId || pkg.id) === String(packageRecord?.rootId || packageRecord?.id))
    .map((pkg) => String(pkg.id)));
  return (view.model.state.hopdong || []).filter((contract) => (
    Array.isArray(contract.goiThauIds)
    && contract.goiThauIds.some((id) => packageIds.has(String(id)))
  ));
}

const findContracts = findTimelineContracts;

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

export async function fetchTimelinePackage(view, id) {
  const local = (view.model.state.goithau || []).find((item) => String(item.id) === String(id));
  if (local?.timelineItems && local.referenceOnly !== true && local.hinhThucLuaChon !== undefined) return local;
  const request = beginWorkspaceRequest(view.model);
  try {
    const data = await getJson(`/api/record?table=goithau&lookup=${encodeURIComponent(id)}`, {
      signal: request.signal,
    });
    assertWorkspaceLeaseCurrent(view.model, request.lease);
    return data?.item ? cachePackage(view, data.item) : null;
  } finally {
    finishWorkspaceRequest(view.model, request);
  }
}

export async function fetchTimelinePlan(view, id) {
  if (!id) return null;
  const local = (view.model.state.kehoach || []).find((item) => String(item.id) === String(id));
  if (local?.referenceOnly !== true && local?.pheDuyet) return local;
  const request = beginWorkspaceRequest(view.model);
  try {
    const data = await getJson(`/api/record?table=kehoach&lookup=${encodeURIComponent(id)}`, {
      signal: request.signal,
    });
    assertWorkspaceLeaseCurrent(view.model, request.lease);
    return data?.item ? cachePlan(view, data.item) : local || null;
  } finally {
    finishWorkspaceRequest(view.model, request);
  }
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
  const selectedRootId = versionRootId(state.package);
  const selectedRepresentative = selectedRootId
    ? records.find((pkg) => versionRootId(pkg) === selectedRootId)
    : null;
  const selectedId = selectedRepresentative?.id || select.value;
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

export function timelinePackageRepresentatives(records = []) {
  return selectLatestVersionsByRoot(Array.isArray(records) ? records : []);
}

export function timelinePackageFamily(records = [], pkg = null) {
  if (!pkg?.id) return [];
  const rootId = versionRootId(pkg);
  const knownVersionIds = new Set(
    (Array.isArray(pkg.allVersions) ? pkg.allVersions : [])
      .map((version) => String(version?.id || ""))
      .filter(Boolean),
  );
  const byId = new Map();
  [
    ...(Array.isArray(pkg.allVersions) ? pkg.allVersions : []),
    ...(Array.isArray(records) ? records : []),
    pkg,
  ].forEach((candidate) => {
    if (!candidate?.id) return;
    const candidateId = String(candidate.id);
    const matchesFamily = candidateId === String(pkg.id)
      || knownVersionIds.has(candidateId)
      || versionRootId(candidate) === rootId
      || String(candidate.rootId || "") === rootId;
    if (!matchesFamily) return;
    const existing = byId.get(candidateId);
    byId.set(candidateId, existing ? { ...existing, ...candidate } : candidate);
  });
  return [...byId.values()].sort((left, right) => (
    versionNumber(left) - versionNumber(right)
    || String(left.id || "").localeCompare(String(right.id || ""))
  ));
}

export function timelineInitialPackageReference(records = [], pkg = null) {
  if (!pkg) return null;
  const rootId = versionRootId(pkg);
  const versionIds = new Set(
    (Array.isArray(pkg.allVersions) ? pkg.allVersions : [])
      .map((version) => String(version?.id || ""))
      .filter(Boolean),
  );
  const byId = new Map();
  [
    ...(Array.isArray(pkg.allVersions) ? pkg.allVersions : []),
    ...(Array.isArray(records) ? records : []),
    pkg,
  ].forEach((candidate) => {
    if (!candidate?.id) return;
    const existing = byId.get(String(candidate.id));
    byId.set(String(candidate.id), existing ? { ...candidate, ...existing } : candidate);
  });
  const family = [...byId.values()].filter((candidate) => (
    String(candidate.id) === String(pkg.id)
    || versionIds.has(String(candidate.id))
    || versionRootId(candidate) === rootId
    || String(candidate.rootId || "") === rootId
  ));
  const firstVersion = Math.min(...family.map(versionNumber));
  return selectLatestVersion(
    family.filter((candidate) => versionNumber(candidate) === firstVersion),
  ) || pkg;
}

async function fetchTimelineLineagePackages(view, pkg) {
  const references = timelinePackageFamily(view.model.state.goithau || [], pkg);
  const results = await Promise.allSettled(references.map((reference) => (
    fetchTimelinePackage(view, reference.id)
  )));
  const packages = results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
  return [...new Map(packages.map((item) => [String(item.id), item])).values()]
    .sort((left, right) => (
      versionNumber(left) - versionNumber(right)
      || String(left.id || "").localeCompare(String(right.id || ""))
    ));
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
    const representatives = timelinePackageRepresentatives(result.items);
    renderPackageOptions(view, representatives, search);
    updateLiveStatus(`Đã tìm thấy ${representatives.length} gói thầu.`);
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

function statusOptions(current) {
  return Object.entries(STATUS_LABELS).map(([value, label]) => (
    `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`
  )).join("");
}

function timelineMilestoneKey(row) {
  return String(row?.milestoneKey || row?.maMoc || "").trim();
}

function timelineDateRecords(row) {
  return ["ngayDuKien", "ngayThucTe"]
    .map((field) => ({ field, value: String(row?.[field] || "").trim() }))
    .filter((date) => Boolean(date.value));
}

export function buildTimelineLineagePresentation(currentRows = [], versionRows = []) {
  const current = Array.isArray(currentRows) ? currentRows : [];
  const currentKeys = new Set(current.map(timelineMilestoneKey).filter(Boolean));
  const datesByMilestone = new Map();
  const historicalRows = new Map();

  (Array.isArray(versionRows) ? versionRows : []).forEach((version) => {
    const packageId = String(version?.packageId || "").trim();
    (Array.isArray(version?.rows) ? version.rows : []).forEach((row) => {
      const milestoneKey = timelineMilestoneKey(row);
      const dates = timelineDateRecords(row);
      if (!milestoneKey || dates.length === 0) return;
      const milestones = datesByMilestone.get(milestoneKey) || new Map();
      dates.forEach((date) => milestones.set(`${date.field}\u0000${date.value}`, date));
      datesByMilestone.set(milestoneKey, milestones);
      if (!currentKeys.has(milestoneKey) && !historicalRows.has(milestoneKey)) {
        historicalRows.set(milestoneKey, {
          ...row,
          id: `history:${packageId || "package"}:${row.id || milestoneKey}`,
          isHistorical: true,
        });
      }
    });
  });

  const rows = [...current, ...historicalRows.values()].sort((left, right) => (
    Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
    || Number(Boolean(left.isHistorical)) - Number(Boolean(right.isHistorical))
    || String(left.id || "").localeCompare(String(right.id || ""))
  ));
  const dateHistoryByMilestone = Object.fromEntries(
    [...datesByMilestone.entries()].map(([milestoneKey, values]) => [
      milestoneKey,
      [...values.values()].sort((left, right) => (
        String(left.value).localeCompare(String(right.value))
        || left.field.localeCompare(right.field)
      )),
    ]),
  );
  return { rows, dateHistoryByMilestone };
}

function refreshTimelineLineagePresentation(state) {
  const currentPackageId = String(state.package?.id || "");
  const versionRows = (state.lineageRows || []).map((version) => (
    String(version.packageId) === currentPackageId
      ? { ...version, rows: state.rows }
      : version
  ));
  const presentation = buildTimelineLineagePresentation(state.rows, versionRows);
  state.displayRows = presentation.rows;
  state.dateHistoryByMilestone = presentation.dateHistoryByMilestone;
}

function renderTimelineDateHistory(state, row, dateBinding) {
  const history = state.dateHistoryByMilestone?.[timelineMilestoneKey(row)] || [];
  const additionalDates = history.filter((date) => (
    date.field !== dateBinding.field || date.value !== dateBinding.value
  ));
  if (!additionalDates.length) return "";
  return `<span class="timeline-date-history">${additionalDates.map((date) => {
    const label = date.field === "ngayThucTe" ? "Thực tế" : "Dự kiến";
    return `<span>${label}: ${escapeHtml(formatTimelineDate(date.value) || date.value)}</span>`;
  }).join("")}</span>`;
}

function filteredRows(state) {
  const rows = Array.isArray(state.displayRows) ? state.displayRows : state.rows;
  return rows.filter((row) => {
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
  const rows = filteredRows(state);
  let activeGroup = "";
  const html = [];
  rows.forEach((row) => {
    if (row.sectionKey !== activeGroup) {
      activeGroup = row.sectionKey;
      html.push(`<tr class="timeline-group-row"><th scope="rowgroup">${escapeHtml(row.displayGroupCode || row.maNhom)}</th><th colspan="6">${escapeHtml(row.tenNhom)}</th></tr>`);
    }
    const overdue = timelineIsOverdue(row);
    const disabled = editable && !row.isHistorical ? "" : " disabled";
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
      <tr class="timeline-item-row${overdue ? " is-overdue" : ""}${conditional ? " is-conditional" : ""}${row.isHistorical ? " is-history" : ""}" data-entry-id="${safeAttr(row.id)}">
        <th scope="row" title="Mã mốc nghiệp vụ ${safeAttr(row.milestoneKey || row.maMoc)}">${escapeHtml(displayCode)}</th>
        <td><span class="timeline-work-title">${escapeHtml(row.congViec)}</span>${conditional ? `<span class="timeline-conditional" title="${safeAttr(row.applicabilityReason)}">${escapeHtml(conditionalLabel)}</span>` : ""}</td>
        <td><input type="text" data-timeline-field="donViBanHanh" value="${safeAttr(row.donViBanHanh)}" maxlength="300" aria-label="Đơn vị ban hành mốc ${safeAttr(row.maMoc)}"${disabled}></td>
        <td><input type="text" data-timeline-field="soVanBan" value="${safeAttr(row.soVanBan)}" maxlength="300" aria-label="Số văn bản mốc ${safeAttr(row.maMoc)}"${disabled}></td>
        <td class="timeline-time-cell"><input type="text" class="flatpickr-date" data-timeline-field="${dateBinding.field}" value="${safeAttr(formatTimelineDate(dateBinding.value))}" placeholder="dd/MM/yyyy" aria-label="${dateBinding.label} mốc ${safeAttr(row.maMoc)}"${disabled}>${renderTimelineDateHistory(state, row, dateBinding)}</td>
        <td><select data-timeline-field="trangThai" aria-label="Trạng thái mốc ${safeAttr(row.maMoc)}"${disabled}>${statusOptions(row.trangThai)}</select>${overdue ? `<span class="timeline-overdue-label"><i data-lucide="alert-triangle"></i> Quá hạn</span>` : ""}</td>
        <td><button type="button" class="timeline-source-badge ${row.sourceMode === "AUTO" ? "is-auto" : "is-manual"}" data-source-action="toggle" aria-label="Chuyển nguồn mốc ${safeAttr(row.milestoneKey || row.maMoc)}"${disabled}>${sourceLabel}</button>${row.sourceKey && row.sourceMode === "MANUAL" ? `<button type="button" class="timeline-restore-source" data-source-action="restore" title="Khôi phục dữ liệu hệ thống" aria-label="Khôi phục dữ liệu hệ thống mốc ${safeAttr(row.milestoneKey || row.maMoc)}"${disabled}><i data-lucide="rotate-ccw"></i></button>` : ""}${appraisalConflictControl}${adjustmentControls}</td>
      </tr>`);
  });
  if (!html.length) html.push(`<tr><td colspan="7" class="timeline-no-results">Không có mốc phù hợp với bộ lọc.</td></tr>`);
  const focused = tbody.contains?.(globalThis.document?.activeElement)
    ? globalThis.document.activeElement
    : null;
  const focusState = focused?.closest?.("tr[data-entry-id]") ? {
    entryId: focused.closest("tr[data-entry-id]").dataset.entryId,
    field: focused.dataset?.timelineField || "",
    selectionStart: focused.selectionStart,
    selectionEnd: focused.selectionEnd,
  } : null;
  tbody.querySelectorAll("input.flatpickr-date").forEach((input) => input._flatpickr?.destroy());
  tbody.innerHTML = trustedHTML("");
  tbody.setAttribute?.("aria-busy", "true");
  const tableWrap = element("timeline-table-wrap");
  const renderPromise = renderChunkedSequence(tbody, html, (chunk) => {
    tbody.insertAdjacentHTML("beforeend", trustedHTML(chunk.join("")));
  }, {
    chunkSize: 10,
    budgetMs: 12,
    onComplete: ({ cancelled }) => {
      if (cancelled) return;
      tbody.setAttribute?.("aria-busy", "false");
      view.initFlatpickr(tbody);
      view.createIconsScoped(tableWrap);
      if (focusState) {
        const row = [...tbody.querySelectorAll?.("tr[data-entry-id]") || []]
          .find((candidate) => candidate.dataset.entryId === focusState.entryId);
        const control = [...row?.querySelectorAll?.("[data-timeline-field]") || []]
          .find((candidate) => candidate.dataset.timelineField === focusState.field);
        control?.focus?.({ preventScroll: true });
        if (
          typeof control?.setSelectionRange === "function"
          && Number.isInteger(focusState.selectionStart)
          && Number.isInteger(focusState.selectionEnd)
        ) {
          control.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
        }
      }
    },
  });
  void renderPromise.catch((error) => {
    tbody.setAttribute?.("aria-busy", "false");
    console.error("Không thể hiển thị timeline theo từng phần:", error);
    const errorBox = element("timeline-error");
    if (errorBox) {
      errorBox.textContent = "Không thể hiển thị timeline. Vui lòng thử làm mới.";
      errorBox.hidden = false;
    }
  });
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
  state.rows = mergeTimelineRows(
    state.package,
    state.plan,
    findContracts(view, state.package),
    timelineRuleContext(state),
  );
  refreshTimelineLineagePresentation(state);
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
  state.rows = mergeTimelineRows(
    state.package,
    state.plan,
    findContracts(view, state.package),
    timelineRuleContext(state),
  );
  refreshTimelineLineagePresentation(state);
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
    state.initialPackage = null;
    state.plan = null;
    state.rows = [];
    state.lineageRows = [];
    state.displayRows = [];
    state.dateHistoryByMilestone = {};
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
    const requestedPackage = await fetchTimelinePackage(view, packageId);
    if (!isCurrentTimelineRequest(view, state, "selectionRequestVersion", requestVersion)) return;
    if (!requestedPackage) throw new Error("Không tìm thấy gói thầu đã chọn.");
    const lineagePackages = await fetchTimelineLineagePackages(view, requestedPackage);
    if (!isCurrentTimelineRequest(view, state, "selectionRequestVersion", requestVersion)) return;
    const pkg = selectLatestVersion(lineagePackages) || requestedPackage;
    state.package = pkg;
    const initialReference = timelineInitialPackageReference(lineagePackages, pkg) || pkg;
    state.initialPackage = lineagePackages.find(
      (version) => String(version.id) === String(initialReference.id),
    ) || initialReference;
    const selectedPlan = await fetchTimelinePlan(view, pkg.keHoachId);
    if (!isCurrentTimelineRequest(view, state, "selectionRequestVersion", requestVersion)) return;
    state.plan = selectedPlan || findPlan(view, pkg);
    const lineageRows = await Promise.all(lineagePackages.map(async (version) => {
      let plan = state.plan;
      if (String(version.keHoachId || "") !== String(pkg.keHoachId || "")) {
        try {
          plan = await fetchTimelinePlan(view, version.keHoachId);
        } catch {
          plan = findPlan(view, version);
        }
      }
      return {
        packageId: version.id,
        rows: mergeTimelineRows(
          version,
          plan || {},
          findContracts(view, version),
          timelineRuleContext(state),
        ),
      };
    }));
    if (!isCurrentTimelineRequest(view, state, "selectionRequestVersion", requestVersion)) return;
    state.lineageRows = lineageRows;
    state.rows = lineageRows.find(
      (version) => String(version.packageId) === String(pkg.id),
    )?.rows || mergeTimelineRows(
      pkg,
      state.plan,
      findContracts(view, pkg),
      timelineRuleContext(state),
    );
    refreshTimelineLineagePresentation(state);
    state.dirty = false;
    saveTimelineSelection(view.model, {
      planId: pkg.keHoachId || state.plan?.id,
      packageId: pkg.id
    });
    setHidden("timeline-table-wrap", false);
    renderTimelineTable(view);
    setActionAvailability(state);
    const applicableCount = state.rows.filter((row) => row.applicability === "APPLICABLE").length;
    updateLiveStatus("Đã tải " + applicableCount + " mốc áp dụng và tổng hợp thời gian lịch sử của gói " + (pkg.maGoiThau || "") + ".");
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

    const selectedRootId = versionRootId(state.package);
    let selectedRepresentative = state.packageOptions.find(
      (pkg) => versionRootId(pkg) === selectedRootId,
    );
    if (!selectedRepresentative) {
      renderPackageOptions(view, [state.package, ...state.packageOptions], "");
      selectedRepresentative = state.package;
    }
    const packageSelect = element("timeline-package-select");
    syncTimelineSelectValue(packageSelect, selectedRepresentative.id);
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
  refreshTimelineLineagePresentation(state);
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
    const packageRecord = {
      ...state.package,
      timelineItems: preserveHiddenTimelineRows(state.package.timelineItems, persistedRows),
    };
    await view.model.updateRecord("goithau", packageRecord);
    state.package = view.model.state.goithau.find(
      (item) => String(item.id) === String(packageRecord.id),
    ) || packageRecord;
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
  const versions = sortVersionsDescending(pkg?.allVersions || []);
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
  const previousPackage = await fetchTimelinePackage(view, previous.id);
  state.rows = copyTimelineForNewVersion(mergeTimelineRows(
    previousPackage,
    findPlan(view, previousPackage),
    findContracts(view, previousPackage),
    timelineRuleContext(state),
  ));
  const contracts = findContracts(view, pkg);
  state.rows = applyAutomaticTimelineSources(
    state.rows, pkg, state.plan, contracts, timelineRuleContext(state),
  );
  state.rows = applyTimelineApplicability(
    state.rows, pkg, state.plan, contracts, timelineRuleContext(state),
  );
  refreshTimelineLineagePresentation(state);
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
    state.rows = applyAutomaticTimelineSources(
      state.rows,
      state.package,
      state.plan,
      findContracts(view, state.package),
      timelineRuleContext(state),
    );
    refreshTimelineLineagePresentation(state);
    state.dirty = true;
    renderTimelineTable(view);
  });
  element("timeline-refresh-auto")?.addEventListener("click", () => {
    const state = timelineState(view);
    state.rows = applyAutomaticTimelineSources(
      state.rows,
      state.package,
      state.plan,
      findContracts(view, state.package),
      timelineRuleContext(state),
    );
    refreshTimelineLineagePresentation(state);
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
  const statusFilter = element("timeline-status-filter");
  if (statusFilter) {
    statusFilter.value = "";
    statusFilter.__bfAccessibleCombobox?.refresh();
  }
  const tbody = element("timeline-table-body");
  if (tbody) cancelChunkedRender(tbody);
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
      state.rows = mergeTimelineRows(
        refreshed,
        state.plan,
        findContracts(this, refreshed),
        timelineRuleContext(state),
      );
      refreshTimelineLineagePresentation(state);
    }
  }
  setActionAvailability(state);
  if (state.package) {
    renderTimelineTable(this);
  } else if (!state.loading && !state.restoringSelection && !state.packageOptions.length) {
    loadPackageOptions(this);
  }
}
