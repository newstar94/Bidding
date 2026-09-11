import { getAdminJson } from "./AdminApi.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminFailure,
  renderAdminMarkup,
} from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { chartsMarkup } from "./AdminAnalytics.js";
import { adminIconMarkup } from "./AdminIcons.js";

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
const METRIC_ICONS = Object.freeze({
  organizations: "organizations", activeOrganizations: "organizations", newOrganizations30Days: "organizations",
  users: "users", activeAccounts: "users", activeUsers: "users", newUsers30Days: "users",
  activeSubscriptions: "subscriptions", verifiedRevenue: "payments", mrr: "payments", arr: "payments",
  unpaidInvoices: "invoices", overdueInvoices: "invoices", pendingJobs: "jobs",
});
const PRIMARY_METRIC_KEYS = new Set([
  "organizations", "users", "activeSubscriptions", "verifiedRevenue",
]);

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

function safeAdminHref(value) {
  const href = String(value || "");
  return /^\/admin\/(?:organizations|users)(?:[?][A-Za-z0-9_=&%-]+)?$/u.test(href)
    ? href
    : "/admin/overview";
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

function overviewMarkup(payload) {
  const metrics = payload?.metrics && typeof payload.metrics === "object" ? payload.metrics : {};
  const organizations = Array.isArray(payload?.recentOrganizations) ? payload.recentOrganizations : [];
  const activityFeed = Array.isArray(payload?.activityFeed) ? payload.activityFeed : [];
  const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
  const charts = Array.isArray(payload?.charts) ? payload.charts : [];
  const renderMetricCards = (entries) => entries.map(([key, label, read, format]) => `<div class="col-sm-6 col-xl-3"><article class="card bf-admin-metric h-100"><div class="card-body"><div class="d-flex align-items-center justify-content-between gap-2"><div class="text-secondary">${escapeHtml(label)}</div>${adminIconMarkup(METRIC_ICONS[key] || "overview", "bf-admin-metric-icon")}</div><div class="h2 mb-0 mt-2" data-admin-metric="${key}">${escapeHtml(displayMetric(read(metrics), format))}</div></div></article></div>`).join("");
  const primaryCards = renderMetricCards(METRICS.filter(([key]) => PRIMARY_METRIC_KEYS.has(key)));
  const secondaryCards = renderMetricCards(METRICS.filter(([key]) => !PRIMARY_METRIC_KEYS.has(key)));
  const rows = organizations.map((organization) => {
    const name = organization?.name || organization?.organizationName || "Không có tên";
    const status = organization?.status || "N/A";
    return `<tr><th scope="row">${escapeHtml(name)}</th><td>${escapeHtml(String(organization?.memberCount ?? "N/A"))}</td><td class="text-secondary">${escapeHtml(status)}</td><td class="text-secondary">${escapeHtml(organization?.subscriptionStatus || "N/A")}</td></tr>`;
  }).join("");
  const organizationContent = rows
    ? `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th scope="col">Tổ chức</th><th scope="col">Thành viên</th><th scope="col">Trạng thái</th><th scope="col">Đăng ký</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : adminStateMarkup("empty", { message: "Chưa có tổ chức gần đây." });
  const generatedAt = payload?.generatedAt
    ? `<p class="text-secondary small mb-0">Cập nhật: ${escapeHtml(formatDateTime(payload.generatedAt))}</p>`
    : "";
  const organizationTotal = metrics.organizations?.total ?? metrics.organizations;
  const accountTotal = metrics.users?.total ?? metrics.users;
  const organizationChart = comparisonChart({ id: "organization-status", title: "Tình trạng tổ chức", total: organizationTotal, active: metrics.activeOrganizations, activeLabel: "Hoạt động", otherLabel: "Không hoạt động" });
  const accountChart = comparisonChart({ id: "account-status", title: "Tình trạng tài khoản", total: accountTotal, active: metrics.activeAccounts, activeLabel: "Hoạt động", otherLabel: "Không hoạt động" });
  return `<div class="row row-cards">${primaryCards}</div><section class="bf-admin-chart-section mt-4" aria-labelledby="platform-distribution-title"><div class="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3"><div><h2 class="h3 mb-1" id="platform-distribution-title">Biểu đồ tổng quan</h2><p class="text-secondary mb-0">Phân bố tổ chức và tài khoản từ dữ liệu có thẩm quyền.</p></div>${generatedAt}</div><div class="row row-cards"><div class="col-lg-6">${organizationChart}</div><div class="col-lg-6">${accountChart}</div></div></section>${chartsMarkup({ overviewCharts: charts })}<section class="mt-4" aria-labelledby="operational-metrics-title"><h2 class="h3 mb-3" id="operational-metrics-title">Chỉ số vận hành</h2><div class="row row-cards">${secondaryCards}</div></section><div class="row row-cards mt-1"><div class="col-xl-7"><section class="card h-100" aria-labelledby="recent-activity-title"><div class="card-header"><div><h3 class="card-title" id="recent-activity-title">Hoạt động gần đây</h3></div></div><div class="card-body">${activityFeedMarkup(activityFeed)}</div></section></div><div class="col-xl-5"><section class="card h-100" aria-labelledby="overview-alerts-title"><div class="card-header"><h3 class="card-title" id="overview-alerts-title">Cảnh báo cần xử lý</h3></div><div class="card-body">${alertsMarkup(alerts)}</div></section></div></div><section class="card mt-4" aria-labelledby="recent-organizations-title"><div class="card-header"><h3 class="card-title" id="recent-organizations-title">Tổ chức gần đây</h3></div>${organizationContent}</section>`;
}

export async function renderAdminOverview(container, { fetchImpl, signal } = {}) {
  renderAdminMarkup(container, adminLoadingMarkup("Đang tải tổng quan quản trị…"), { busy: true });
  try {
    const payload = await getAdminJson("/api/admin/overview", { fetchImpl, signal });
    renderAdminMarkup(container, overviewMarkup(payload));
  } catch (error) {
    if (signal?.aborted) return;
    renderAdminFailure(container, error, () => renderAdminOverview(container, { fetchImpl, signal }));
  }
}

export { overviewMarkup };
