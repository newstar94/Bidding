import { renderAdminDirectory } from "./AdminDirectory.js";
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

export const AUDIT_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/audit",
  title: "Nhật ký quản trị",
  searchPlaceholder: "Hành động hoặc đối tượng",
  emptyMessage: "Không có sự kiện nhật ký phù hợp.",
  defaultSort: "created_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "action", "target_type", "sequence"],
  filters: [],
  columns: [
    { label: "Thời gian", sortKey: "created_at" },
    { label: "Hành động", sortKey: "action" },
    { label: "Đối tượng", sortKey: "target_type" },
    { label: "Người thực hiện" },
    { label: "Tổ chức" },
    { label: "Chuỗi / thứ tự", sortKey: "sequence" },
  ],
  rowMarkup(item) {
    return `<tr><td data-label="Thời gian">${formatDateTime(item?.createdAt)}</td><td data-label="Hành động"><strong>${text(item?.action)}</strong></td><td data-label="Đối tượng">${auditTarget(item)}</td><td data-label="Người thực hiện">${text(item?.actorUserId, "Hệ thống")}</td><td data-label="Tổ chức">${text(item?.organizationId, "Toàn nền tảng")}</td><td data-label="Chuỗi / thứ tự"><div>${text(item?.chainId)}</div><div class="small text-secondary">#${text(item?.sequence)}</div></td></tr>`;
  },
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
  ],
  rowMarkup(item) {
    return `<tr><td data-label="Người dùng">${sessionUser(item)}</td><td data-label="Trạng thái">${text(item?.status)}</td><td data-label="Hoạt động gần nhất">${formatDateTime(item?.lastSeenAt)}</td><td data-label="Hết hạn tuyệt đối">${formatDateTime(item?.absoluteExpiresAt)}</td><td data-label="Vai trò đang dùng"><div>${text(item?.activeRole, item?.user?.platformRole || "N/A")}</div><div class="small text-secondary">${text(item?.activeRoleOrganizationId, "Không gian nền tảng")}</div></td><td data-label="Ghi nhớ đăng nhập">${item?.rememberMe === true ? "Có" : "Không"}</td></tr>`;
  },
});

export function renderAdminAudit(container, options) {
  return renderAdminDirectory(container, AUDIT_DIRECTORY, options);
}

export function renderAdminSecurity(container, options) {
  return renderAdminDirectory(container, SESSION_DIRECTORY, options);
}

