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
  ["users", "Người dùng", (metrics) => metrics.users?.total ?? metrics.users],
  ["activeSubscriptions", "Đăng ký đang hoạt động", (metrics) => metrics.subscriptions?.active ?? metrics.activeSubscriptions],
  ["verifiedRevenue", "Doanh thu tháng đã xác minh", (metrics) => metrics.billing?.verifiedRevenue ?? metrics.currentPeriodRevenue?.value],
]);

function displayMetric(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat("vi-VN").format(value) : "N/A";
}

function overviewMarkup(payload) {
  const metrics = payload?.metrics && typeof payload.metrics === "object" ? payload.metrics : {};
  const organizations = Array.isArray(payload?.recentOrganizations) ? payload.recentOrganizations : [];
  const cards = METRICS.map(([key, label, read]) => `<div class="col-sm-6 col-xl-3"><article class="card bf-admin-metric"><div class="card-body"><div class="text-secondary">${escapeHtml(label)}</div><div class="h1 mb-0" data-admin-metric="${key}">${escapeHtml(displayMetric(read(metrics)))}</div></div></article></div>`).join("");
  const rows = organizations.map((organization) => {
    const name = organization?.name || organization?.organizationName || "Không có tên";
    const status = organization?.status || "N/A";
    return `<tr><td>${escapeHtml(name)}</td><td class="text-secondary">${escapeHtml(status)}</td></tr>`;
  }).join("");
  const organizationContent = rows
    ? `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Tổ chức</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : adminStateMarkup("empty", { message: "Chưa có tổ chức gần đây." });
  const generatedAt = payload?.generatedAt
    ? `<p class="text-secondary small mb-0">Cập nhật: ${escapeHtml(new Date(payload.generatedAt).toLocaleString("vi-VN"))}</p>`
    : "";
  return `<div class="row row-cards">${cards}</div><section class="card mt-4" aria-labelledby="recent-organizations-title"><div class="card-header"><div><h3 class="card-title" id="recent-organizations-title">Tổ chức gần đây</h3>${generatedAt}</div></div>${organizationContent}</section>`;
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
