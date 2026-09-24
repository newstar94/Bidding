import { getAdminJson } from "./AdminApi.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminFailure,
  renderAdminMarkup,
} from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { adminIconMarkup } from "./AdminIcons.js";
import { adminStatusMarkup } from "./AdminStatus.js";
import { trustedHTML } from "../shared/trustedTypes.js";

const METRICS = Object.freeze([
  ["organizations", "Tổ chức", (metrics) => metrics.organizations?.total ?? metrics.organizations],
  ["activeOrganizations", "Tổ chức hoạt động", (metrics) => metrics.activeOrganizations],
  ["newOrganizations30Days", "Tổ chức mới · 30 ngày", (metrics) => metrics.newOrganizations30Days],
  ["users", "Người dùng", (metrics) => metrics.users?.total ?? metrics.users],
  ["activeAccounts", "Tài khoản hoạt động", (metrics) => metrics.activeAccounts],
  ["activeUsers", "Người dùng đang hoạt động", (metrics) => metrics.activeUsers],
  ["newUsers30Days", "Người dùng mới · 30 ngày", (metrics) => metrics.newUsers30Days],
  ["activeSubscriptions", "Đăng ký đang hoạt động", (metrics) => metrics.subscriptions?.active ?? metrics.activeSubscriptions],
  ["verifiedRevenue", "Doanh thu tháng đã xác minh", (metrics) => metrics.billing?.verifiedRevenue ?? metrics.currentPeriodRevenue?.value, "currency"],
  ["mrr", "MRR", (metrics) => metrics.mrr, "currency"],
  ["arr", "ARR", (metrics) => metrics.arr, "currency"],
  ["unpaidInvoices", "Hóa đơn chưa thanh toán", (metrics) => metrics.unpaidInvoices],
  ["overdueInvoices", "Hóa đơn quá hạn", (metrics) => metrics.overdueInvoices],
  ["pendingJobs", "Tác vụ đang chờ", (metrics) => metrics.pendingJobs],
]);
const PRIMARY_METRIC_KEYS = new Set([
  "organizations", "users", "activeSubscriptions", "verifiedRevenue",
]);

const GROWTH_SERIES = Object.freeze([
  ["newUsers", "Người dùng", "Người dùng mới"],
  ["newOrganizations", "Tổ chức", "Tổ chức mới"],
  ["subscriptions", "Đăng ký", "Đăng ký"],
]);
const OVERVIEW_LOADS = new WeakMap();

function displayMetric(value, format = "number") {
  if (!Number.isFinite(value)) return "N/A";
  const number = new Intl.NumberFormat("vi-VN").format(value);
  return format === "currency" ? `${number} ₫` : number;
}

function formatDateTime(value) {
  if (value === null || value === undefined || value === "") return "Không rõ thời điểm";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Không rõ thời điểm" : date.toLocaleString("vi-VN");
}

function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Không rõ ngày";
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

function formatLongDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Chưa có dữ liệu thời gian";
  return date.toLocaleDateString("vi-VN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function safeAdminHref(value) {
  const href = String(value || "");
  return /^\/admin\/(?:organizations|users)(?:[?][A-Za-z0-9_=&%-]+)?$/u.test(href)
    ? href
    : "/admin";
}

