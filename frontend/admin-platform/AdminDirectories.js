import { renderAdminDirectory } from "./AdminDirectory.js";
import { deleteAdminJson, getAdminJson, postAdminJson, requiresPrivilegedReauthentication } from "./AdminApi.js";
import { requestAdminValue } from "./AdminBilling.js";
import { adminLoadingMarkup, adminStateMarkup } from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { trustedHTML } from "../shared/trustedTypes.js";

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

function auditMarkup(items) {
  if (!Array.isArray(items) || items.length === 0) return '<p class="text-secondary">Chưa có hoạt động gần đây.</p>';
  return `<ul class="list-group list-group-flush">${items.map((item) => `<li class="list-group-item px-0"><strong>${text(item.action)}</strong><div class="small text-secondary">${formatDate(item.createdAt)} · ${text(item.targetType)} · ${text(item.targetId)}</div></li>`).join("")}</ul>`;
}

function linksMarkup(links) {
  const labels = { sessions: "Phiên đăng nhập", subscription: "Đăng ký", usage: "Sử dụng", audit: "Nhật ký", users: "Người dùng", activity: "Hoạt động", security: "Bảo mật" };
  return `<nav class="btn-list mb-4" aria-label="Liên kết chi tiết">${Object.entries(links || {}).map(([key, href]) => `<a class="btn btn-sm btn-outline-secondary" href="${text(href, "#")}">${text(labels[key] || key)}</a>`).join("")}</nav>`;
}

function idempotencyKey(action) {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `admin-org:${action}:${random}`;
}

async function runPrivilegedMutation(mutate, { fetchImpl, signal, requestPassword }) {
  try {
    return await mutate();
  } catch (error) {
    if (!requiresPrivilegedReauthentication(error)) throw error;
    const password = await requestPassword();
    if (password === null) return null;
    await postAdminJson("/api/auth/privileged-reauth", {
      body: { password }, fetchImpl, signal,
    });
    return mutate();
  }
}

export async function executeUserDirectoryAction(action, user, value, {
  fetchImpl,
  signal,
  confirmImpl = (message) => globalThis.confirm?.(message) === true,
  requestPassword = () => requestAdminValue({
    title: "Xác thực thao tác quản trị",
    message: "Nhập lại mật khẩu để tiếp tục thao tác nhạy cảm.",
    label: "Mật khẩu hiện tại",
    type: "password",
  }),
} = {}) {
  const userId = String(user?.id || "").trim();
  if (!userId) throw new TypeError("User ID is required");
  const descriptions = {
    role: `Thay đổi vai trò nền tảng của ${user?.name || userId}?`,
    name: `Cập nhật tên hiển thị của ${user?.name || userId}?`,
    deactivate: `Ngừng hoạt động tài khoản ${user?.name || userId}? Các phiên đăng nhập sẽ bị thu hồi.`,
  };
  if (!Object.hasOwn(descriptions, action)) throw new TypeError("Unsupported user action");
  if (!await confirmImpl(descriptions[action])) return { cancelled: true };
  let mutate;
  if (action === "role") {
    const role = String(value || "").trim();
    if (!["super_admin", "user"].includes(role)) throw new Error("Vai trò nền tảng không hợp lệ.");
    mutate = () => postAdminJson("/api/auth/users/update-role", {
      body: { user_id: userId, role, scope: "platform" }, fetchImpl, signal,
    });
  } else if (action === "name") {
    const name = String(value || "").trim();
    if (!name) throw new Error("Tên hiển thị không được để trống.");
    mutate = () => postAdminJson("/api/auth/users/update-metadata", {
      body: { user_id: userId, field: "name", value: name }, fetchImpl, signal,
    });
  } else {
    mutate = () => deleteAdminJson(`/api/auth/users/${encodeURIComponent(userId)}`, { fetchImpl, signal });
  }
  const payload = await runPrivilegedMutation(mutate, { fetchImpl, signal, requestPassword });
  return payload === null ? { cancelled: true } : { payload };
}

