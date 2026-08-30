import { apiFetch } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";

const STYLE_URL = new URL("./UsageAnalyticsView.css?no-inline", import.meta.url).pathname;
const SUMMARY_ENDPOINT = "/api/admin/usage-analytics/summary";
export const USAGE_SUMMARY_REFRESH_MS = 60_000;
const USAGE_SUMMARY_FRESH_MS = 55_000;
const VIEW_STATES = new WeakMap();
const NUMBER_FORMAT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const DECIMAL_FORMAT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

const FEATURE_LABELS = Object.freeze({
  dashboard: "Tổng quan",
  plans: "Kế hoạch lựa chọn nhà thầu",
  packages: "Gói thầu",
  timeline: "Timeline gói thầu",
  "bid-opening": "Mở thầu",
  "bid-evaluation": "Đánh giá hồ sơ dự thầu",
  investors: "Chủ đầu tư",
  contractors: "Nhà thầu",
  experts: "Chuyên gia",
  contracts: "Hợp đồng",
  templates: "Biểu mẫu Word",
  "word-publication": "Xuất bản Word",
  "account-admin": "Quản lý tài khoản",
  commercial: "Thương mại & thanh toán",
  "usage-analytics": "Phân tích sử dụng",
  profile: "Trang cá nhân",
});

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function safeNumber(value, { integer = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const nonNegative = Math.max(0, numeric);
  return integer ? Math.trunc(nonNegative) : nonNegative;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return value.trim().toLowerCase() !== "false" && value.trim() !== "0";
  return Boolean(value);
}

function arrayOrEntries(value, mapEntry) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(mapEntry);
}

function unwrapSummary(payload) {
  const root = objectOrEmpty(payload);
  const data = objectOrEmpty(root.data);
  return objectOrEmpty(
    firstDefined(root.summary, data.summary, Object.keys(data).length ? data : root),
  );
}