function comparisonChart({ id, title, total, active, activeLabel, otherLabel }) {
  if (!Number.isFinite(total) || !Number.isFinite(active) || total < 0 || active < 0) {
    return `<section class="card" aria-labelledby="${id}-title"><div class="card-body"><h3 class="card-title" id="${id}-title">${escapeHtml(title)}</h3>${adminStateMarkup("empty", { message: "Chưa có dữ liệu có thẩm quyền để lập biểu đồ." })}</div></section>`;
  }
  const boundedActive = Math.min(total, active);
  const other = Math.max(0, total - boundedActive);
  const percentage = total > 0 ? Math.round((boundedActive / total) * 100) : 0;
  const circumference = 276.46;
  const activeStroke = ((percentage / 100) * circumference).toFixed(2);
  const remainderStroke = (circumference - Number(activeStroke)).toFixed(2);
  const description = `${activeLabel}: ${boundedActive} trên tổng số ${total} (${percentage}%). ${otherLabel}: ${other}.`;
  return `<section class="card bf-admin-chart-card h-100" aria-labelledby="${id}-title"><div class="card-header"><div><h3 class="card-title" id="${id}-title">${escapeHtml(title)}</h3><p class="text-secondary small mb-0">Phân bố theo trạng thái hiện tại</p></div></div><div class="card-body bf-admin-chart-body"><div class="bf-admin-donut"><svg viewBox="0 0 120 120" role="img" aria-label="${escapeHtml(description)}"><circle class="bf-admin-donut-track" cx="60" cy="60" r="44"></circle><circle class="bf-admin-donut-value" cx="60" cy="60" r="44" stroke-dasharray="${activeStroke} ${remainderStroke}"></circle></svg><div class="bf-admin-donut-label"><strong>${percentage}%</strong><span>${escapeHtml(activeLabel)}</span></div></div><div class="bf-admin-chart-legend"><div><span class="bf-admin-legend-dot is-primary"></span><span>${escapeHtml(activeLabel)}</span><strong>${boundedActive}</strong></div><div><span class="bf-admin-legend-dot"></span><span>${escapeHtml(otherLabel)}</span><strong>${other}</strong></div><div class="bf-admin-chart-total"><span>Tổng cộng</span><strong>${total}</strong></div></div><table class="visually-hidden"><caption>Dữ liệu dạng bảng của ${escapeHtml(title)}</caption><thead><tr><th scope="col">Trạng thái</th><th scope="col">Số lượng</th></tr></thead><tbody><tr><th scope="row">${escapeHtml(activeLabel)}</th><td>${boundedActive}</td></tr><tr><th scope="row">${escapeHtml(otherLabel)}</th><td>${other}</td></tr></tbody></table></div></section>`;
}

function chartSeriesFor(charts, key) {
  if (key === "subscriptions") return null;
  const chart = charts.find((item) => item?.key === key || item?.series?.some?.((series) => series?.key === key));
  const series = chart?.series?.find?.((item) => item?.key === key) || chart?.series?.[0];
  if (!series || !Array.isArray(series.points)) return null;
  return {
    key,
    label: series.label || GROWTH_SERIES.find(([seriesKey]) => seriesKey === key)?.[2] || key,
    points: series.points.map((point) => ({
        date: point?.date || point?.label || "N/A",
        value: Number.isFinite(point?.value) && point?.status !== "insufficient_sample" ? point.value : null,
      })),
  };
}