export async function executeOrganizationDirectoryAction(action, organization, value, {
  fetchImpl,
  signal,
  confirmImpl = (message) => globalThis.confirm?.(message) === true,
  requestPassword = () => requestAdminValue({
    title: "Xác thực thao tác quản trị",
    message: "Nhập lại mật khẩu để tiếp tục thao tác nhạy cảm.",
    label: "Mật khẩu hiện tại",
    type: "password",
  }),
  requestIdempotencyKey = idempotencyKey(action),
} = {}) {
  const organizationId = String(organization?.id || "").trim();
  if (!organizationId) throw new TypeError("Organization ID is required");
  if (!["lock", "unlock", "renew", "set_package"].includes(action)) throw new TypeError("Unsupported organization action");
  const body = { organization_id: organizationId, action };
  if (action === "set_package") {
    const packageId = String(value || "").trim();
    if (!packageId) throw new Error("Mã gói dịch vụ không được để trống.");
    body.package_id = packageId;
  }
  const labels = { lock: "Khóa", unlock: "Mở khóa", renew: "Gia hạn", set_package: "Đổi gói" };
  if (!await confirmImpl(`${labels[action]} đăng ký của tổ chức ${organization?.name || organizationId}?`)) {
    return { cancelled: true };
  }
  const mutate = () => postAdminJson("/api/organizations/subscription", {
    body, idempotencyKey: requestIdempotencyKey, fetchImpl, signal,
  });
  const payload = await runPrivilegedMutation(mutate, { fetchImpl, signal, requestPassword });
  return payload === null ? { cancelled: true } : { payload };
}

export function userDetailMarkup(user) {
  const subscription = user?.subscription;
  const usage = user?.usage;
  return `<div class="offcanvas-header"><div><div class="text-secondary small">Tài khoản ${text(user?.id)}</div><h2 class="offcanvas-title">${text(user?.name)}</h2></div><button class="btn-close" type="button" aria-label="Đóng" data-admin-close-detail></button></div><div class="offcanvas-body">${linksMarkup(user?.links)}<dl class="row"><dt class="col-4">Tên đăng nhập</dt><dd class="col-8">${text(user?.username)}</dd><dt class="col-4">Email</dt><dd class="col-8">${text(user?.email)}</dd><dt class="col-4">Trạng thái</dt><dd class="col-8">${text(user?.status)}</dd><dt class="col-4">Hoạt động gần nhất</dt><dd class="col-8">${formatDate(user?.lastActiveAt)}</dd><dt class="col-4">Phiên hoạt động</dt><dd class="col-8">${Number.isFinite(user?.activeSessionCount) ? escapeHtml(user.activeSessionCount) : "N/A"}</dd><dt class="col-4">Gói dịch vụ</dt><dd class="col-8">${text(subscription?.packageId)}</dd><dt class="col-4">Trạng thái đăng ký</dt><dd class="col-8">${text(subscription?.status)}</dd><dt class="col-4">Sự kiện sử dụng</dt><dd class="col-8">${Number.isFinite(usage?.eventCount) ? escapeHtml(usage.eventCount) : "N/A"}</dd><dt class="col-4">Ngày tạo</dt><dd class="col-8">${formatDate(user?.createdAt)}</dd><dt class="col-4">Cập nhật</dt><dd class="col-8">${formatDate(user?.updatedAt)}</dd></dl><section class="mb-4"><h3 class="h4">Tổ chức và vai trò (${Number.isFinite(user?.organizationCount) ? escapeHtml(user.organizationCount) : "N/A"})</h3>${membershipsMarkup(user?.organizations)}</section><section class="mb-4"><h3 class="h4">Hoạt động gần đây</h3>${auditMarkup(user?.recentAudit)}</section><form data-admin-user-form="name" class="mb-3"><label class="form-label">Tên hiển thị<input class="form-control" name="value" value="${text(user?.name, "")}" required maxlength="200"></label><button class="btn btn-outline-primary" type="submit">Cập nhật tên</button></form><form data-admin-user-form="role" class="mb-3"><label class="form-label">Vai trò nền tảng<select class="form-select" name="value"><option value="user"${user?.role === "user" ? " selected" : ""}>Người dùng</option><option value="super_admin"${user?.role === "super_admin" ? " selected" : ""}>Quản trị nền tảng</option></select></label><button class="btn btn-outline-primary" type="submit">Cập nhật vai trò</button></form>${user?.status === "active" ? '<button class="btn btn-outline-danger" type="button" data-admin-user-action="deactivate">Ngừng hoạt động tài khoản</button>' : ""}<div class="mt-3" role="status" aria-live="polite" data-admin-detail-status></div></div>`;
}

