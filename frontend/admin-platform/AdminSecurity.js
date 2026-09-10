import { renderAdminDirectory } from "./AdminDirectory.js";
import { renderAdminMarkup } from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

function formatDateTime(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const source = typeof value === "number" ? value * 1_000 : value;
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? "N/A" : escapeHtml(date.toLocaleString("vi-VN"));
}

function auditTarget(item) {
  if (!item?.targetType && !item?.targetId) return "N/A";
  return `<div>${text(item.targetType)}</div><div class="small text-secondary">${text(item.targetId)}</div>`;
}

function sessionUser(item) {
  const user = item?.user;
  return `<div><strong>${text(user?.name)}</strong></div><div class="small text-secondary">${text(user?.email)}</div>`;
}

function detailRow(label, value, fallback = "N/A") {
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${text(value, fallback)}</td></tr>`;
}

function detailCard(title, body) {
  return `<section class="card mt-3" data-admin-security-detail tabindex="-1" aria-labelledby="admin-security-detail-title"><div class="card-header"><h3 class="card-title" id="admin-security-detail-title">${escapeHtml(title)}</h3><div class="card-actions"><button class="btn btn-sm btn-ghost-secondary" type="button" data-admin-security-detail-close>Đóng</button></div></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody>${body}</tbody></table></div></section>`;
}

export function auditDetailMarkup(item) {
  return detailCard("Chi tiết sự kiện nhật ký", [
    detailRow("Thời gian", formatDateTime(item?.createdAt)),
    detailRow("Hành động", item?.action),
    detailRow("Người thực hiện", item?.actorUserId, "Hệ thống"),
    detailRow("Tổ chức", item?.organizationId, "Toàn nền tảng"),
    detailRow("Loại đối tượng", item?.targetType),
    detailRow("Đối tượng", item?.targetId),
    detailRow("Chuỗi nhật ký", item?.chainId),
    detailRow("Thứ tự", item?.sequence),
  ].join(""));
}

export function sessionDetailMarkup(item) {
  const user = item?.user || {};
  return detailCard("Chi tiết phiên đăng nhập", [
    detailRow("Người dùng", user.name || user.username),
    detailRow("Tên đăng nhập", user.username),
    detailRow("Email", user.email),
    detailRow("Trạng thái tài khoản", user.status),
    detailRow("Vai trò nền tảng", user.platformRole),
    detailRow("Trạng thái phiên", item?.status),
    detailRow("Tạo lúc", formatDateTime(item?.createdAt)),
    detailRow("Hoạt động gần nhất", formatDateTime(item?.lastSeenAt)),
    detailRow("Hết hạn không hoạt động", formatDateTime(item?.idleExpiresAt)),
    detailRow("Hết hạn tuyệt đối", formatDateTime(item?.absoluteExpiresAt)),
    ...(item?.revokedAt ? [detailRow("Thu hồi lúc", formatDateTime(item.revokedAt))] : []),
    detailRow("Vai trò đang dùng", item?.activeRole, user.platformRole || "N/A"),
    detailRow("Tổ chức của vai trò", item?.activeRoleOrganizationId, "Không gian nền tảng"),
    detailRow("Ghi nhớ đăng nhập", item?.rememberMe === true ? "Có" : "Không"),
  ].join(""));
}

function bindSafeDetails(results, payload, markup) {
  results.querySelectorAll("[data-admin-security-detail-index]").forEach((button) => {
    button.addEventListener("click", () => {
      results.querySelector("[data-admin-security-detail]")?.remove();
      const item = payload?.items?.[Number(button.dataset.adminSecurityDetailIndex)];
      if (!item) return;
      const host = document.createElement("div");
      renderAdminMarkup(host, markup(item));
      const detail = host.firstElementChild;
      if (!detail) return;
      results.append(detail);
      detail.querySelector("[data-admin-security-detail-close]")?.addEventListener("click", () => {
        detail.remove();
        button.focus();
      });
      detail.focus({ preventScroll: true });
      detail.scrollIntoView({ block: "nearest" });
    });
  });
}

export const AUDIT_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/audit",
  title: "Nhật ký quản trị",
  searchPlaceholder: "Hành động hoặc đối tượng",
  emptyMessage: "Không có sự kiện nhật ký phù hợp.",
  defaultSort: "created_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "action", "target_type", "sequence"],
  filters: [
    {
      key: "action",
      label: "Loại sự kiện đăng nhập",
      allLabel: "Mọi sự kiện",
      options: [
        ["auth.login_success", "Đăng nhập mật khẩu thành công"],
        ["auth.login_failed", "Đăng nhập mật khẩu thất bại"],
        ["auth.google_login_success", "Đăng nhập Google thành công"],
        ["auth.google_login_failed", "Đăng nhập Google thất bại"],
      ],
    },
  ],
  columns: [
    { label: "Thời gian", sortKey: "created_at" },
    { label: "Hành động", sortKey: "action" },
    { label: "Đối tượng", sortKey: "target_type" },
    { label: "Người thực hiện" },
    { label: "Tổ chức" },
    { label: "Chuỗi / thứ tự", sortKey: "sequence" },
    { label: "Chi tiết" },
  ],
  rowMarkup(item, index) {
    return `<tr><td data-label="Thời gian">${formatDateTime(item?.createdAt)}</td><td data-label="Hành động"><strong>${text(item?.action)}</strong></td><td data-label="Đối tượng">${auditTarget(item)}</td><td data-label="Người thực hiện">${text(item?.actorUserId, "Hệ thống")}</td><td data-label="Tổ chức">${text(item?.organizationId, "Toàn nền tảng")}</td><td data-label="Chuỗi / thứ tự"><div>${text(item?.chainId)}</div><div class="small text-secondary">#${text(item?.sequence)}</div></td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-secondary" type="button" data-admin-security-detail-index="${index}">Xem</button></td></tr>`;
  },
  bindResultActions(results, { payload }) { bindSafeDetails(results, payload, auditDetailMarkup); },
});