function growthChartMarkup(series) {
  const points = Array.isArray(series?.points) ? series.points : [];
  if (!points.length || points.every((point) => point.value === null)) {
    return adminStateMarkup("empty", {
      message: "Chưa có dữ liệu theo thời gian có thẩm quyền cho lựa chọn này.",
    });
  }

  const width = 820;
  const height = 250;
  const left = 52;
  const right = 18;
  const top = 20;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(1, ...points.map((point) => point.value ?? 0));
  const tickStep = Math.max(1, Math.ceil(maximum / 4));
  const maxValue = tickStep * 4;
  const timestamps = points.map((point) => Date.parse(point.date));
  const timeStart = Math.min(...timestamps);
  const timeEnd = Math.max(...timestamps);
  const scaleX = (index) => left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const pointX = (index) => Number.isFinite(timeStart) && Number.isFinite(timeEnd) && timeEnd > timeStart
    ? left + ((timestamps[index] - timeStart) / (timeEnd - timeStart)) * plotWidth : scaleX(index);
  const scaleY = (value) => top + plotHeight - (Math.max(0, value) / maxValue) * plotHeight;
  const coordinates = points.map((point, index) => point.value === null ? null : [pointX(index), scaleY(point.value)]);
  const segments = [];
  coordinates.forEach((point, index) => {
    if (!point) return;
    if (!index || !coordinates[index - 1]) segments.push([]);
    segments.at(-1).push(point);
  });
  const paths = segments.map((segment) => {
    const linePath = segment.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
    const areaPath = `${linePath} L ${segment.at(-1)[0].toFixed(2)} ${top + plotHeight} L ${segment[0][0].toFixed(2)} ${top + plotHeight} Z`;
    return `<path class="bf-admin-growth-area" d="${areaPath}"></path><path class="bf-admin-growth-line" d="${linePath}"></path>`;
  }).join("");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = top + plotHeight - ratio * plotHeight;
    const value = Math.round(maxValue * ratio);
    return `<line class="bf-admin-growth-grid" x1="${left}" y1="${y.toFixed(2)}" x2="${(left + plotWidth).toFixed(2)}" y2="${y.toFixed(2)}"></line><text class="bf-admin-growth-axis-label" x="${left - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(new Intl.NumberFormat("vi-VN").format(value))}</text>`;
  }).join("");
  const labels = points.map((point, index) => {
    if (index !== 0 && index !== points.length - 1 && index % Math.max(1, Math.ceil(points.length / 5)) !== 0) return "";
    return `<text class="bf-admin-growth-axis-label" x="${pointX(index).toFixed(2)}" y="${height - 10}" text-anchor="middle">${escapeHtml(formatDateLabel(point.date))}</text>`;
  }).join("");
  const dots = coordinates.map((point, index) => point ? `<circle class="bf-admin-growth-point" cx="${point[0].toFixed(2)}" cy="${point[1].toFixed(2)}" r="${index === coordinates.length - 1 ? "4.5" : "3"}"><title>${escapeHtml(formatDateLabel(points[index].date))}: ${escapeHtml(displayMetric(points[index].value))}</title></circle>` : "").join("");
  const accessibleLabel = `${series.label || "Dữ liệu"} theo ngày trong 30 ngày gần nhất`;
  const rows = points.map((point) => `<tr><th scope="row">${escapeHtml(formatDateLabel(point.date))}</th><td>${escapeHtml(displayMetric(point.value))}</td></tr>`).join("");
  return `<div class="bf-admin-growth-visual"><svg class="bf-admin-growth-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(accessibleLabel)}" focusable="false"><title>${escapeHtml(accessibleLabel)}</title>${grid}${paths}${dots}${labels}</svg><table class="visually-hidden"><caption>${escapeHtml(accessibleLabel)}</caption><thead><tr><th scope="col">Ngày</th><th scope="col">Giá trị</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function growthChartCard(charts) {
  const availableKeys = GROWTH_SERIES.map(([key]) => key);
  const initialKey = availableKeys.find((key) => chartSeriesFor(charts, key)?.points?.length) || "newUsers";
  const initialSeries = chartSeriesFor(charts, initialKey);
  const tabs = GROWTH_SERIES.map(([key, label, seriesLabel]) => `<button class="bf-admin-growth-tab${key === initialKey ? " is-active" : ""}" id="admin-growth-tab-${escapeHtml(key)}" type="button" role="tab" aria-selected="${key === initialKey}" aria-controls="admin-growth-panel" tabindex="${key === initialKey ? "0" : "-1"}" data-admin-growth-series="${escapeHtml(key)}" aria-label="${escapeHtml(seriesLabel)}">${escapeHtml(label)}</button>`).join("");
  return `<section class="card bf-admin-growth-card" aria-labelledby="admin-growth-title"><div class="card-header bf-admin-growth-header"><div><h2 class="card-title" id="admin-growth-title">Tăng trưởng sử dụng</h2><p class="text-secondary small mb-0" data-admin-growth-label>${escapeHtml(initialSeries?.label || "Dữ liệu theo ngày · 30 ngày gần nhất")}</p></div><div class="bf-admin-growth-tabs" role="tablist" aria-label="Chỉ số tăng trưởng">${tabs}</div></div><div class="card-body" id="admin-growth-panel" role="tabpanel" tabindex="0" aria-labelledby="admin-growth-tab-${escapeHtml(initialKey)}" data-admin-growth-chart>${growthChartMarkup(initialSeries)}</div></section>`;
}

function operationStatusChip(status, context) {
  const key = String(status || "").trim().toLowerCase();
  const labels = {
    healthy: context === "database" ? "Ổn định" : "Hoạt động",
    ready: "Sẵn sàng",
    available: "Ổn định",
    degraded: "Cần kiểm tra",
    unavailable: "Không khả dụng",
    unknown: "Chưa xác định",
  };
  const tone = ["healthy", "ready", "available"].includes(key)
    ? "success"
    : key === "degraded" ? "warning" : key === "unavailable" ? "danger" : "neutral";
  return `<span class="bf-admin-operation-chip is-${tone}"><span class="bf-admin-operation-dot" aria-hidden="true"></span><span>${escapeHtml(labels[key] || "Chưa có dữ liệu")}</span></span>`;
}

function operationalStatusMarkup(healthPayload) {
  const resources = healthPayload?.resources && typeof healthPayload.resources === "object" ? healthPayload.resources : {};
  const checkedAt = healthPayload?.generatedAt ? formatDateTime(healthPayload.generatedAt) : "Chưa có dữ liệu";
  const rows = [
    ["application", "Ứng dụng", "BiddingFlow Web", "application"],
    ["postgresql", "Cơ sở dữ liệu", "PostgreSQL", "database"],
    ["backgroundJobs", "Tác vụ nền", "Hàng đợi tác vụ", "jobs"],
  ].map(([key, label, detail, context]) => `<li class="bf-admin-operation-row"><div class="bf-admin-operation-icon" aria-hidden="true">${adminIconMarkup(context === "database" ? "database" : context === "jobs" ? "settings" : "monitor", "")}</div><div class="bf-admin-operation-copy"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></div><div>${operationStatusChip(resources[key]?.status, context)}</div><time datetime="${escapeHtml(healthPayload?.generatedAt || "")}">Kiểm tra lần cuối<br><strong>${escapeHtml(checkedAt)}</strong></time></li>`).join("");
  return `<section class="card bf-admin-operation-card" aria-labelledby="admin-operation-title"><div class="card-header"><h2 class="card-title" id="admin-operation-title">Trạng thái vận hành</h2></div><div class="card-body"><ul class="bf-admin-operation-list">${rows}</ul><a class="bf-admin-operation-link" href="/admin/health" data-admin-link="/admin/health">Xem chi tiết trạng thái <span aria-hidden="true">→</span></a></div></section>`;
}

function operationalStatusLoadingMarkup() {
  return `<section class="card bf-admin-operation-card" aria-labelledby="admin-operation-title"><div class="card-header"><h2 class="card-title" id="admin-operation-title">Trạng thái vận hành</h2></div><div class="card-body bf-admin-operation-loading" role="status" aria-live="polite"><span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>Đang kiểm tra trạng thái…</span></div></section>`;
}

function organizationInitials(value) {
  const words = String(value || "").trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ""}${words.at(-1)?.[0] || ""}`.toUpperCase();
}

