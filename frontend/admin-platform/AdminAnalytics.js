import { getAdminJson } from "./AdminApi.js";
import { createLatestAdminLoader } from "./AdminDirectory.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminFailure,
  renderAdminMarkup,
} from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const NUMBER_FORMAT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const MAX_ROWS = 100;
const MAX_CHARTS = 16;
const MAX_SERIES = 8;
const MAX_POINTS = 100;

export const ANALYTICS_VIEWS = Object.freeze([
  ["overview", "Tổng quan"],
  ["activation", "Kích hoạt"],
  ["features", "Tính năng"],
  ["seats", "Chỗ ngồi"],
  ["procurement", "Mua sắm công"],
  ["credits", "Tín dụng"],
  ["funnel", "Phễu chuyển đổi"],
  ["retention", "Duy trì"],
  ["economics", "Hiệu quả kinh tế"],
  ["plan-fit", "Mức độ phù hợp gói"],
]);

export const ANALYTICS_PRESETS = Object.freeze([
  ["7d", "7 ngày"],
  ["30d", "30 ngày"],
  ["90d", "90 ngày"],
  ["year", "Năm nay"],
  ["custom", "Tùy chỉnh"],
]);

const VIEW_KEYS = new Set(ANALYTICS_VIEWS.map(([key]) => key));
const PRESET_KEYS = new Set(ANALYTICS_PRESETS.map(([key]) => key));
const STATUS_LABELS = Object.freeze({
  available: "Có dữ liệu",
  insufficient_sample: "Không đủ mẫu",
  not_available: "Chưa có dữ liệu",
  not_configured: "Chưa cấu hình",
});
const TABLE_FIELDS = Object.freeze([
  ["metric", "Chỉ số"], ["segment", "Phân khúc"], ["feature", "Tính năng"],
  ["stage", "Giai đoạn"], ["cohort", "Nhóm"], ["cohortKind", "Loại nhóm"],
  ["cohort_kind", "Loại nhóm"], ["weekNumber", "Tuần"], ["week_number", "Tuần"],
  ["plan", "Gói"], ["plan_code", "Gói"], ["variant", "Biến thể"],
  ["classification", "Phân loại"], ["snapshot_month", "Tháng"],
  ["sizeBucket", "Quy mô"], ["size_bucket", "Quy mô"], ["currentTier", "Bậc hiện tại"],
  ["packSize", "Kích thước gói"], ["value", "Giá trị"],
  ["workspaceCount", "Không gian làm việc"], ["uniqueWorkspaces", "Không gian duy nhất"],
  ["eventCount", "Sự kiện"], ["activeUsers", "Người dùng hoạt động"],
  ["adoptionRate", "Tỷ lệ sử dụng"], ["retainedWorkspaces", "Không gian duy trì"],
  ["retentionRate", "Tỷ lệ duy trì"], ["conversionRate", "Tỷ lệ chuyển đổi"],
  ["purchaseCount", "Lượt mua"], ["creditsPurchased", "Tín dụng đã mua"],
  ["unusedCredits", "Tín dụng chưa dùng"], ["revenueVnd", "Doanh thu (VND)"],
  ["netRevenueVnd", "Doanh thu ròng (VND)"], ["variableCostVnd", "Chi phí biến đổi (VND)"],
  ["contributionMarginVnd", "Biên đóng góp (VND)"], ["contributionMarginRate", "Tỷ lệ biên đóng góp"],
  ["utilization", "Mức sử dụng"], ["workspace_count", "Không gian làm việc"],
  ["active_seats", "Chỗ ngồi hoạt động"], ["seat_utilization", "Mức sử dụng chỗ ngồi"],
  ["procurement_usage", "Mức dùng mua sắm công"], ["quota_utilization", "Mức dùng hạn mức"],
  ["topup_spend_vnd", "Chi phí mua thêm (VND)"], ["repeat_topups", "Mua thêm lặp lại"],
  ["connected_feature_days", "Ngày dùng tính năng kết nối"], ["workflow_volume", "Khối lượng quy trình"],
  ["workflow_depth", "Độ sâu quy trình"], ["export_intensity", "Mức xuất tài liệu"],
  ["ai_intensity", "Mức dùng AI"], ["estimated_cost_vnd", "Chi phí ước tính (VND)"],
  ["cost_status", "Trạng thái chi phí"], ["revenue_status", "Trạng thái doanh thu"],
  ["price_gap_to_connected_vnd", "Chênh lệch giá kết nối (VND)"],
  ["days_to_break_even", "Số ngày hòa vốn"], ["rule_version", "Phiên bản quy tắc"],
  ["status", "Trạng thái"],
]);

function validDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function referenceDay(value) {
  if (typeof value === "string" && validDate(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const date = value instanceof Date ? new Date(value.valueOf()) : new Date();
  if (Number.isNaN(date.valueOf())) throw new TypeError("Ngày tham chiếu không hợp lệ.");
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function analyticsPresetRange(preset, referenceDate = new Date()) {
  const key = PRESET_KEYS.has(preset) ? preset : "custom";
  if (key === "custom") return null;
  const to = referenceDay(referenceDate);
  const from = new Date(to.valueOf());
  if (key === "year") from.setMonth(0, 1);
  else from.setDate(from.getDate() - ({ "7d": 6, "30d": 29, "90d": 89 })[key]);
  return { from: localIsoDate(from), to: localIsoDate(to) };
}

export function normalizeAnalyticsFilters(values = {}, { referenceDate } = {}) {
  const rawFrom = String(values.from || "").trim();
  const rawTo = String(values.to || "").trim();
  const requestedPreset = String(values.preset || "").trim();
  const preset = PRESET_KEYS.has(requestedPreset)
    ? requestedPreset
    : (rawFrom || rawTo ? "custom" : "30d");
  const presetRange = analyticsPresetRange(preset, referenceDate);
  const from = presetRange?.from ?? rawFrom;
  const to = presetRange?.to ?? rawTo;
  const bucket = values.bucket === "hour" ? "hour" : "day";
  const view = VIEW_KEYS.has(values.view) ? values.view : "overview";
  if (from && !validDate(from)) throw new TypeError("Ngày bắt đầu không hợp lệ.");
  if (to && !validDate(to)) throw new TypeError("Ngày kết thúc không hợp lệ.");
  if (from && to && from > to) throw new TypeError("Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.");
  return { from, to, bucket, view, preset };
}

export function buildAnalyticsQueries(filters) {
  const normalized = normalizeAnalyticsFilters(filters);
  const range = Object.fromEntries([
    ["from", normalized.from], ["to", normalized.to], ["bucket", normalized.bucket],
  ].filter(([, value]) => value !== ""));
  return {
    usage: range,
    product: Object.fromEntries([
      ["from", normalized.from], ["to", normalized.to], ["view", normalized.view],
    ].filter(([, value]) => value !== "")),
  };
}

function readInitialFilters() {
  const params = new URLSearchParams(globalThis.location?.search || "");
  try {
    return normalizeAnalyticsFilters(Object.fromEntries(params.entries()));
  } catch {
    return normalizeAnalyticsFilters();
  }
}

function displayNumber(value) {
  return Number.isFinite(value) ? NUMBER_FORMAT.format(value) : "N/A";
}

function displayValue(value, status = "") {
  if (status === "insufficient_sample" || value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "number") return displayNumber(value);
  if (typeof value === "boolean") return value ? "Có" : "Không";
  return STATUS_LABELS[value] || String(value);
}

function usageSummary(payload) {
  const root = payload?.summary || payload?.data?.summary || payload?.data || payload || {};
  const coverage = root.coverage || {};
  return {
    hasData: coverage.hasData ?? coverage.has_data ?? null,
    onlineNow: root.onlineNow ?? root.online_now ?? null,
    activeUsers: root.activeUsers ?? root.active_users ?? null,
    workActivityCount: root.workActivityCount ?? root.work_activity_count ?? null,
    wordExportCount: root.wordExportCount ?? root.word_export_count ?? null,
    topFeatures: Array.isArray(root.topFeatures) ? root.topFeatures : (Array.isArray(root.top_features) ? root.top_features : []),
  };
}

function productDashboard(payload) {
  return payload?.dashboard && typeof payload.dashboard === "object" ? payload.dashboard : {};
}

function metricCard(label, value) {
  return `<div class="col-sm-6 col-xl-3"><article class="card bf-admin-metric"><div class="card-body"><div class="text-secondary">${escapeHtml(label)}</div><div class="h1 mb-0">${escapeHtml(displayNumber(value))}</div></div></article></div>`;
}

function productKpisMarkup(kpis) {
  if (!kpis.length) return adminStateMarkup("empty", { message: "Chưa có chỉ số sản phẩm trong khoảng thời gian này." });
  const rows = kpis.slice(0, MAX_ROWS).map((kpi) => `<tr><td>${escapeHtml(kpi?.label || kpi?.key || "N/A")}</td><td class="text-end">${escapeHtml(displayNumber(kpi?.value))}</td><td class="text-end">${escapeHtml(displayNumber(kpi?.change))}</td></tr>`).join("");
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Chỉ số</th><th class="text-end">Giá trị</th><th class="text-end">Thay đổi</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function featureMarkup(features) {
  if (!features.length) return adminStateMarkup("empty", { message: "Chưa có dữ liệu sử dụng tính năng." });
  const rows = features.slice(0, MAX_ROWS).map((feature) => `<tr><td>${escapeHtml(feature?.label || feature?.feature || feature?.key || "N/A")}</td><td class="text-end">${escapeHtml(displayNumber(feature?.count))}</td><td class="text-end">${escapeHtml(displayNumber(feature?.uniqueUsers ?? feature?.unique_users))}</td></tr>`).join("");
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Tính năng</th><th class="text-end">Lượt dùng</th><th class="text-end">Người dùng</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function seriesVisualMarkup(points, label, headingId) {
  const numeric = points
    .map((point, index) => ({ index, value: Number.isFinite(point?.value) ? point.value : null }))
    .filter((point) => point.value !== null);
  if (!numeric.length) return "";
  const values = numeric.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const x = (index) => points.length <= 1 ? 50 : 4 + (index / (points.length - 1)) * 92;
  const y = (value) => 35 - ((value - minimum) / range) * 29;
  const coordinates = numeric.map((point) => `${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`);
  const visual = numeric.length === 1
    ? `<circle cx="${x(numeric[0].index).toFixed(2)}" cy="${y(numeric[0].value).toFixed(2)}" r="2.5" fill="currentColor"></circle>`
    : `<polyline points="${coordinates.join(" ")}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></polyline>${numeric.map((point) => `<circle cx="${x(point.index).toFixed(2)}" cy="${y(point.value).toFixed(2)}" r="1.4" fill="currentColor"></circle>`).join("")}`;
  const description = `${label}: ${numeric.length} điểm có dữ liệu; nhỏ nhất ${displayNumber(minimum)}, lớn nhất ${displayNumber(maximum)}.`;
  return `<div class="px-3 pt-3"><svg class="w-100 text-primary" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-labelledby="${headingId}" aria-label="${escapeHtml(description)}"><line x1="4" y1="35" x2="96" y2="35" stroke="currentColor" opacity="0.2" vector-effect="non-scaling-stroke"></line>${visual}</svg></div>`;
}

function seriesTableMarkup(series, chartIndex, seriesIndex) {
  const points = Array.isArray(series?.points) ? series.points.slice(0, MAX_POINTS) : [];
  const headingId = `admin-chart-${chartIndex}-${seriesIndex}`;
  const label = series?.label || series?.key || `Chuỗi ${seriesIndex + 1}`;
  if (!points.length) {
    return `<section class="card-body border-top" aria-labelledby="${headingId}"><h4 class="h4" id="${headingId}">${escapeHtml(label)}</h4>${adminStateMarkup("empty", { message: "Chưa có điểm dữ liệu." })}</section>`;
  }
  const rows = points.map((point) => {
    const dimension = point?.date || point?.label || "N/A";
    return `<tr><td>${escapeHtml(dimension)}</td><td class="text-end">${escapeHtml(displayValue(point?.value, point?.status))}</td><td>${escapeHtml(STATUS_LABELS[point?.status] || point?.status || "")}</td></tr>`;
  }).join("");
  return `<section class="card-body border-top" aria-labelledby="${headingId}"><h4 class="h4" id="${headingId}">${escapeHtml(label)}</h4>${seriesVisualMarkup(points, label, headingId)}<div class="table-responsive mt-2"><table class="table table-sm table-vcenter mb-0"><caption class="visually-hidden">Dữ liệu dạng bảng cho ${escapeHtml(label)}</caption><thead><tr><th>Thời điểm / nhóm</th><th class="text-end">Giá trị</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function chartMarkup(chart, chartIndex) {
  const chartId = `admin-chart-${chartIndex}`;
  const series = Array.isArray(chart?.series) ? chart.series.slice(0, MAX_SERIES) : [];
  const body = series.length
    ? series.map((item, seriesIndex) => seriesTableMarkup(item, chartIndex, seriesIndex)).join("")
    : adminStateMarkup("empty", { message: "Chưa có chuỗi dữ liệu cho biểu đồ này." });
  return `<div class="col-12 col-xl-6"><article class="card h-100" aria-labelledby="${chartId}"><div class="card-header"><h3 class="card-title" id="${chartId}">${escapeHtml(chart?.label || chart?.key || "Biểu đồ")}</h3></div>${body}</article></div>`;
}

function chartsMarkup(product) {
  const baseCharts = (Array.isArray(product.series) ? product.series : []).map((series) => ({
    key: series?.key, label: series?.label, series: [series],
  }));
  const viewCharts = Array.isArray(product.viewCharts) ? product.viewCharts : [];
  const charts = [...baseCharts, ...viewCharts].slice(0, MAX_CHARTS);
  if (!charts.length) return "";
  return `<section class="mt-3" aria-labelledby="admin-product-charts"><h2 class="h3 mb-3" id="admin-product-charts">Xu hướng và phân bố</h2><div class="row row-cards">${charts.map(chartMarkup).join("")}</div></section>`;
}

function genericTableMarkup(rows, emptyMessage) {
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object").slice(0, MAX_ROWS) : [];
  const fields = TABLE_FIELDS.filter(([key]) => safeRows.some((row) => Object.hasOwn(row, key)));
  if (!safeRows.length || !fields.length) return adminStateMarkup("empty", { message: emptyMessage });
  const head = fields.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = safeRows.map((row) => `<tr>${fields.map(([key]) => {
    const status = typeof row[key] === "string" ? "" : row.status;
    return `<td>${escapeHtml(displayValue(row[key], status))}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function sameRows(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((row, index) => JSON.stringify(row) === JSON.stringify(right[index]));
}

function detailTablesMarkup(product) {
  const table = Array.isArray(product.table) ? product.table : [];
  const segments = Array.isArray(product.segments) ? product.segments : [];
  const sections = [];
  if (segments.length && !sameRows(segments, table)) {
    sections.push(`<div class="col-12"><section class="card" aria-labelledby="admin-product-segments"><div class="card-header"><h3 class="card-title" id="admin-product-segments">Phân khúc</h3></div>${genericTableMarkup(segments, "Chưa có dữ liệu phân khúc.")}</section></div>`);
  }
  if (table.length) {
    sections.push(`<div class="col-12"><section class="card" aria-labelledby="admin-product-table"><div class="card-header"><h3 class="card-title" id="admin-product-table">Chi tiết</h3></div>${genericTableMarkup(table, "Chưa có dữ liệu chi tiết.")}</section></div>`);
  }
  return sections.length ? `<div class="row row-cards mt-1">${sections.join("")}</div>` : "";
}

export function analyticsResultsMarkup(usagePayload, productPayload) {
  const usage = usageSummary(usagePayload);
  const product = productDashboard(productPayload);
  const kpis = Array.isArray(product.kpis) ? product.kpis : [];
  if (usage.hasData === false && product.hasData === false) {
    return adminStateMarkup("empty", { message: product.message || "Chưa có dữ liệu phân tích trong khoảng thời gian này." });
  }
  return `<div class="row row-cards">${metricCard("Đang trực tuyến", usage.onlineNow)}${metricCard("Người dùng hoạt động", usage.activeUsers)}${metricCard("Hoạt động công việc", usage.workActivityCount)}${metricCard("Lượt xuất Word", usage.wordExportCount)}</div><div class="row row-cards mt-1"><div class="col-12 col-xl-6"><section class="card h-100" aria-labelledby="admin-product-kpis"><div class="card-header"><h3 class="card-title" id="admin-product-kpis">Chỉ số sản phẩm</h3></div>${productKpisMarkup(kpis)}</section></div><div class="col-12 col-xl-6"><section class="card h-100" aria-labelledby="admin-top-features"><div class="card-header"><h3 class="card-title" id="admin-top-features">Tính năng được sử dụng</h3></div>${featureMarkup(usage.topFeatures)}</section></div></div>${chartsMarkup(product)}${detailTablesMarkup(product)}`;
}

export function analyticsFilterMarkup(filters) {
  const buttons = ANALYTICS_PRESETS.map(([key, label]) => `<button class="btn btn-outline-primary${filters.preset === key ? " active" : ""}" type="button" data-analytics-preset="${key}" aria-pressed="${filters.preset === key}">${escapeHtml(label)}</button>`).join("");
  const options = ANALYTICS_VIEWS.map(([key, label]) => `<option value="${key}"${filters.view === key ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  return `<form class="card card-body mb-3" data-admin-analytics-form><div class="mb-3"><span class="form-label" id="admin-analytics-preset-label">Khoảng thời gian</span><div class="btn-group flex-wrap" role="group" aria-labelledby="admin-analytics-preset-label">${buttons}</div><input type="hidden" name="preset" value="${escapeHtml(filters.preset)}" data-admin-analytics-preset-value></div><div class="row g-2 align-items-end"><div class="col-12 col-md"><label class="form-label" for="admin-analytics-from">Từ ngày</label><input class="form-control" id="admin-analytics-from" name="from" type="date" value="${escapeHtml(filters.from)}"></div><div class="col-12 col-md"><label class="form-label" for="admin-analytics-to">Đến ngày</label><input class="form-control" id="admin-analytics-to" name="to" type="date" value="${escapeHtml(filters.to)}"></div><div class="col-12 col-md"><label class="form-label" for="admin-analytics-bucket">Độ chi tiết</label><select class="form-select" id="admin-analytics-bucket" name="bucket"><option value="day"${filters.bucket === "day" ? " selected" : ""}>Theo ngày</option><option value="hour"${filters.bucket === "hour" ? " selected" : ""}>Theo giờ</option></select></div><div class="col-12 col-md"><label class="form-label" for="admin-analytics-view">Chế độ xem</label><select class="form-select" id="admin-analytics-view" name="view">${options}</select></div><div class="col-12 col-md-auto"><button class="btn btn-primary w-100" type="submit">Áp dụng</button></div></div><p class="text-danger small mt-2 mb-0" data-admin-analytics-validation role="alert" hidden></p></form><div data-admin-analytics-results aria-live="polite"></div>`;
}

function syncBrowserQuery(filters) {
  if (!globalThis.history?.replaceState || !globalThis.location) return;
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ""));
  globalThis.history.replaceState(globalThis.history.state, "", `${globalThis.location.pathname}?${params}`);
}

function syncFilterControls(form, filters) {
  const presetInput = form.querySelector("[data-admin-analytics-preset-value]");
  if (presetInput) presetInput.value = filters.preset;
  for (const button of form.querySelectorAll("[data-analytics-preset]")) {
    const active = button.dataset.analyticsPreset === filters.preset;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("active", active);
  }
  const from = form.elements.namedItem("from");
  const to = form.elements.namedItem("to");
  if (from) from.value = filters.from;
  if (to) to.value = filters.to;
}

export function renderAdminAnalytics(container, { fetchImpl, signal } = {}) {
  let filters = readInitialFilters();
  const loader = createLatestAdminLoader();
  renderAdminMarkup(container, analyticsFilterMarkup(filters));
  const form = container.querySelector("[data-admin-analytics-form]");
  const results = container.querySelector("[data-admin-analytics-results]");
  const validation = container.querySelector("[data-admin-analytics-validation]");
  const load = async () => {
    validation.hidden = true;
    syncBrowserQuery(filters);
    renderAdminMarkup(results, adminLoadingMarkup("Đang tải dữ liệu phân tích…"), { busy: true });
    const queries = buildAnalyticsQueries(filters);
    await loader.run(
      (requestSignal) => Promise.all([
        getAdminJson("/api/admin/usage-analytics/summary", { query: queries.usage, fetchImpl, signal: requestSignal }),
        getAdminJson("/api/admin/product-analytics/dashboard", { query: queries.product, fetchImpl, signal: requestSignal }),
      ]),
      {
        signal,
        onSuccess: ([usage, product]) => renderAdminMarkup(results, analyticsResultsMarkup(usage, product)),
        onError: (error) => renderAdminFailure(results, error, load),
      },
    );
  };
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      filters = normalizeAnalyticsFilters(Object.fromEntries(new FormData(event.currentTarget).entries()));
      syncFilterControls(form, filters);
      void load();
    } catch (error) {
      validation.textContent = error.message;
      validation.hidden = false;
    }
  });
  form?.addEventListener("change", (event) => {
    if (event.target?.name !== "from" && event.target?.name !== "to") return;
    const input = form.querySelector("[data-admin-analytics-preset-value]");
    if (input) input.value = "custom";
    for (const button of form.querySelectorAll("[data-analytics-preset]")) {
      const active = button.dataset.analyticsPreset === "custom";
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("active", active);
    }
  });
  for (const button of form?.querySelectorAll("[data-analytics-preset]") || []) {
    button.addEventListener("click", () => {
      filters = normalizeAnalyticsFilters({ ...filters, preset: button.dataset.analyticsPreset });
      syncFilterControls(form, filters);
      void load();
    });
  }
  signal?.addEventListener?.("abort", () => loader.cancel(), { once: true });
  void load();
  return { reload: load, cancel: () => loader.cancel() };
}