export function normalizeUsageAnalyticsSummary(payload = {}) {
  const source = unwrapSummary(payload);
  const rangeSource = objectOrEmpty(firstDefined(source.range, source.dateRange, source.date_range));
  const peakSource = objectOrEmpty(firstDefined(
    source.peakConcurrency,
    source.peak_concurrency,
    source.peak,
  ));
  const averageSource = objectOrEmpty(firstDefined(source.averages, source.average));
  const coverageSource = objectOrEmpty(source.coverage);
  const rawFeatures = firstDefined(source.topFeatures, source.top_features, source.features, []);
  const rawSeries = firstDefined(
    source.concurrencySeries,
    source.concurrency_series,
    source.series,
    [],
  );

  const topFeatures = arrayOrEntries(rawFeatures, ([feature, count]) => ({ feature, count }))
    .map((item) => {
      const feature = String(firstDefined(item?.feature, item?.code, item?.key, "") || "").trim();
      return {
        feature,
        label: String(firstDefined(item?.label, FEATURE_LABELS[feature], feature, "Chức năng khác")),
        count: safeNumber(firstDefined(item?.count, item?.events, item?.eventCount), { integer: true }),
        uniqueUsers: safeNumber(firstDefined(
          item?.uniqueUsers,
          item?.unique_users,
          item?.activeUsers,
        ), { integer: true }),
      };
    });

  const concurrencySeries = arrayOrEntries(rawSeries, ([timestamp, count]) => ({ timestamp, count }))
    .map((item) => ({
      timestamp: String(firstDefined(
        item?.timestamp,
        item?.time,
        item?.bucketStart,
        item?.bucket_start,
        "",
      ) || ""),
      count: safeNumber(firstDefined(item?.count, item?.value, item?.activeUsers), { integer: true }),
    }));

  return {
    generatedAt: String(firstDefined(source.generatedAt, source.generated_at, "") || ""),
    range: {
      from: String(firstDefined(rangeSource.from, rangeSource.start, source.from, "") || ""),
      to: String(firstDefined(rangeSource.to, rangeSource.end, source.to, "") || ""),
      bucket: String(firstDefined(rangeSource.bucket, source.bucket, "") || ""),
    },
    coverage: {
      hasData: safeBoolean(firstDefined(coverageSource.hasData, coverageSource.has_data), true),
      startedAt: firstDefined(coverageSource.startedAt, coverageSource.started_at) == null
        ? null
        : String(firstDefined(coverageSource.startedAt, coverageSource.started_at)),
      partial: safeBoolean(firstDefined(coverageSource.partial, coverageSource.is_partial), false),
    },
    onlineNow: safeNumber(firstDefined(source.onlineNow, source.online_now), { integer: true }),
    peakConcurrency: {
      count: safeNumber(firstDefined(peakSource.count, peakSource.value), { integer: true }),
      start: String(firstDefined(
        peakSource.start,
        peakSource.startAt,
        peakSource.start_at,
        peakSource.timestamp,
        "",
      ) || ""),
      end: String(firstDefined(peakSource.end, peakSource.endAt, peakSource.end_at, "") || ""),
    },
    topFeatures,
    averages: {
      jobsPerActiveUser: safeNumber(firstDefined(
        averageSource.jobsPerActiveUser,
        averageSource.jobs_per_active_user,
        source.jobsPerActiveUser,
      )),
      wordExportsPerActiveUser: safeNumber(firstDefined(
        averageSource.wordExportsPerActiveUser,
        averageSource.word_exports_per_active_user,
        source.wordExportsPerActiveUser,
      )),
    },
    workActivityCount: safeNumber(firstDefined(
      source.workActivityCount,
      source.work_activity_count,
      source.jobCount,
    ), { integer: true }),
    wordExportCount: safeNumber(firstDefined(
      source.wordExportCount,
      source.word_export_count,
    ), { integer: true }),
    featureUseCount: safeNumber(firstDefined(
      source.featureUseCount,
      source.feature_use_count,
    ), { integer: true }),
    activeUsers: safeNumber(firstDefined(source.activeUsers, source.active_users), { integer: true }),
    eventCount: safeNumber(firstDefined(source.eventCount, source.event_count), { integer: true }),
    concurrencySeries,
  };
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function buildUsageAnalyticsUrl({ from, to, bucket = "hour" } = {}) {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new TypeError("Khoảng ngày thống kê không hợp lệ.");
  }
  if (from > to) throw new RangeError("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
  const safeBucket = bucket === "day" ? "day" : "hour";
  const query = new URLSearchParams({ from, to, bucket: safeBucket });
  return `${SUMMARY_ENDPOINT}?${query}`;
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - Math.max(0, Number(days || 1) - 1));
  return localIsoDate(date);
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return "Chưa xác định";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function formatAxisTime(value, bucket = "hour") {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    ...(bucket === "day" ? {} : { hour: "2-digit" }),
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function formatReportRange(from, to) {
  const formatValue = (value) => {
    if (isIsoDate(value)) {
      const [year, month, day] = value.split("-").map(Number);
      return new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(year, month - 1, day));
    }
    return formatDateTime(value);
  };
  if (!from && !to) return "—";
  return `${formatValue(from)} – ${formatValue(to || from)}`;
}

function formatRange(from, to) {
  if (!from && !to) return "—";
  return `${formatDateTime(from)} – ${formatDateTime(to || from)}`;
}

function text(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = String(value ?? "");
}

function setViewState(root, mode, message = "") {
  const loading = root.querySelector("#usage-analytics-loading");
  const error = root.querySelector("#usage-analytics-error");
  const empty = root.querySelector("#usage-analytics-empty");
  const content = root.querySelector("#usage-analytics-content");
  loading.hidden = mode !== "loading";
  error.hidden = mode !== "error";
  empty.hidden = mode !== "empty";
  content.hidden = mode !== "ready";
  if (mode === "error") text(root, "#usage-analytics-error-message", message || "Vui lòng thử lại.");
}

function renderCoverage(root, summary) {
  const notice = root.querySelector("#usage-analytics-coverage");
  const showPartial = summary.coverage.partial;
  notice.hidden = !showPartial;
  if (!showPartial) {
    text(root, "#usage-analytics-coverage-text", "");
    return;
  }
  const startedAt = summary.coverage.startedAt;
  text(
    root,
    "#usage-analytics-coverage-text",
    startedAt
      ? `Dữ liệu được ghi nhận từ ${formatDateTime(startedAt)}; các khoảng trước thời điểm này chưa đầy đủ.`
      : "Dữ liệu chỉ phản ánh thời gian từ khi hệ thống bắt đầu ghi nhận và có thể chưa đầy đủ.",
  );
}

function renderChart(root, summary) {
  const chart = root.querySelector("#usage-concurrency-chart");
  const empty = root.querySelector("#usage-chart-empty");
  chart.replaceChildren();
  const series = summary.concurrencySeries;
  empty.hidden = series.length > 0;
  chart.hidden = series.length === 0;
  if (!series.length) {
    chart.setAttribute("aria-label", "Chưa có dữ liệu người hoạt động theo thời gian");
    return;
  }

  const maximum = Math.max(1, ...series.map((point) => point.count));
  const labelInterval = Math.max(1, Math.ceil(series.length / 8));
  const startLabel = formatDateTime(series[0]?.timestamp);
  const endLabel = formatDateTime(series.at(-1)?.timestamp);
  chart.setAttribute(
    "aria-label",
    `Người hoạt động theo thời gian từ ${startLabel} đến ${endLabel}; cao nhất ${maximum} người trong một ${summary.range.bucket === "day" ? "ngày" : "khung giờ"}.`,
  );

  const fragment = document.createDocumentFragment();
  series.forEach((point, index) => {
    const bar = document.createElement("span");
    const height = point.count === 0 ? 2 : Math.max(4, point.count / maximum * 100);
    const isPeak = point.count === maximum;
    const isLabelled = index === 0 || index === series.length - 1 || index % labelInterval === 0;
    bar.className = "usage-chart__bar";
    bar.tabIndex = isPeak || isLabelled ? 0 : -1;
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `${formatDateTime(point.timestamp)}: ${NUMBER_FORMAT.format(point.count)} người hoạt động`);
    bar.title = `${formatDateTime(point.timestamp)} · ${NUMBER_FORMAT.format(point.count)} người`;
    bar.dataset.peak = String(isPeak);
    setRuntimeStyle(bar, "--usage-bar-height", `${height}%`);
    if (isLabelled) {
      const label = document.createElement("span");
      label.className = "usage-chart__bar-label";
      label.setAttribute("aria-hidden", "true");
      label.textContent = formatAxisTime(point.timestamp, summary.range.bucket);
      bar.append(label);
    }
    fragment.append(bar);
  });
  chart.append(fragment);
}

