import { getAdminJson } from "./AdminApi.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminFailure,
  renderAdminMarkup,
} from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

function text(value, fallback = "N/A") {
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return escapeHtml(normalized || fallback);
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const source = typeof value === "number" ? value * 1_000 : value;
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? text(value) : escapeHtml(date.toLocaleString("vi-VN"));
}

function releaseCard(title, release) {
  if (!release) {
    return `<section class="card h-100" aria-label="${escapeHtml(title)}"><div class="card-body">${adminStateMarkup("empty", { title, message: "Chưa có bản phát hành ở trạng thái này." })}</div></section>`;
  }
  const sellable = release.nonSellable === true ? "Không bán" : (release.nonSellable === false ? "Có thể bán" : "N/A");
  return `<section class="card h-100" aria-label="${escapeHtml(title)}"><div class="card-header"><h3 class="card-title">${escapeHtml(title)}</h3></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody><tr><th scope="row">Phiên bản</th><td><strong>${text(release.versionLabel)}</strong></td></tr><tr><th scope="row">Chế độ</th><td>${text(release.mode)}</td></tr><tr><th scope="row">Phạm vi</th><td>${text(release.scopeKey)}</td></tr><tr><th scope="row">Tình trạng bán</th><td>${sellable}</td></tr><tr><th scope="row">Hiệu lực</th><td>${formatDate(release.effectiveFrom)}</td></tr></tbody></table></div></section>`;
}

function draftTable(drafts) {
  if (!drafts.length) return adminStateMarkup("empty", { message: "Chưa có bản nháp chính sách thương mại đang mở." });
  const rows = drafts.map((draft) => `<tr><td><strong>${text(draft?.id)}</strong></td><td>${text(draft?.status)}</td><td class="text-end">${Number.isSafeInteger(draft?.revision) ? escapeHtml(draft.revision) : "N/A"}</td><td>${text(draft?.baseReleaseId ?? draft?.base_release_id)}</td><td>${formatDate(draft?.updatedAt ?? draft?.updated_at)}</td></tr>`).join("");
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Bản nháp</th><th>Trạng thái</th><th class="text-end">Lần sửa</th><th>Phiên bản gốc</th><th>Cập nhật</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function plansMarkup(payload) {
  const current = payload?.currentRelease || null;
  const scheduled = payload?.scheduledRelease || null;
  const drafts = Array.isArray(payload?.drafts) ? payload.drafts : [];
  if (!current && !scheduled && drafts.length === 0) {
    return adminStateMarkup("empty", { message: "Chưa có phiên bản gói dịch vụ hoặc bản nháp thương mại." });
  }
  return `<div class="row row-cards"><div class="col-lg-6">${releaseCard("Bản đang hiệu lực", current)}</div><div class="col-lg-6">${releaseCard("Bản đã lên lịch", scheduled)}</div><div class="col-12"><section class="card" aria-labelledby="commercial-drafts-title"><div class="card-header"><div><h3 class="card-title" id="commercial-drafts-title">Bản nháp thương mại</h3><p class="text-secondary small mb-0">Chế độ chỉ đọc. Thay đổi và phát hành chính sách vẫn dùng quy trình thương mại hiện hành.</p></div></div>${draftTable(drafts)}</section></div></div>`;
}

export async function renderAdminPlans(container, { fetchImpl, signal } = {}) {
  renderAdminMarkup(container, adminLoadingMarkup("Đang tải phiên bản gói dịch vụ…"), { busy: true });
  try {
    const payload = await getAdminJson("/api/commercial/admin/overview", { fetchImpl, signal });
    renderAdminMarkup(container, plansMarkup(payload));
  } catch (error) {
    if (signal?.aborted) return;
    renderAdminFailure(container, error, () => renderAdminPlans(container, { fetchImpl, signal }));
  }
}
