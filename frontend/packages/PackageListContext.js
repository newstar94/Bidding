const SESSION_KEY = "bf_package_list_context";
const FILTER_IDS = Object.freeze({
  status: "filter-goithau-trangthai",
  method: "filter-goithau-hinhthuc",
  year: "filter-goithau-nam",
  month: "filter-goithau-thang",
});
const ALLOWED_SORT_FIELDS = new Set([
  "maGoiThau", "phienBan", "tenGoiThau", "keHoachId", "giaGoiThau",
  "hinhThucLuaChon", "trangThai", "nhaThauTrungThauId",
]);
const ALERT_LABELS = Object.freeze({
  closingToday: "Đóng thầu hôm nay",
  closingSoon: "Sắp đóng thầu",
  overdueOpening: "Quá hạn mở thầu",
  delayedEvaluation: "Chậm báo cáo đánh giá",
});

function selectedValue(id) {
  return String(document.getElementById(id)?.value || "");
}

function validOptionValue(select, value, key = "") {
  if (!select || !value) return "";
  if ([...select.options].some((option) => option.value === value)) return value;
  if ((key === "year" && /^\d{4}$/.test(value))
    || (key === "month" && /^(?:[1-9]|1[0-2])$/.test(value))) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = key === "month" ? `Tháng ${value}` : value;
    select.add(option);
    return value;
  }
  return "";
}

export function capturePackageListContext(model, { includeSearch = true } = {}) {
  return {
    filters: Object.fromEntries(Object.entries(FILTER_IDS).map(([key, id]) => [key, selectedValue(id)])),
    ...(includeSearch ? { search: selectedValue("search-goithau") } : {}),
    sort: {
      field: model?.sortState?.goithau?.field || "maGoiThau",
      order: model?.sortState?.goithau?.order === "desc" ? "desc" : "asc",
    },
    page: Math.max(1, Number(model?.currentPage?.goithau) || 1),
    alertKey: String(model?.dashboardAlertFilter || ""),
  };
}

export function restorePackageListContext(model, context, { restoreSearch = true } = {}) {
  if (!context || typeof context !== "object") return false;
  for (const [key, id] of Object.entries(FILTER_IDS)) {
    const select = document.getElementById(id);
    if (select) select.value = validOptionValue(select, String(context.filters?.[key] || ""), key);
  }
  if (restoreSearch) {
    const search = document.getElementById("search-goithau");
    if (search) search.value = String(context.search || "");
  }
  const field = String(context.sort?.field || "");
  if (ALLOWED_SORT_FIELDS.has(field)) {
    model.sortState.goithau = {
      field,
      order: context.sort?.order === "desc" ? "desc" : "asc",
    };
  }
  model.currentPage.goithau = Math.max(1, Number(context.page) || 1);
  const alertKey = String(context.alertKey || "");
  model.dashboardAlertFilter = Object.hasOwn(ALERT_LABELS, alertKey) ? alertKey : "";
  model.dashboardAlertFilterLabel = ALERT_LABELS[model.dashboardAlertFilter] || "";
  return true;
}

export function rememberPackageListContext(model) {
  try {
    model?.workspaceSessionStorage?.writeJson(SESSION_KEY, capturePackageListContext(model));
  } catch {
    // Session storage may be unavailable; the current view remains usable.
  }
}

export function renderPackageFilterSummary(model) {
  const root = document.getElementById("goithau-active-filters");
  if (!root) return;
  const context = capturePackageListContext(model);
  const labels = [];
  if (context.search) labels.push("Từ khóa tìm kiếm");
  for (const [key, id] of Object.entries(FILTER_IDS)) {
    if (!context.filters[key]) continue;
    const select = document.getElementById(id);
    const label = select?.selectedOptions?.[0]?.textContent || context.filters[key];
    labels.push(label);
  }
  root.hidden = labels.length === 0;
  const summary = root.querySelector("span");
  if (summary) summary.textContent = labels.length ? `Đang lọc: ${labels.join(" · ")}` : "";
}