function renderFeatures(root, summary) {
  const container = root.querySelector("#usage-feature-list");
  const empty = root.querySelector("#usage-feature-empty");
  const features = summary.topFeatures;
  container.replaceChildren();
  container.hidden = features.length === 0;
  empty.hidden = features.length > 0;
  if (!features.length) return;

  const maximum = Math.max(1, ...features.map((feature) => feature.count));
  const fragment = document.createDocumentFragment();
  features.forEach((feature) => {
    const row = document.createElement("article");
    row.className = "usage-feature";

    const label = document.createElement("span");
    label.className = "usage-feature__label";
    label.textContent = feature.label;
    label.title = feature.label;

    const value = document.createElement("strong");
    value.className = "usage-feature__value";
    value.textContent = NUMBER_FORMAT.format(feature.count);

    const track = document.createElement("span");
    track.className = "usage-feature__track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = "usage-feature__fill";
    setRuntimeStyle(fill, "--usage-feature-width", `${feature.count / maximum * 100}%`);
    track.append(fill);

    const meta = document.createElement("small");
    meta.className = "usage-feature__meta";
    meta.textContent = `${NUMBER_FORMAT.format(feature.uniqueUsers)} người dùng riêng biệt`;

    row.append(label, value, track, meta);
    fragment.append(row);
  });
  container.append(fragment);
}

