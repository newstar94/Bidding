import { renderAdminDirectory } from "./AdminDirectory.js";
import { escapeHtml } from "../shared/view_helpers.js";

function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const source = typeof value === "number" ? value * 1_000 : value;
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? text(value) : escapeHtml(date.toLocaleDateString("vi-VN"));
}

function membershipsMarkup(organizations) {
  if (!Array.isArray(organizations) || organizations.length === 0) return "N/A";
  return organizations.map((organization) => {
    const employee = [organization.employeeName, organization.employeePhone].filter(Boolean).map(text).join(" · ");
    return `<div><strong>${text(organization.name)}</strong><div class="small text-secondary">${text(organization.role)}${employee ? ` · ${employee}` : ""}</div></div>`;
  }).join("");
}

export const USER_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/users",
  title: "Người dùng",
  searchPlaceholder: "Tên, tài khoản hoặc email",
  emptyMessage: "Không có người dùng phù hợp với bộ lọc.",
  defaultSort: "name",
  sortKeys: ["name", "username", "email", "role", "status", "created_at", "updated_at"],
  filters: [
    { key: "role", label: "Vai trò", allLabel: "Mọi vai trò", options: [["super_admin", "Quản trị nền tảng"], ["user", "Người dùng"]] },
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["active", "Hoạt động"], ["inactive", "Không hoạt động"]] },
  ],
  columns: [
    { label: "Người dùng", sortKey: "name" }, { label: "Email", sortKey: "email" },
    { label: "Vai trò", sortKey: "role" }, { label: "Trạng thái", sortKey: "status" },
    { label: "Tổ chức" }, { label: "Ngày tạo", sortKey: "created_at" },
  ],
  rowMarkup(user) {
    return `<tr><td data-label="Người dùng"><strong>${text(user?.name)}</strong><div class="small text-secondary">${text(user?.username)}</div></td><td data-label="Email">${text(user?.email)}</td><td data-label="Vai trò">${text(user?.role)}</td><td data-label="Trạng thái">${text(user?.status)}</td><td data-label="Tổ chức">${membershipsMarkup(user?.organizations)}</td><td data-label="Ngày tạo">${formatDate(user?.createdAt)}</td></tr>`;
  },
});

export const ORGANIZATION_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/organizations",
  title: "Tổ chức",
  searchPlaceholder: "Tên hoặc mã tổ chức",
  emptyMessage: "Không có tổ chức phù hợp với bộ lọc.",
  defaultSort: "name",
  sortKeys: ["name", "status", "member_count", "created_at", "updated_at"],
  filters: [
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["active", "Hoạt động"], ["suspended", "Tạm dừng"]] },
    { key: "subscriptionStatus", label: "Đăng ký", allLabel: "Mọi đăng ký", options: [["active", "Hoạt động"], ["expired", "Hết hạn"], ["suspended", "Tạm dừng"], ["cancelled", "Đã hủy"]] },
  ],
  columns: [
    { label: "Tổ chức", sortKey: "name" }, { label: "Trạng thái", sortKey: "status" },
    { label: "Thành viên", sortKey: "member_count" }, { label: "Gói dịch vụ" },
    { label: "Trạng thái đăng ký" }, { label: "Hết hạn" }, { label: "Ngày tạo", sortKey: "created_at" },
  ],
  rowMarkup(organization) {
    const subscription = organization?.subscription;
    return `<tr><td data-label="Tổ chức"><strong>${text(organization?.name)}</strong><div class="small text-secondary">${text(organization?.id)}</div></td><td data-label="Trạng thái">${text(organization?.status)}</td><td data-label="Thành viên">${Number.isFinite(organization?.memberCount) ? escapeHtml(organization.memberCount) : "N/A"}</td><td data-label="Gói dịch vụ">${text(subscription?.packageId)}</td><td data-label="Trạng thái đăng ký">${text(subscription?.status)}</td><td data-label="Hết hạn">${formatDate(subscription?.expiresAt)}</td><td data-label="Ngày tạo">${formatDate(organization?.createdAt)}</td></tr>`;
  },
});

export function renderAdminUsers(container, options) {
  return renderAdminDirectory(container, USER_DIRECTORY, options);
}

export function renderAdminOrganizations(container, options) {
  return renderAdminDirectory(container, ORGANIZATION_DIRECTORY, options);
}
