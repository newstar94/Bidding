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

function validDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeAnalyticsFilters(values = {}) {
  const from = String(values.from || "").trim();
  const to = String(values.to || "").trim();
  const bucket = values.bucket === "hour" ? "hour" : "day";
  if (from && !validDate(from)) throw new TypeError("Ngày bắt đầu không hợp lệ.");
  if (to && !validDate(to)) throw new TypeError("Ngày kết thúc không hợp lệ.");
  if (from && to && from > to) throw new TypeError("Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.");
  return { from, to, bucket };
}

export function buildAnalyticsQueries(filters) {
  const normalized = normalizeAnalyticsFilters(filters);
  const range = Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== ""));
  return {
    usage: range,
    product: Object.fromEntries([
      ["from", normalized.from], ["to", normalized.to], ["view", "overview"],
    ].filter(([, value]) => value !== "")),
  };
}

function readInitialFilters() {
  const params = new URLSearchParams(globalThis.location?.search || "");
  try {
    return normalizeAnalyticsFilters(Object.fromEntries(params.entries()));
  } catch {
    return { from: "", to: "", bucket: "day" };
  }
}

function displayNumber(value) {
  return Number.isFinite(value) ? NUMBER_FORMAT.format(value) : "N/A";
}

function usageSummary(payload) {
  const root = payload?.summary || payload?.data?.summary || payload?.data || payload || {};
  const coverage = root.coverage || {};
  return {
    hasData: coverage.hasData ?? coverage.has_data ?? null,
    onlineNow: root.onlineNow ?? root.online_now ?? null,
    activeUsers: root.activeUsers ?? root.active_users ?? null,
    eventCount: root.eventCount ?? root.event_count ?? null,
    workActivityCount: root.workActivityCount ?? root.work_activity_count ?? null,
    wordExportCount: root.wordExportCount ?? root.word_export_count ?? null,
    peakConcurrency: root.peakConcurrency?.count ?? root.peak_concurrency?.count ?? null,
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
  const rows = kpis.map((kpi) => `<tr><td>${escapeHtml(kpi?.label || kpi?.key || "N/A")}</td><td class="text-end">${escapeHtml(displayNumber(kpi?.value))}</td><td class="text-end">${escapeHtml(displayNumber(kpi?.change))}</td></tr>`).join("");
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Chỉ số</th><th class="text-end">Giá trị</th><th class="text-end">Thay đổi</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function featureMarkup(features) {
  if (!features.length) return adminStateMarkup("empty", { message: "Chưa có dữ liệu sử dụng tính năng." });
  const rows = features.map((feature) => `<tr><td>${escapeHtml(feature?.label || feature?.feature || feature?.key || "N/A")}</td><td class="text-end">${escapeHtml(displayNumber(feature?.count))}</td><td class="text-end">${escapeHtml(displayNumber(feature?.uniqueUsers ?? feature?.unique_users))}</td></tr>`).join("");
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Tính năng</th><th class="text-end">Lượt dùng</th><th class="text-end">Người dùng</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function analyticsResultsMarkup(usagePayload, productPayload) {
  const usage = usageSummary(usagePayload);
  const product = productDashboard(productPayload);
  const kpis = Array.isArray(product.kpis) ? product.kpis : [];
  if (usage.hasData === false && product.hasData === false) {
    return adminStateMarkup("empty", { message: product.message || "Chưa có dữ liệu phân tích trong khoảng thời gian này." });
  }
  return `<div class="row row-cards">${metricCard("Đang trực tuyến", usage.onlineNow)}${metricCard("Người dùng hoạt động", usage.activeUsers)}${metricCard("Hoạt động công việc", usage.workActivityCount)}${metricCard("Lượt xuất Word", usage.wordExportCount)}</div><div class="row row-cards mt-1"><div class="col-12 col-xl-6"><section class="card h-100" aria-labelledby="admin-product-kpis"><div class="card-header"><h3 class="card-title" id="admin-product-kpis">Chỉ số sản phẩm</h3></div>${productKpisMarkup(kpis)}</section></div><div class="col-12 col-xl-6"><section class="card h-100" aria-labelledby="admin-top-features"><div class="card-header"><h3 class="card-title" id="admin-top-features">Tính năng được sử dụng</h3></div>${featureMarkup(usage.topFeatures)}</section></div></div>`;
}

function filterMarkup(filters) {
  return `<form class="card card-body mb-3" data-admin-analytics-form><div class="row g-2 align-items-end"><div class="col-12 col-md"><label class="form-label" for="admin-analytics-from">Từ ngày</label><input class="form-control" id="admin-analytics-from" name="from" type="date" value="${escapeHtml(filters.from)}"></div><div class="col-12 col-md"><label class="form-label" for="admin-analytics-to">Đến ngày</label><input class="form-control" id="admin-analytics-to" name="to" type="date" value="${escapeHtml(filters.to)}"></div><div class="col-12 col-md"><label class="form-label" for="admin-analytics-bucket">Độ chi tiết</label><select class="form-select" id="admin-analytics-bucket" name="bucket"><option value="day"${filters.bucket === "day" ? " selected" : ""}>Theo ngày</option><option value="hour"${filters.bucket === "hour" ? " selected" : ""}>Theo giờ</option></select></div><div class="col-12 col-md-auto"><button class="btn btn-primary w-100" type="submit">Áp dụng</button></div></div><p class="text-danger small mt-2 mb-0" data-admin-analytics-validation role="alert" hidden></p></form><div data-admin-analytics-results aria-live="polite"></div>`;
}

function syncBrowserQuery(filters) {
  if (!globalThis.history?.replaceState || !globalThis.location) return;
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ""));
  globalThis.history.replaceState(globalThis.history.state, "", `${globalThis.location.pathname}?${params}`);
}

export function renderAdminAnalytics(container, { fetchImpl, signal } = {}) {
  let filters = readInitialFilters();
  const loader = createLatestAdminLoader();
  renderAdminMarkup(container, filterMarkup(filters));
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
  container.querySelector("[data-admin-analytics-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      filters = normalizeAnalyticsFilters(Object.fromEntries(new FormData(event.currentTarget).entries()));
      void load();
    } catch (error) {
      validation.textContent = error.message;
      validation.hidden = false;
    }
  });
  signal?.addEventListener?.("abort", () => loader.cancel(), { once: true });
  void load();
  return { reload: load, cancel: () => loader.cancel() };
}