function renderSummary(root, summary) {
  const freshness = root.querySelector("#usage-analytics-freshness");
  freshness.dataset.tone = "success";
  text(
    root,
    "#usage-analytics-freshness span:last-child",
    summary.generatedAt ? `Cập nhật ${formatDateTime(summary.generatedAt)}` : "Dữ liệu mới nhất",
  );
  renderCoverage(root, summary);
  if (!summary.coverage.hasData) {
    text(root, "#usage-empty-online-now", NUMBER_FORMAT.format(summary.onlineNow));
    setViewState(root, "empty");
    return;
  }

  text(root, "#usage-online-now", NUMBER_FORMAT.format(summary.onlineNow));
  text(root, "#usage-active-users", NUMBER_FORMAT.format(summary.activeUsers));
  text(root, "#usage-jobs-average", DECIMAL_FORMAT.format(summary.averages.jobsPerActiveUser));
  text(root, "#usage-word-average", DECIMAL_FORMAT.format(summary.averages.wordExportsPerActiveUser));
  text(root, "#usage-jobs-basis", `${NUMBER_FORMAT.format(summary.workActivityCount)} hoạt động / ${NUMBER_FORMAT.format(summary.activeUsers)} người`);
  text(root, "#usage-word-basis", `${NUMBER_FORMAT.format(summary.wordExportCount)} lượt / ${NUMBER_FORMAT.format(summary.activeUsers)} người`);
  text(root, "#usage-peak-count", NUMBER_FORMAT.format(summary.peakConcurrency.count));
  text(root, "#usage-peak-unit", summary.range.bucket === "day" ? "ngày cao điểm" : "khung giờ cao điểm");
  text(root, "#usage-peak-range", formatRange(summary.peakConcurrency.start, summary.peakConcurrency.end));
  text(root, "#usage-event-count", NUMBER_FORMAT.format(summary.eventCount));
  text(root, "#usage-chart-range", formatReportRange(summary.range.from, summary.range.to));
  renderChart(root, summary);
  renderFeatures(root, summary);
  setViewState(root, "ready");
}

function filterValues(root) {
  return {
    from: root.querySelector("#usage-analytics-from")?.value || "",
    to: root.querySelector("#usage-analytics-to")?.value || "",
    bucket: root.querySelector("#usage-analytics-bucket")?.value || "hour",
  };
}