export function organizationDetailMarkup(organization) {
  const subscription = organization?.subscription;
  const primary = organization?.primaryContact;
  const usage = organization?.usage;
  const action = organization?.status === "suspended" ? "unlock" : "lock";
  const users = Array.isArray(organization?.users) ? organization.users : [];
  return `<div class="offcanvas-header"><div><div class="text-secondary small">Tổ chức ${text(organization?.id)}</div><h2 class="offcanvas-title">${text(organization?.name)}</h2></div><button class="btn-close" type="button" aria-label="Đóng" data-admin-close-detail></button></div><div class="offcanvas-body">${linksMarkup(organization?.links)}<dl class="row"><dt class="col-5">Trạng thái</dt><dd class="col-7">${text(organization?.status)}</dd><dt class="col-5">Liên hệ chính</dt><dd class="col-7">${primary ? `${text(primary.name)}<div class="small text-secondary">${text(primary.email)}</div>` : "N/A"}</dd><dt class="col-5">Thành viên</dt><dd class="col-7">${Number.isFinite(organization?.memberCount) ? escapeHtml(organization.memberCount) : "N/A"}</dd><dt class="col-5">Phiên hoạt động</dt><dd class="col-7">${Number.isFinite(organization?.security?.activeSessionCount) ? escapeHtml(organization.security.activeSessionCount) : "N/A"}</dd><dt class="col-5">Hoạt động gần nhất</dt><dd class="col-7">${formatDate(usage?.lastSeenAt)}</dd><dt class="col-5">Sự kiện sử dụng</dt><dd class="col-7">${Number.isFinite(usage?.eventCount) ? escapeHtml(usage.eventCount) : "N/A"}</dd><dt class="col-5">Gói dịch vụ</dt><dd class="col-7">${text(subscription?.packageId)}</dd><dt class="col-5">Đăng ký</dt><dd class="col-7">${text(subscription?.status)}</dd><dt class="col-5">Bắt đầu</dt><dd class="col-7">${formatDate(subscription?.startsAt)}</dd><dt class="col-5">Hết hạn</dt><dd class="col-7">${formatDate(subscription?.expiresAt)}</dd><dt class="col-5">Hạn mức</dt><dd class="col-7">${Number.isFinite(subscription?.memberQuota) ? escapeHtml(subscription.memberQuota) : "N/A"}</dd></dl><section class="mb-4"><h3 class="h4">Người dùng gần đây</h3>${users.length ? users.map((item) => `<div class="mb-2"><strong>${text(item.name)}</strong><div class="small text-secondary">${text(item.email)} · ${text(item.role)} · ${formatDate(item.lastActiveAt)}</div></div>`).join("") : '<p class="text-secondary">Chưa có thành viên.</p>'}</section><section class="mb-4"><h3 class="h4">Hoạt động gần đây</h3>${auditMarkup(organization?.recentAudit)}</section>${subscription ? `<div class="btn-list mb-3"><button class="btn btn-outline-${action === "lock" ? "danger" : "primary"}" type="button" data-admin-organization-action="${action}">${action === "lock" ? "Khóa đăng ký" : "Mở khóa đăng ký"}</button><button class="btn btn-outline-primary" type="button" data-admin-organization-action="renew">Gia hạn theo chính sách hiện hành</button></div><form data-admin-organization-form="set_package"><label class="form-label">Mã gói dịch vụ<input class="form-control" name="value" value="${text(subscription?.packageId, "")}" required maxlength="128"></label><button class="btn btn-outline-primary" type="submit">Đổi gói</button></form>` : '<p class="text-secondary">Tổ chức chưa có đăng ký để thao tác.</p>'}<div class="mt-3" role="status" aria-live="polite" data-admin-detail-status></div></div>`;
}

