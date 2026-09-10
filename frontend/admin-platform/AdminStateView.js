import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml } from "../shared/view_helpers.js";

const STATE_COPY = Object.freeze({
  empty: {
    title: "Chưa có dữ liệu",
    message: "Máy chủ chưa ghi nhận dữ liệu cho mục này.",
  },
  error: {
    title: "Không thể tải dữ liệu",
    message: "Kết nối tới máy chủ không thành công.",
  },
  permission: {
    title: "Không có quyền truy cập",
    message: "Tài khoản hiện tại không được phép xem dữ liệu này.",
  },
});

export function adminLoadingMarkup(label = "Đang tải dữ liệu…") {
  return `<div class="bf-admin-skeleton" role="status" aria-live="polite"><span class="visually-hidden">${escapeHtml(label)}</span><div class="placeholder-glow"><span class="placeholder col-4"></span><span class="placeholder col-8"></span><span class="placeholder col-6"></span></div></div>`;
}

export function adminStateMarkup(state, { title, message, retry = false } = {}) {
  const copy = STATE_COPY[state] || STATE_COPY.error;
  const action = retry
    ? '<div class="empty-action"><button class="btn btn-primary" type="button" data-admin-retry>Thử lại</button></div>'
    : "";
  return `<div class="empty bf-admin-state" data-admin-state="${escapeHtml(state)}"><p class="empty-title">${escapeHtml(title || copy.title)}</p><p class="empty-subtitle text-secondary">${escapeHtml(message || copy.message)}</p>${action}</div>`;
}

export function renderAdminMarkup(container, markup, { busy = false } = {}) {
  if (!container) return;
  container.setAttribute("aria-busy", String(busy));
  container.innerHTML = trustedHTML(markup);
}

export function renderAdminFailure(container, error, retry) {
  const permission = error?.status === 401 || error?.status === 403;
  renderAdminMarkup(container, adminStateMarkup(permission ? "permission" : "error", {
    message: error?.message,
    retry: !permission,
  }));
  container?.querySelector("[data-admin-retry]")?.addEventListener("click", retry, { once: true });
}