function showFilterError(root, message = "") {
  const element = root.querySelector("#usage-analytics-filter-error");
  element.textContent = message;
  element.hidden = !message;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function reloadUsageAnalytics(root) {
  const state = VIEW_STATES.get(root);
  if (!state) return false;
  let url;
  try {
    url = buildUsageAnalyticsUrl(filterValues(root));
    showFilterError(root);
  } catch (error) {
    showFilterError(root, error.message);
    return false;
  }

  state.request?.abort();
  const request = new AbortController();
  const generation = ++state.generation;
  state.request = request;
  setViewState(root, "loading");

  try {
    const response = await apiFetch(url, {
      method: "GET",
      retries: 0,
      signal: request.signal,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const error = new Error(payload.error || "Máy chủ chưa thể tổng hợp dữ liệu sử dụng.");
      error.status = response.status;
      throw error;
    }
    if (generation !== state.generation) return false;
    const summary = normalizeUsageAnalyticsSummary(payload);
    const requestedRange = filterValues(root);
    if (!summary.range.from) summary.range.from = requestedRange.from;
    if (!summary.range.to) summary.range.to = requestedRange.to;
    if (!summary.range.bucket) summary.range.bucket = requestedRange.bucket;
    state.summary = summary;
    state.lastLoadedAt = Date.now();
    renderSummary(root, summary);
    state.controller?.view?.createIconsScoped?.(root);
    return true;
  } catch (error) {
    if (request.signal.aborted || generation !== state.generation) return false;
    const message = error?.status === 403
      ? "Phiên quản trị không còn quyền truy cập báo cáo này. Vui lòng đăng nhập lại."
      : error?.message || "Không thể kết nối máy chủ. Vui lòng thử lại.";
    setViewState(root, "error", message);
    state.controller?.view?.createIconsScoped?.(root);
    return false;
  } finally {
    if (state.request === request) state.request = null;
  }
}

function applyRangePreset(root, days) {
  const from = root.querySelector("#usage-analytics-from");
  const to = root.querySelector("#usage-analytics-to");
  if (from) from.value = dateDaysAgo(days);
  if (to) to.value = localIsoDate(new Date());
  const bucket = root.querySelector("#usage-analytics-bucket");
  if (bucket) bucket.value = Number(days) > 7 ? "day" : "hour";
}

function bindEvents(root) {
  if (root.dataset.usageAnalyticsBound === "true") return;
  root.dataset.usageAnalyticsBound = "true";
  root.querySelector("#usage-analytics-filter-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void reloadUsageAnalytics(root);
  });
  root.querySelectorAll("[data-usage-range]").forEach((button) => {
    button.addEventListener("click", () => {
      applyRangePreset(root, Number(button.dataset.usageRange || 30));
      void reloadUsageAnalytics(root);
    });
  });
  root.querySelector("#usage-analytics-retry")?.addEventListener("click", () => {
    void reloadUsageAnalytics(root);
  });
}

function analyticsIsVisible(root) {
  return root.classList.contains("active")
    && root.ownerDocument?.visibilityState !== "hidden";
}

function scheduleAutoRefresh(root, state) {
  if (state.refreshInterval !== null) return;
  const documentRef = root.ownerDocument;
  const windowRef = documentRef?.defaultView || globalThis;
  const reloadIfStale = () => {
    if (!analyticsIsVisible(root) || state.request) return;
    if (Date.now() - state.lastLoadedAt < USAGE_SUMMARY_FRESH_MS) return;
    void reloadUsageAnalytics(root);
  };
  state.onVisibility = () => {
    if (documentRef.visibilityState === "visible") reloadIfStale();
  };
  state.stopAutoRefresh = () => {
    if (state.refreshInterval !== null) windowRef.clearInterval?.(state.refreshInterval);
    state.refreshInterval = null;
    documentRef?.removeEventListener?.("visibilitychange", state.onVisibility);
  };
  documentRef?.addEventListener?.("visibilitychange", state.onVisibility);
  windowRef.addEventListener?.("pagehide", state.stopAutoRefresh, { once: true });
  state.refreshInterval = windowRef.setInterval?.(reloadIfStale, USAGE_SUMMARY_REFRESH_MS) ?? null;
}

export async function mountUsageAnalytics(controller) {
  await loadStyleOnce(STYLE_URL);
  const root = document.getElementById("tab-usage-analytics");
  if (!root) return false;

  let state = VIEW_STATES.get(root);
  if (!state) {
    state = {
      controller,
      generation: 0,
      lastLoadedAt: 0,
      refreshInterval: null,
      request: null,
      summary: null,
    };
    VIEW_STATES.set(root, state);
  } else {
    state.controller = controller;
  }
  const from = root.querySelector("#usage-analytics-from");
  const to = root.querySelector("#usage-analytics-to");
  if (from && !from.value) from.value = dateDaysAgo(30);
  if (to && !to.value) to.value = localIsoDate(new Date());
  const bucket = root.querySelector("#usage-analytics-bucket");
  if (bucket && !bucket.dataset.usageDefaultSet) {
    bucket.value = "day";
    bucket.dataset.usageDefaultSet = "true";
  }
  bindEvents(root);
  scheduleAutoRefresh(root, state);
  controller?.view?.createIconsScoped?.(root);
  const { mountProductAnalytics } = await import("./ProductAnalyticsView.js");
  mountProductAnalytics(root.querySelector("#product-analytics-workspace"), controller);
  if (state.summary && Date.now() - state.lastLoadedAt < USAGE_SUMMARY_FRESH_MS) {
    renderSummary(root, state.summary);
    return true;
  }
  return reloadUsageAnalytics(root);
}