export const SESSION_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/security/sessions",
  title: "Phiên đăng nhập",
  searchPlaceholder: "Tên, tài khoản hoặc email",
  emptyMessage: "Không có phiên đăng nhập phù hợp.",
  defaultSort: "last_seen_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "last_seen_at", "absolute_expires_at", "user"],
  filters: [
    {
      key: "status",
      label: "Trạng thái phiên",
      allLabel: "Mọi trạng thái",
      options: [["active", "Đang hoạt động"], ["expired", "Đã hết hạn"], ["revoked", "Đã thu hồi"]],
    },
  ],
  columns: [
    { label: "Người dùng", sortKey: "user" },
    { label: "Trạng thái" },
    { label: "Hoạt động gần nhất", sortKey: "last_seen_at" },
    { label: "Hết hạn tuyệt đối", sortKey: "absolute_expires_at" },
    { label: "Vai trò đang dùng" },
    { label: "Ghi nhớ đăng nhập" },
    { label: "Chi tiết" },
  ],
  rowMarkup(item, index) {
    return `<tr><td data-label="Người dùng">${sessionUser(item)}</td><td data-label="Trạng thái">${text(item?.status)}</td><td data-label="Hoạt động gần nhất">${formatDateTime(item?.lastSeenAt)}</td><td data-label="Hết hạn tuyệt đối">${formatDateTime(item?.absoluteExpiresAt)}</td><td data-label="Vai trò đang dùng"><div>${text(item?.activeRole, item?.user?.platformRole || "N/A")}</div><div class="small text-secondary">${text(item?.activeRoleOrganizationId, "Không gian nền tảng")}</div></td><td data-label="Ghi nhớ đăng nhập">${item?.rememberMe === true ? "Có" : "Không"}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-secondary" type="button" data-admin-security-detail-index="${index}">Xem</button></td></tr>`;
  },
  bindResultActions(results, { payload }) { bindSafeDetails(results, payload, sessionDetailMarkup); },
});

export function renderAdminAudit(container, options) {
  return renderAdminDirectory(container, AUDIT_DIRECTORY, options);
}

export function renderAdminSecurity(container, options) {
  return renderAdminDirectory(container, SESSION_DIRECTORY, options);
}
