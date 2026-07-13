import { escapeHtml, htmlIcon, renderEmptyRow } from "../subviews/view_helpers.js";

function safeColspan(value) {
  return Math.max(1, Number.parseInt(value, 10) || 1);
}

export function renderTableLoading(tableBody, colspan, message = "Đang tải dữ liệu từ máy chủ...") {
  if (!tableBody || tableBody.children.length > 0) return false;
  tableBody.innerHTML = `<tr data-table-state="loading"><td colspan="${safeColspan(colspan)}"><div class="empty-state">${htmlIcon("loader-circle")}<p>${escapeHtml(message)}</p></div></td></tr>`;
  return true;
}

export function renderTableEmpty(tableBody, { colspan, message, icon = "inbox", pagination = null }) {
  if (!tableBody) return;
  tableBody.innerHTML = renderEmptyRow(colspan, message, icon);
  if (pagination) pagination.innerHTML = "";
}

export function renderTableError(tableBody, { colspan, message = "Không thể tải dữ liệu. Vui lòng thử lại." }) {
  if (!tableBody) return;
  tableBody.innerHTML = `<tr data-table-state="error"><td colspan="${safeColspan(colspan)}"><div class="empty-state text-danger">${htmlIcon("circle-alert")}<p>${escapeHtml(message)}</p></div></td></tr>`;
}
