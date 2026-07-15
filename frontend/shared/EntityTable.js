import { escapeHtml, htmlIcon, renderEmptyRow } from "./view_helpers.js";

function safeColspan(value) {
  return Math.max(1, Number.parseInt(value, 10) || 1);
}

export function renderTableLoading(tableBody, colspan, message = "Đang tải dữ liệu từ máy chủ...") {
  if (!tableBody || tableBody.children.length > 0) return false;
  tableBody.innerHTML = `<tr data-table-state="loading"><td colspan="${safeColspan(colspan)}"><div class="empty-state" role="status" aria-label="${escapeHtml(message)}"><span class="skeleton-item skeleton-title"></span><span class="skeleton-item skeleton-text"></span><span class="skeleton-item skeleton-text"></span></div></td></tr>`;
  return true;
}

export function renderTableEmpty(tableBody, { colspan, message, icon = "inbox", pagination = null }) {
  if (!tableBody) return;
  tableBody.innerHTML = renderEmptyRow(colspan, message, icon);
  if (pagination) pagination.innerHTML = "";
}

export function renderTableError(tableBody, {
  colspan,
  message = "Không thể tải dữ liệu. Vui lòng thử lại.",
  onRetry = null,
  retryLabel = "Thử lại"
}) {
  if (!tableBody) return;
  tableBody.innerHTML = `<tr data-table-state="error"><td colspan="${safeColspan(colspan)}"><div class="empty-state text-danger">${htmlIcon("circle-alert")}<p>${escapeHtml(message)}</p>${typeof onRetry === "function" ? `<button type="button" class="btn btn-secondary" data-table-retry>${escapeHtml(retryLabel)}</button>` : ""}</div></td></tr>`;
  if (typeof onRetry === "function") {
    tableBody.querySelector("[data-table-retry]")?.addEventListener("click", onRetry, { once: true });
  }
}