function openDetailDrawer(markup, bind) {
  document.querySelector("[data-admin-detail-drawer]")?.remove();
  document.querySelector("[data-admin-detail-backdrop]")?.remove();
  const drawer = document.createElement("aside");
  drawer.className = "offcanvas offcanvas-end show";
  drawer.tabIndex = -1;
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-label", "Chi tiết quản trị");
  drawer.setAttribute("data-admin-detail-drawer", "");
  drawer.style.visibility = "visible";
  drawer.innerHTML = trustedHTML(markup);
  const backdrop = document.createElement("div");
  backdrop.className = "offcanvas-backdrop fade show";
  backdrop.setAttribute("data-admin-detail-backdrop", "");
  const close = () => { drawer.remove(); backdrop.remove(); };
  drawer.querySelector("[data-admin-close-detail]")?.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  drawer.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  document.body.append(drawer, backdrop);
  bind(drawer, close);
  drawer.querySelector("button, input, select")?.focus();
}

function setActionState(drawer, busy, message = "", failed = false) {
  drawer.setAttribute("aria-busy", String(busy));
  drawer.querySelectorAll("button, input, select").forEach((control) => { control.disabled = busy; });
  const status = drawer.querySelector("[data-admin-detail-status]");
  if (status) { status.textContent = message; status.className = `mt-3 ${failed ? "text-danger" : "text-success"}`; }
}

function bindUserDetail(drawer, user, options, close) {
  const run = async (action, value) => {
    setActionState(drawer, true, "Đang xử lý…");
    try {
      const result = await executeUserDirectoryAction(action, user, value, options);
      if (result.cancelled) return setActionState(drawer, false, "Đã hủy thao tác.");
      close(); await options.reload?.();
    } catch (error) { setActionState(drawer, false, error?.message || "Không thể thực hiện thao tác.", true); }
  };
  drawer.querySelectorAll("[data-admin-user-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault(); void run(form.dataset.adminUserForm, new FormData(form).get("value"));
  }));
  drawer.querySelector("[data-admin-user-action='deactivate']")?.addEventListener("click", () => void run("deactivate"));
}

function bindOrganizationDetail(drawer, organization, options, close) {
  const run = async (action, value) => {
    setActionState(drawer, true, "Đang xử lý…");
    try {
      const result = await executeOrganizationDirectoryAction(action, organization, value, options);
      if (result.cancelled) return setActionState(drawer, false, "Đã hủy thao tác.");
      close(); await options.reload?.();
    } catch (error) { setActionState(drawer, false, error?.message || "Không thể thực hiện thao tác.", true); }
  };
  drawer.querySelectorAll("[data-admin-organization-action]").forEach((button) => button.addEventListener("click", () => void run(button.dataset.adminOrganizationAction)));
  drawer.querySelector("[data-admin-organization-form]")?.addEventListener("submit", (event) => {
    event.preventDefault(); void run(event.currentTarget.dataset.adminOrganizationForm, new FormData(event.currentTarget).get("value"));
  });
}

export async function loadDirectoryDetail(kind, id, { fetchImpl, signal } = {}) {
  if (!["user", "organization"].includes(kind)) throw new TypeError("Unsupported directory detail kind");
  const resource = kind === "user" ? "users" : "organizations";
  const path = `/api/admin/${resource}/${encodeURIComponent(String(id || ""))}`;
  const payload = await getAdminJson(path, { fetchImpl, signal });
  const detail = payload?.[kind];
  if (!detail) throw new Error("Máy chủ trả về dữ liệu chi tiết không hợp lệ.");
  return detail;
}

