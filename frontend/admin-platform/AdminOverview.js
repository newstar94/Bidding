import { getAdminJson } from "./AdminApi.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminFailure,
  renderAdminMarkup,
} from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

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
  const description = `${activeLabel}: ${boundedActive} trên tổng số ${total} (${percentage}%). ${otherLabel}: ${other}.`;
  return `<section class="card" aria-labelledby="${id}-title"><div class="card-body"><h3 class="card-title" id="${id}-title">${escapeHtml(title)}</h3><svg class="w-100 mt-3" viewBox="0 0 100 12" role="img" aria-label="${escapeHtml(description)}"><rect x="0" y="1" width="100" height="10" rx="3" fill="currentColor" class="text-secondary opacity-25"></rect><rect x="0" y="1" width="${percentage}" height="10" rx="3" fill="currentColor" class="text-primary"></rect></svg><div class="table-responsive mt-3"><table class="table table-sm mb-0"><caption class="visually-hidden">Dữ liệu dạng bảng của ${escapeHtml(title)}</caption><thead><tr><th scope="col">Trạng thái</th><th scope="col" class="text-end">Số lượng</th></tr></thead><tbody><tr><th scope="row">${escapeHtml(activeLabel)}</th><td class="text-end">${boundedActive}</td></tr><tr><th scope="row">${escapeHtml(otherLabel)}</th><td class="text-end">${other}</td></tr></tbody></table></div></div></section>`;
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
  const cards = METRICS.map(([key, label, read, format]) => `<div class="col-sm-6 col-xl-3"><article class="card bf-admin-metric h-100"><div class="card-body"><div class="text-secondary">${escapeHtml(label)}</div><div class="h2 mb-0 mt-2" data-admin-metric="${key}">${escapeHtml(displayMetric(read(metrics), format))}</div></div></article></div>`).join("");
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
  const organizationChart = comparisonChart({ id: "organization-status", title: "Tình trạng tổ chức", total: metrics.organizations, active: metrics.activeOrganizations, activeLabel: "Hoạt động", otherLabel: "Không hoạt động" });
  const accountChart = comparisonChart({ id: "account-status", title: "Tình trạng tài khoản", total: metrics.users, active: metrics.activeAccounts, activeLabel: "Hoạt động", otherLabel: "Không hoạt động" });
  return `<div class="row row-cards">${cards}</div><div class="row row-cards mt-1"><div class="col-lg-6">${organizationChart}</div><div class="col-lg-6">${accountChart}</div></div><div class="row row-cards mt-1"><div class="col-xl-7"><section class="card h-100" aria-labelledby="recent-activity-title"><div class="card-header"><div><h3 class="card-title" id="recent-activity-title">Hoạt động gần đây</h3>${generatedAt}</div></div><div class="card-body">${activityFeedMarkup(activityFeed)}</div></section></div><div class="col-xl-5"><section class="card h-100" aria-labelledby="overview-alerts-title"><div class="card-header"><h3 class="card-title" id="overview-alerts-title">Cảnh báo cần xử lý</h3></div><div class="card-body">${alertsMarkup(alerts)}</div></section></div></div><section class="card mt-4" aria-labelledby="recent-organizations-title"><div class="card-header"><h3 class="card-title" id="recent-organizations-title">Tổ chức gần đây</h3></div>${organizationContent}</section>`;
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