function recentOrganizationsMarkup(organizations) {
  if (!organizations.length) return adminStateMarkup("empty", { message: "Chưa có tổ chức gần đây." });
  const rows = organizations.map((organization) => {
    const name = organization?.name || organization?.organizationName || "Không có tên";
    const createdAt = organization?.createdAt || "";
    const timestamp = createdAt ? formatDateTime(createdAt) : "Chưa có dữ liệu";
    return `<tr><th scope="row"><div class="bf-admin-organization-cell"><span class="bf-admin-organization-avatar" aria-hidden="true">${escapeHtml(organizationInitials(name))}</span><span>${escapeHtml(name)}</span></div></th><td>${adminStatusMarkup(organization?.subscriptionStatus)}</td><td class="text-nowrap">${escapeHtml(String(organization?.memberCount ?? "Chưa có dữ liệu"))}</td><td>${adminStatusMarkup(organization?.status)}</td><td><time datetime="${escapeHtml(createdAt)}">${escapeHtml(timestamp)}</time></td></tr>`;
  }).join("");
  return `<div class="table-responsive" tabindex="0" role="region" aria-label="Danh sách tổ chức gần đây"><table class="table table-vcenter card-table bf-admin-recent-organizations"><thead><tr><th scope="col">Tổ chức</th><th scope="col">Đăng ký</th><th scope="col">Thành viên</th><th scope="col">Trạng thái</th><th scope="col">Ngày tạo</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function historicalChartsMarkup(charts) {
  const items = Array.isArray(charts) ? charts.slice(0, 16) : [];
  if (!items.length) return "";
  return `<section class="bf-admin-historical-charts" aria-label="Xu hướng và phân bố"><div class="row row-cards">${items.map((chart, chartIndex) => {
    const label = chart?.label || chart?.key || "Biểu đồ";
    const series = Array.isArray(chart?.series) ? chart.series.slice(0, 8) : [];
    const bodies = series.map((item, seriesIndex) => {
      const points = Array.isArray(item?.points) ? item.points.slice(0, 100) : [];
      const rows = points.map((point) => `<tr><td>${escapeHtml(point?.date || point?.label || "N/A")}</td><td class="text-end">${escapeHtml(displayMetric(point?.value))}</td><td>${escapeHtml(point?.status || "")}</td></tr>`).join("");
      return `<section class="card-body border-top" aria-label="${escapeHtml(item?.label || item?.key || `Chuỗi ${seriesIndex + 1}`)}"><h4 class="h4">${escapeHtml(item?.label || item?.key || `Chuỗi ${seriesIndex + 1}`)}</h4><div class="table-responsive bf-admin-analytics-scroll" tabindex="0"><table class="table table-sm table-vcenter mb-0"><thead><tr><th>Thời điểm / nhóm</th><th class="text-end">Giá trị</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join("");
    return `<div class="col-12 col-xl-6"><article class="card h-100" aria-labelledby="admin-historical-chart-${chartIndex}"><div class="card-header"><h3 class="card-title" id="admin-historical-chart-${chartIndex}">${escapeHtml(label)}</h3></div>${bodies}</article></div>`;
  }).join("")}</div></section>`;
}

function activityFeedMarkup(items) {
  if (!items.length) return adminStateMarkup("empty", { message: "Chưa có hoạt động nền tảng gần đây." });
  const labels = {
    "organization.created": "Tổ chức mới",
    "subscription.created": "Đăng ký mới",
    "subscription.changed": "Thay đổi đăng ký",
    "invoice.payment_verified": "Thanh toán gắn yêu cầu hóa đơn đã xác minh",
    "admin.security": "Sự kiện quản trị / bảo mật",
  };
  return `<ol class="list-group list-group-flush" aria-label="Hoạt động nền tảng gần đây">${items.map((item) => `<li class="list-group-item px-0"><div class="d-flex justify-content-between gap-3"><div><strong>${escapeHtml(item?.title || "Hoạt động chưa có tên")}</strong><div class="small text-secondary">${escapeHtml(labels[item?.kind] || item?.kind || "Hoạt động nền tảng")} · ${escapeHtml(item?.status || "N/A")}${item?.detail ? ` · ${escapeHtml(item.detail)}` : ""}</div></div><time class="small text-secondary text-nowrap" datetime="${escapeHtml(item?.occurredAt || "")}">${escapeHtml(formatDateTime(item?.occurredAt))}</time></div></li>`).join("")}</ol>`;
}

function alertsMarkup(alerts) {
  if (!alerts.length) {
    return `<div class="alert alert-success mb-0" role="status">Không có cảnh báo cần xử lý từ các chỉ số hiện có.</div>`;
  }
  return `<div class="vstack gap-2">${alerts.map((alert) => `<article class="alert alert-warning mb-0"><div class="d-flex flex-wrap align-items-center justify-content-between gap-3"><div><strong>${escapeHtml(alert?.title || "Cần rà soát")}</strong><div>${escapeHtml(alert?.message || "")}</div></div><a class="btn btn-sm btn-outline-warning" href="${escapeHtml(safeAdminHref(alert?.href))}">Xem ${escapeHtml(String(alert?.count ?? ""))}</a></div></article>`).join("")}</div>`;
}

function overviewMarkup(payload, { healthPayload = null, healthPending = false } = {}) {
  const metrics = payload?.metrics && typeof payload.metrics === "object" ? payload.metrics : {};
  const organizations = Array.isArray(payload?.recentOrganizations) ? payload.recentOrganizations : [];
  const activityFeed = Array.isArray(payload?.activityFeed) ? payload.activityFeed : [];
  const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
  const charts = Array.isArray(payload?.charts) ? payload.charts : [];
  const readMetric = (key) => METRICS.find(([metricKey]) => metricKey === key);
  const metricValue = (key) => {
    const entry = readMetric(key);
    return entry ? displayMetric(entry[2](metrics), entry[3]) : "N/A";
  };
  const trendCopy = {
    organizations: Number.isFinite(metrics.newOrganizations30Days) ? `+${new Intl.NumberFormat("vi-VN").format(metrics.newOrganizations30Days)} trong 30 ngày` : "Chưa có dữ liệu so sánh",
    users: Number.isFinite(metrics.newUsers30Days) ? `+${new Intl.NumberFormat("vi-VN").format(metrics.newUsers30Days)} trong 30 ngày` : "Chưa có dữ liệu so sánh",
    activeSubscriptions: Number.isFinite(metrics.subscriptions?.active ?? metrics.activeSubscriptions) ? "Đăng ký còn hiệu lực" : "Chưa có dữ liệu",
    verifiedRevenue: Number.isFinite(metrics.currentPeriodRevenue?.value) || Number.isFinite(metrics.billing?.verifiedRevenue) ? "Đã xác minh trong tháng" : "Chưa có dữ liệu doanh thu",
  };
  const statCards = [
    ["organizations", "Tổ chức", "organizations", "blue"],
    ["users", "Người dùng", "users", "green"],
    ["activeSubscriptions", "Đăng ký hoạt động", "legal", "orange"],
    ["verifiedRevenue", "Doanh thu tháng", "coins", "purple"],
  ].map(([key, label, icon, tone]) => {
    const hasNewCount = (key === "organizations" && Number.isFinite(metrics.newOrganizations30Days)) || (key === "users" && Number.isFinite(metrics.newUsers30Days));
    return `<article class="card bf-admin-stat-card bf-admin-stat-${tone}"><div class="bf-admin-stat-icon">${adminIconMarkup(icon, "")}</div><div class="bf-admin-stat-copy"><span class="bf-admin-stat-label">${escapeHtml(label)}</span><strong data-admin-metric="${key}">${escapeHtml(metricValue(key))}</strong><span class="bf-admin-stat-trend${hasNewCount ? " is-new-count" : ""}">${escapeHtml(trendCopy[key])}</span></div></article>`;
  }).join("");
  const secondaryCards = METRICS.filter(([key]) => !PRIMARY_METRIC_KEYS.has(key)).map(([key, label, read, format]) => `<article class="card bf-admin-metric bf-admin-detail-metric"><div class="card-body"><div class="text-secondary">${escapeHtml(label)}</div><div class="h2 mb-0 mt-2" data-admin-metric="${key}">${escapeHtml(displayMetric(read(metrics), format))}</div></div></article>`).join("");
  const organizationTotal = metrics.organizations?.total ?? metrics.organizations;
  const accountTotal = metrics.users?.total ?? metrics.users;
  const organizationChart = comparisonChart({ id: "organization-status", title: "Tình trạng tổ chức", total: organizationTotal, active: metrics.activeOrganizations, activeLabel: "Hoạt động", otherLabel: "Không hoạt động" });
  const accountChart = comparisonChart({ id: "account-status", title: "Tình trạng tài khoản", total: accountTotal, active: metrics.activeAccounts, activeLabel: "Hoạt động", otherLabel: "Không hoạt động" });
  const generatedAt = payload?.generatedAt || "";
  const generatedTime = generatedAt ? formatDateTime(generatedAt) : "Chưa có dữ liệu";
  const legacyCharts = `<section aria-labelledby="platform-distribution-title"><div class="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3"><div><h2 class="h3 mb-1" id="platform-distribution-title">Biểu đồ tổng quan</h2><p class="text-secondary mb-0">Phân bố tổ chức và tài khoản từ dữ liệu có thẩm quyền.</p></div><p class="text-secondary small mb-0">Cập nhật: ${escapeHtml(generatedTime)}</p></div><div class="row row-cards"><div class="col-lg-6">${organizationChart}</div><div class="col-lg-6">${accountChart}</div></div></section>`;
  const historicalCharts = historicalChartsMarkup(charts);
  const legacyDetails = `<section class="bf-admin-overview-details" aria-label="Chi tiết dữ liệu nền tảng"><h2 class="h3 mb-3">Xu hướng và phân bố</h2>${legacyCharts}${historicalCharts}<section class="mt-4" aria-labelledby="operational-metrics-title"><h2 class="h3 mb-3" id="operational-metrics-title">Chỉ số vận hành</h2><div class="bf-admin-detail-metrics">${secondaryCards}</div></section><div class="row row-cards mt-4"><div class="col-xl-7"><section class="card h-100" aria-labelledby="recent-activity-title"><div class="card-header"><h3 class="card-title" id="recent-activity-title">Hoạt động gần đây</h3></div><div class="card-body">${activityFeedMarkup(activityFeed)}</div></section></div><div class="col-xl-5"><section class="card h-100" aria-labelledby="overview-alerts-title"><div class="card-header"><h3 class="card-title" id="overview-alerts-title">Cảnh báo cần xử lý</h3></div><div class="card-body">${alertsMarkup(alerts)}</div></section></div></div></section>`;
  return `<div class="bf-admin-overview"><section class="bf-admin-overview-heading" aria-labelledby="admin-overview-title"><div><h1 id="admin-overview-title">Tổng quan nền tảng</h1><p>Tổng quan hoạt động của BiddingFlow Platform</p></div><div class="bf-admin-overview-meta"><time datetime="${escapeHtml(generatedAt)}">${escapeHtml(formatLongDate(generatedAt))}</time><span>Cập nhật lần cuối: ${escapeHtml(generatedAt ? new Date(generatedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "Chưa có dữ liệu")}</span></div></section><section class="bf-admin-stat-grid" aria-label="Chỉ số chính">${statCards}</section><section class="bf-admin-overview-main-grid" aria-label="Tăng trưởng và vận hành"><div>${growthChartCard(charts)}</div><div data-admin-health-summary aria-busy="${healthPending}">${healthPending ? operationalStatusLoadingMarkup() : operationalStatusMarkup(healthPayload)}</div></section><section class="card bf-admin-recent-card" aria-labelledby="recent-organizations-title"><div class="card-header bf-admin-recent-header"><h2 class="card-title" id="recent-organizations-title">Tổ chức gần đây</h2><a href="/admin/organizations" data-admin-link="/admin/organizations">Xem tất cả tổ chức <span aria-hidden="true">→</span></a></div>${recentOrganizationsMarkup(organizations)}</section>${legacyDetails}</div>`;
}

export async function renderAdminOverview(container, { fetchImpl, signal } = {}) {
  const loadToken = {};
  OVERVIEW_LOADS.set(container, loadToken);
  const isCurrent = () => !signal?.aborted && OVERVIEW_LOADS.get(container) === loadToken;
  renderAdminMarkup(container, adminLoadingMarkup("Đang tải tổng quan quản trị…"), { busy: true });
  try {
    const healthPromise = getAdminJson("/api/admin/health", { fetchImpl, signal }).then(
      (payload) => ({ payload }), (error) => ({ error }),
    );
    const payload = await getAdminJson("/api/admin/overview", { fetchImpl, signal });
    if (!isCurrent()) return;
    renderAdminMarkup(container, overviewMarkup(payload, { healthPending: true }));
    bindOverviewInteractions(container, Array.isArray(payload?.charts) ? payload.charts : []);
    const healthHost = container.querySelector("[data-admin-health-summary]");
    const showHealth = ({ payload: healthPayload, error }) => {
      if (!isCurrent() || !healthHost) return;
      healthHost.setAttribute("aria-busy", "false");
      if (error) {
        renderAdminFailure(healthHost, error, () => {
          if (!isCurrent()) return;
          renderAdminMarkup(healthHost, operationalStatusLoadingMarkup(), { busy: true });
          void getAdminJson("/api/admin/health", { fetchImpl, signal }).then(
            (data) => showHealth({ payload: data }), (failure) => showHealth({ error: failure }),
          );
        });
      } else renderAdminMarkup(healthHost, operationalStatusMarkup(healthPayload));
    };
    void healthPromise.then(showHealth);
  } catch (error) {
    if (!isCurrent()) return;
    renderAdminFailure(container, error, () => renderAdminOverview(container, { fetchImpl, signal }));
  }
}

function bindOverviewInteractions(container, charts) {
  const chart = container?.querySelector?.("[data-admin-growth-chart]");
  if (!chart) return;
  const buttons = [...container.querySelectorAll("[data-admin-growth-series]")];
  const label = container.querySelector("[data-admin-growth-label]");
  const selectButton = (button, { focus = false } = {}) => {
    const key = button.dataset.adminGrowthSeries || "newUsers";
    const series = chartSeriesFor(charts, key);
    buttons.forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
      item.setAttribute("tabindex", active ? "0" : "-1");
    });
    button.closest("[role=tablist]")?.setAttribute("data-admin-selected", key);
    chart.setAttribute("aria-labelledby", button.id);
    if (label) label.textContent = series ? `${series.label} · 30 ngày gần nhất` : "Chưa có chuỗi thời gian đăng ký";
    chart.innerHTML = trustedHTML(growthChartMarkup(series));
    if (focus) button.focus();
  };
  buttons.forEach((button) => {
    button.addEventListener("click", () => selectButton(button));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = buttons.indexOf(button);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      selectButton(buttons[next], { focus: true });
    });
  });
}

export { overviewMarkup };