function bindDirectoryDetails(root, items, options, kind) {
  const byId = new Map(items.map((item) => [String(item?.id || ""), item]));
  root.querySelectorAll("[data-admin-detail-id]").forEach((button) => button.addEventListener("click", () => {
    const item = byId.get(button.dataset.adminDetailId);
    if (!item) return;
    const isUser = kind === "user";
    const loading = `<div class="offcanvas-header"><h2 class="offcanvas-title">Đang tải chi tiết</h2><button class="btn-close" type="button" aria-label="Đóng" data-admin-close-detail></button></div><div class="offcanvas-body">${adminLoadingMarkup()}</div>`;
    openDetailDrawer(loading, async (drawer, close) => {
      try {
        const detail = await loadDirectoryDetail(kind, item.id, options);
        drawer.innerHTML = trustedHTML(isUser ? userDetailMarkup(detail) : organizationDetailMarkup(detail));
        drawer.querySelector("[data-admin-close-detail]")?.addEventListener("click", close);
        if (isUser) bindUserDetail(drawer, detail, options, close);
        else bindOrganizationDetail(drawer, detail, options, close);
      } catch (error) {
        if (options.signal?.aborted) return close();
        drawer.innerHTML = trustedHTML(`<div class="offcanvas-header"><h2 class="offcanvas-title">Không thể tải chi tiết</h2><button class="btn-close" type="button" aria-label="Đóng" data-admin-close-detail></button></div><div class="offcanvas-body">${adminStateMarkup(error?.status === 403 ? "permission" : "error", { message: error?.message })}</div>`);
        drawer.querySelector("[data-admin-close-detail]")?.addEventListener("click", close);
      }
    });
  }));
}

export const USER_DIRECTORY = Object.freeze({
  selectable: true,
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
    { label: "Tổ chức" }, { label: "Ngày tạo", sortKey: "created_at" }, { label: "Chi tiết" },
  ],
  rowMarkup(user) {
    return `<tr><td data-label="Người dùng"><strong>${text(user?.name)}</strong><div class="small text-secondary">${text(user?.username)}</div></td><td data-label="Email">${text(user?.email)}</td><td data-label="Vai trò">${text(user?.role)}</td><td data-label="Trạng thái">${text(user?.status)}</td><td data-label="Tổ chức">${membershipsMarkup(user?.organizations)}</td><td data-label="Ngày tạo">${formatDate(user?.createdAt)}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-detail-id="${text(user?.id, "")}">Xem và thao tác</button></td></tr>`;
  },
  bindResultActions(root, options) { bindDirectoryDetails(root, options.payload?.items || [], options, "user"); },
});

export const ORGANIZATION_DIRECTORY = Object.freeze({
  selectable: true,
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
    { label: "Trạng thái đăng ký" }, { label: "Hết hạn" }, { label: "Ngày tạo", sortKey: "created_at" }, { label: "Chi tiết" },
  ],
  rowMarkup(organization) {
    const subscription = organization?.subscription;
    return `<tr><td data-label="Tổ chức"><strong>${text(organization?.name)}</strong><div class="small text-secondary">${text(organization?.id)}</div></td><td data-label="Trạng thái">${text(organization?.status)}</td><td data-label="Thành viên">${Number.isFinite(organization?.memberCount) ? escapeHtml(organization.memberCount) : "N/A"}</td><td data-label="Gói dịch vụ">${text(subscription?.packageId)}</td><td data-label="Trạng thái đăng ký">${text(subscription?.status)}</td><td data-label="Hết hạn">${formatDate(subscription?.expiresAt)}</td><td data-label="Ngày tạo">${formatDate(organization?.createdAt)}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-detail-id="${text(organization?.id, "")}">Xem và thao tác</button></td></tr>`;
  },
  bindResultActions(root, options) { bindDirectoryDetails(root, options.payload?.items || [], options, "organization"); },
});

export function renderAdminUsers(container, options) {
  return renderAdminDirectory(container, USER_DIRECTORY, options);
}

export function renderAdminOrganizations(container, options) {
  return renderAdminDirectory(container, ORGANIZATION_DIRECTORY, options);
}
