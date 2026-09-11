import { renderAdminDirectory } from "./AdminDirectory.js";
import { deleteAdminJson, getAdminJson, postAdminJson, putAdminJson, requiresPrivilegedReauthentication } from "./AdminApi.js";
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

function packageOptionsMarkup(packages, selectedValue) {
  const selected = String(selectedValue || "none");
  const noneSelected = selected === "none" ? " selected" : "";
  const items = Array.isArray(packages) ? packages : [];
  return `<option value="none"${noneSelected}>Không có gói trả phí</option>${items.map((item) => {
    const id = String(item?.id || "");
    return `<option value="${text(id, "")}"${id === selected ? " selected" : ""}>${text(item?.name, id)}</option>`;
  }).join("")}`;
}

function accessSettingsMarkup(user) {
  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  const organization = organizations[0] || null;
  const packages = user?.availablePackages;
  const capabilities = organization?.documentCapabilities || {};
  const checked = (value) => value ? " checked" : "";
  const organizationControls = organization ? `<fieldset class="mt-3" data-admin-organization-access><legend class="h4">Quyền trong tổ chức</legend><label class="form-label">Tổ chức<select class="form-select" name="organization_id">${organizations.map((item) => `<option value="${text(item?.id, "")}">${text(item?.name)}</option>`).join("")}</select></label><div class="row g-3"><label class="form-label col-md-6">Vai trò trong tổ chức<select class="form-select" name="organization_role"><option value="manager"${organization?.role === "manager" ? " selected" : ""}>Quản lý</option><option value="employee"${organization?.role === "employee" ? " selected" : ""}>Chuyên viên</option></select></label><label class="form-label col-md-6">Gói dịch vụ của tổ chức<select class="form-select" name="organization_package_id">${packageOptionsMarkup(packages, organization?.subscription?.packageId)}</select></label></div><fieldset><legend class="form-label">Quyền xuất Word</legend><div class="row g-2"><label class="form-check col-md-4"><input class="form-check-input" type="checkbox" name="document_capability_financial"${checked(capabilities.financial)}> <span class="form-check-label">Thông tin tài chính</span></label><label class="form-check col-md-4"><input class="form-check-input" type="checkbox" name="document_capability_identity"${checked(capabilities.identity)}> <span class="form-check-label">Thông tin định danh</span></label><label class="form-check col-md-4"><input class="form-check-input" type="checkbox" name="document_capability_signature"${checked(capabilities.signature)}> <span class="form-check-label">Chữ ký và con dấu</span></label></div><div class="form-hint" data-admin-word-entitlement>${organization?.entitlements?.wordExport ? "Gói tổ chức hiện cho phép xuất Word." : "Gói tổ chức hiện chưa cho phép xuất Word."}</div></fieldset></fieldset>` : '<p class="text-secondary mt-3">Tài khoản chưa thuộc tổ chức nào.</p>';
  return `<form data-admin-user-form="access_settings" class="mb-3"><h3 class="h4">Thiết lập quyền và gói</h3><div class="row g-3"><label class="form-label col-md-6">Vai trò nền tảng<select class="form-select" name="platform_role"><option value="user"${user?.role === "user" ? " selected" : ""}>Người dùng</option><option value="super_admin"${user?.role === "super_admin" ? " selected" : ""}>Quản trị nền tảng</option></select></label><label class="form-label col-md-6">Gói dịch vụ cá nhân<select class="form-select" name="account_package_id">${packageOptionsMarkup(packages, user?.subscription?.packageId)}</select></label></div>${organizationControls}<button class="btn btn-primary mt-3" type="submit">Lưu thiết lập</button></form>`;
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
    access_settings: `Lưu thiết lập quyền và gói dịch vụ của ${user?.name || userId}?`,
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
  } else if (action === "access_settings") {
    const settings = value && typeof value === "object" ? value : {};
    const platformRole = String(settings.platform_role || "").trim();
    const organizationId = String(settings.organization_id || "").trim();
    const organizationRole = String(settings.organization_role || "").trim();
    if (!["super_admin", "user"].includes(platformRole)) throw new Error("Vai trò nền tảng không hợp lệ.");
    if (organizationId && !["manager", "employee"].includes(organizationRole)) {
      throw new Error("Vai trò trong tổ chức không hợp lệ.");
    }
    const capabilities = settings.document_capabilities;
    if (organizationId && (!capabilities || ["financial", "identity", "signature"].some(
      (field) => typeof capabilities[field] !== "boolean",
    ))) throw new Error("Cấu hình quyền xuất Word không hợp lệ.");
    const body = {
      user_id: userId,
      platform_role: platformRole,
      account_package_id: String(settings.account_package_id || "none").trim(),
      organization_id: organizationId || null,
      organization_role: organizationId ? organizationRole : null,
      organization_package_id: organizationId
        ? String(settings.organization_package_id || "none").trim()
        : null,
      document_capabilities: organizationId ? {
        financial: capabilities.financial,
        identity: capabilities.identity,
        signature: capabilities.signature,
      } : null,
    };
    mutate = () => putAdminJson("/api/auth/users/access-settings", {
      body, fetchImpl, signal,
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
  return `<div class="offcanvas-header"><div><div class="text-secondary small">Tài khoản ${text(user?.id)}</div><h2 class="offcanvas-title">${text(user?.name)}</h2></div><button class="btn-close" type="button" aria-label="Đóng" data-admin-close-detail></button></div><div class="offcanvas-body">${linksMarkup(user?.links)}<dl class="row"><dt class="col-4">Tên đăng nhập</dt><dd class="col-8">${text(user?.username)}</dd><dt class="col-4">Email</dt><dd class="col-8">${text(user?.email)}</dd><dt class="col-4">Trạng thái</dt><dd class="col-8">${text(user?.status)}</dd><dt class="col-4">Hoạt động gần nhất</dt><dd class="col-8">${formatDate(user?.lastActiveAt)}</dd><dt class="col-4">Phiên hoạt động</dt><dd class="col-8">${Number.isFinite(user?.activeSessionCount) ? escapeHtml(user.activeSessionCount) : "N/A"}</dd><dt class="col-4">Gói dịch vụ</dt><dd class="col-8">${text(subscription?.packageId)}</dd><dt class="col-4">Trạng thái đăng ký</dt><dd class="col-8">${text(subscription?.status)}</dd><dt class="col-4">Bắt đầu đăng ký</dt><dd class="col-8">${formatDate(subscription?.startsAt)}</dd><dt class="col-4">Hết hạn đăng ký</dt><dd class="col-8">${formatDate(subscription?.expiresAt)}</dd><dt class="col-4">Sự kiện sử dụng</dt><dd class="col-8">${Number.isFinite(usage?.eventCount) ? escapeHtml(usage.eventCount) : "N/A"}</dd><dt class="col-4">Sử dụng gần nhất</dt><dd class="col-8">${formatDate(usage?.lastSeenAt)}</dd><dt class="col-4">Ngày tạo</dt><dd class="col-8">${formatDate(user?.createdAt)}</dd><dt class="col-4">Cập nhật</dt><dd class="col-8">${formatDate(user?.updatedAt)}</dd></dl><section class="mb-4"><h3 class="h4">Tổ chức và vai trò (${Number.isFinite(user?.organizationCount) ? escapeHtml(user.organizationCount) : "N/A"})</h3>${membershipsMarkup(user?.organizations)}</section><section class="mb-4"><h3 class="h4">Hoạt động gần đây</h3>${auditMarkup(user?.recentAudit)}</section><form data-admin-user-form="name" class="mb-3"><label class="form-label">Tên hiển thị<input class="form-control" name="value" value="${text(user?.name, "")}" required maxlength="200"></label><button class="btn btn-outline-primary" type="submit">Cập nhật tên</button></form>${accessSettingsMarkup(user)}${user?.status === "active" ? '<button class="btn btn-outline-danger" type="button" data-admin-user-action="deactivate">Ngừng hoạt động tài khoản</button>' : ""}<div class="mt-3" role="status" aria-live="polite" data-admin-detail-status></div></div>`;
}

export function organizationDetailMarkup(organization) {
  const subscription = organization?.subscription;
  const primary = organization?.primaryContact;
  const usage = organization?.usage;
  const action = subscription?.status === "suspended" ? "unlock" : "lock";
  const users = Array.isArray(organization?.users) ? organization.users : [];
  return `<div class="offcanvas-header"><div><div class="text-secondary small">Tổ chức ${text(organization?.id)}</div><h2 class="offcanvas-title">${text(organization?.name)}</h2></div><button class="btn-close" type="button" aria-label="Đóng" data-admin-close-detail></button></div><div class="offcanvas-body">${linksMarkup(organization?.links)}<dl class="row"><dt class="col-5">Trạng thái</dt><dd class="col-7">${text(organization?.status)}</dd><dt class="col-5">Liên hệ chính</dt><dd class="col-7">${primary ? `${text(primary.employeeName, primary.name)}<div class="small text-secondary">${[primary.email, primary.employeePhone].filter(Boolean).map((value) => text(value)).join(" · ") || "N/A"}</div>` : "N/A"}</dd><dt class="col-5">Thành viên</dt><dd class="col-7">${Number.isFinite(organization?.memberCount) ? escapeHtml(organization.memberCount) : "N/A"}</dd><dt class="col-5">Phiên hoạt động</dt><dd class="col-7">${Number.isFinite(organization?.security?.activeSessionCount) ? escapeHtml(organization.security.activeSessionCount) : "N/A"}</dd><dt class="col-5">Hoạt động gần nhất</dt><dd class="col-7">${formatDate(usage?.lastSeenAt)}</dd><dt class="col-5">Sự kiện sử dụng</dt><dd class="col-7">${Number.isFinite(usage?.eventCount) ? escapeHtml(usage.eventCount) : "N/A"}</dd><dt class="col-5">Gói dịch vụ</dt><dd class="col-7">${text(subscription?.packageId)}</dd><dt class="col-5">Đăng ký</dt><dd class="col-7">${text(subscription?.status)}</dd><dt class="col-5">Bắt đầu</dt><dd class="col-7">${formatDate(subscription?.startsAt)}</dd><dt class="col-5">Hết hạn</dt><dd class="col-7">${formatDate(subscription?.expiresAt)}</dd><dt class="col-5">Hạn mức</dt><dd class="col-7">${Number.isFinite(subscription?.memberQuota) ? escapeHtml(subscription.memberQuota) : "N/A"}</dd></dl><section class="mb-4"><h3 class="h4">Người dùng gần đây</h3>${users.length ? users.map((item) => `<div class="mb-2"><strong>${text(item.employeeName, item.name)}</strong><div class="small text-secondary">${text(item.email)} · ${text(item.role)} · ${formatDate(item.lastActiveAt)}</div></div>`).join("") : '<p class="text-secondary">Chưa có thành viên.</p>'}</section><section class="mb-4"><h3 class="h4">Hoạt động gần đây</h3>${auditMarkup(organization?.recentAudit)}</section>${subscription ? `<div class="btn-list mb-3"><button class="btn btn-outline-${action === "lock" ? "danger" : "primary"}" type="button" data-admin-organization-action="${action}">${action === "lock" ? "Khóa đăng ký" : "Mở khóa đăng ký"}</button><button class="btn btn-outline-primary" type="button" data-admin-organization-action="renew">Gia hạn theo chính sách hiện hành</button></div><form data-admin-organization-form="set_package"><label class="form-label">Mã gói dịch vụ<input class="form-control" name="value" value="${text(subscription?.packageId, "")}" required maxlength="128"></label><button class="btn btn-outline-primary" type="submit">Đổi gói</button></form>` : '<p class="text-secondary">Tổ chức chưa có đăng ký để thao tác.</p>'}<div class="mt-3" role="status" aria-live="polite" data-admin-detail-status></div></div>`;
}

function drawerFocusableElements(drawer) {
  return Array.from(drawer.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function openDetailDrawer(markup, bind, { trigger = null, onClose } = {}) {
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
  let closed = false;
  const remove = () => {
    drawer.remove(); backdrop.remove();
    window.removeEventListener("popstate", dismissForNavigation);
    window.removeEventListener("admin:navigate", dismissForNavigation);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    remove();
    onClose?.();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
  const dismissForNavigation = () => {
    if (closed) return;
    closed = true;
    remove();
  };
  window.addEventListener("popstate", dismissForNavigation);
  window.addEventListener("admin:navigate", dismissForNavigation);
  drawer.querySelector("[data-admin-close-detail]")?.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = drawerFocusableElements(drawer);
    if (!focusable.length) { event.preventDefault(); drawer.focus(); return; }
    const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(drawer, backdrop);
  bind(drawer, close);
  drawer.querySelector("button, input, select")?.focus();
}

function setActionState(drawer, busy, message = "", failed = false) {
  drawer.setAttribute("aria-busy", String(busy));
  drawer.querySelectorAll("button, input, select").forEach((control) => {
    if (busy) {
      control.dataset.adminWasDisabled = String(control.disabled);
      control.disabled = true;
    } else {
      control.disabled = control.dataset.adminWasDisabled === "true";
      delete control.dataset.adminWasDisabled;
    }
  });
  const status = drawer.querySelector("[data-admin-detail-status]");
  if (status) { status.textContent = message; status.className = `mt-3 ${failed ? "text-danger" : "text-success"}`; }
}

function synchronizeUserAccessForm(form, user, organizationId) {
  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  const organization = organizations.find((item) => String(item?.id) === String(organizationId))
    || organizations[0]
    || null;
  const role = form.querySelector('[name="organization_role"]');
  const packageSelect = form.querySelector('[name="organization_package_id"]');
  if (role) role.value = organization?.role || "employee";
  if (packageSelect) packageSelect.value = organization?.subscription?.packageId || "none";
  const isManager = role?.value === "manager";
  const wordExport = Boolean(organization?.entitlements?.wordExport);
  for (const field of ["financial", "identity", "signature"]) {
    const input = form.querySelector(`[name="document_capability_${field}"]`);
    if (!input) continue;
    input.checked = isManager || Boolean(organization?.documentCapabilities?.[field]);
    input.disabled = isManager || !wordExport;
  }
  const hint = form.querySelector("[data-admin-word-entitlement]");
  if (hint) hint.textContent = wordExport
    ? "Gói tổ chức hiện cho phép xuất Word."
    : "Gói tổ chức hiện chưa cho phép xuất Word.";
}

function accessSettingsValue(form) {
  const organizationId = String(form.querySelector('[name="organization_id"]')?.value || "").trim();
  return {
    platform_role: form.querySelector('[name="platform_role"]')?.value || "user",
    account_package_id: form.querySelector('[name="account_package_id"]')?.value || "none",
    organization_id: organizationId,
    organization_role: organizationId
      ? form.querySelector('[name="organization_role"]')?.value || "employee"
      : null,
    organization_package_id: organizationId
      ? form.querySelector('[name="organization_package_id"]')?.value || "none"
      : null,
    document_capabilities: organizationId ? Object.fromEntries(
      ["financial", "identity", "signature"].map((field) => [
        field, Boolean(form.querySelector(`[name="document_capability_${field}"]`)?.checked),
      ]),
    ) : null,
  };
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
  const accessForm = drawer.querySelector('[data-admin-user-form="access_settings"]');
  if (accessForm) {
    const platformRole = accessForm.querySelector('[name="platform_role"]');
    const accountPackage = accessForm.querySelector('[name="account_package_id"]');
    const syncPersonalPackage = () => { if (accountPackage) accountPackage.disabled = platformRole?.value === "super_admin"; };
    syncPersonalPackage();
    platformRole?.addEventListener("change", syncPersonalPackage);
    const organizationSelect = accessForm.querySelector('[name="organization_id"]');
    synchronizeUserAccessForm(accessForm, user, organizationSelect?.value || "");
    organizationSelect?.addEventListener("change", () => {
      synchronizeUserAccessForm(accessForm, user, organizationSelect.value);
    });
    accessForm.querySelector('[name="organization_role"]')?.addEventListener("change", (event) => {
      const isManager = event.currentTarget.value === "manager";
      const enabled = accessForm.querySelector('[name="organization_package_id"]')?.value !== "none";
      for (const field of ["financial", "identity", "signature"]) {
        const input = accessForm.querySelector(`[name="document_capability_${field}"]`);
        if (!input) continue;
        input.disabled = isManager || !enabled;
        if (isManager) input.checked = true;
      }
    });
    accessForm.querySelector('[name="organization_package_id"]')?.addEventListener("change", (event) => {
      const enabled = event.currentTarget.value !== "none";
      const isManager = accessForm.querySelector('[name="organization_role"]')?.value === "manager";
      for (const field of ["financial", "identity", "signature"]) {
        const input = accessForm.querySelector(`[name="document_capability_${field}"]`);
        if (input) input.disabled = isManager || !enabled;
      }
      const hint = accessForm.querySelector("[data-admin-word-entitlement]");
      if (hint) hint.textContent = enabled
        ? "Sau khi lưu, gói tổ chức cho phép sử dụng chức năng xuất Word."
        : "Sau khi lưu, chức năng xuất Word của tổ chức bị khóa.";
    });
  }
  drawer.querySelectorAll("[data-admin-user-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = form.dataset.adminUserForm === "access_settings"
      ? accessSettingsValue(form)
      : new FormData(form).get("value");
    void run(form.dataset.adminUserForm, value);
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
  const open = (id, { trigger = null, push = false } = {}) => {
    const item = byId.get(String(id || ""));
    const detailId = String(item?.id || id || "").trim();
    if (!detailId) return;
    if (push) options.setDetail?.(detailId, { push: true });
    const isUser = kind === "user";
    const loading = `<div class="offcanvas-header"><h2 class="offcanvas-title">Đang tải chi tiết</h2><button class="btn-close" type="button" aria-label="Đóng" data-admin-close-detail></button></div><div class="offcanvas-body">${adminLoadingMarkup()}</div>`;
    openDetailDrawer(loading, async (drawer, close) => {
      try {
        const detail = await loadDirectoryDetail(kind, detailId, options);
        drawer.innerHTML = trustedHTML(isUser ? userDetailMarkup(detail) : organizationDetailMarkup(detail));
        const closeButton = drawer.querySelector("[data-admin-close-detail]");
        closeButton?.addEventListener("click", close);
        if (isUser) bindUserDetail(drawer, detail, options, close);
        else bindOrganizationDetail(drawer, detail, options, close);
        closeButton?.focus();
      } catch (error) {
        if (options.signal?.aborted) return close();
        drawer.innerHTML = trustedHTML(`<div class="offcanvas-header"><h2 class="offcanvas-title">Không thể tải chi tiết</h2><button class="btn-close" type="button" aria-label="Đóng" data-admin-close-detail></button></div><div class="offcanvas-body">${adminStateMarkup(error?.status === 403 ? "permission" : "error", { message: error?.message })}</div>`);
        const closeButton = drawer.querySelector("[data-admin-close-detail]");
        closeButton?.addEventListener("click", close);
        closeButton?.focus();
      }
    }, {
      trigger,
      onClose: () => options.setDetail?.(""),
    });
  };
  root.querySelectorAll("[data-admin-detail-id]").forEach((button) => button.addEventListener("click", () => {
    open(button.dataset.adminDetailId, { trigger: button, push: true });
  }));
  if (options.state?.detail) open(options.state.detail);
}

export const USER_DIRECTORY = Object.freeze({
  selectable: true,
  detailKind: "user",
  endpoint: "/api/admin/users",
  title: "Người dùng",
  searchPlaceholder: "Tên, tài khoản hoặc email",
  emptyMessage: "Không có người dùng phù hợp với bộ lọc.",
  defaultSort: "name",
  sortKeys: ["name", "username", "email", "role", "status", "created_at", "updated_at", "last_active_at"],
  filters: [
    { key: "role", label: "Vai trò", allLabel: "Mọi vai trò", options: [["super_admin", "Quản trị nền tảng"], ["user", "Người dùng"]] },
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["active", "Hoạt động"], ["inactive", "Không hoạt động"]] },
    { key: "organizationId", label: "Tổ chức", placeholder: "ID tổ chức", maxLength: 200 },
    { key: "packageId", label: "Gói dịch vụ", placeholder: "Mã gói", maxLength: 200 },
    { key: "createdFrom", label: "Tạo từ ngày", type: "date" },
    { key: "createdTo", label: "Tạo đến ngày", type: "date" },
    { key: "lastActiveFrom", label: "Hoạt động từ ngày", type: "date" },
    { key: "lastActiveTo", label: "Hoạt động đến ngày", type: "date" },
  ],
  columns: [
    { label: "Người dùng", sortKey: "name" }, { label: "Email", sortKey: "email" },
    { label: "Vai trò", sortKey: "role" }, { label: "Trạng thái", sortKey: "status" },
    { label: "Tổ chức" }, { label: "Gói dịch vụ" },
    { label: "Hoạt động gần nhất", sortKey: "last_active_at" },
    { label: "Ngày tạo", sortKey: "created_at" }, { label: "Chi tiết" },
  ],
  rowMarkup(user) {
    return `<tr><td data-label="Người dùng"><strong>${text(user?.name)}</strong><div class="small text-secondary">${text(user?.username)}</div></td><td data-label="Email">${text(user?.email)}</td><td data-label="Vai trò">${text(user?.role)}</td><td data-label="Trạng thái">${text(user?.status)}</td><td data-label="Tổ chức">${membershipsMarkup(user?.organizations)}</td><td data-label="Gói dịch vụ">${text(user?.subscription?.packageId)}</td><td data-label="Hoạt động gần nhất">${formatDate(user?.lastActiveAt)}</td><td data-label="Ngày tạo">${formatDate(user?.createdAt)}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-detail-id="${text(user?.id, "")}">Xem và thao tác</button></td></tr>`;
  },
  bindResultActions(root, options) { bindDirectoryDetails(root, options.payload?.items || [], options, "user"); },
});

export const ORGANIZATION_DIRECTORY = Object.freeze({
  selectable: true,
  detailKind: "organization",
  endpoint: "/api/admin/organizations",
  title: "Tổ chức",
  searchPlaceholder: "Tên hoặc mã tổ chức",
  emptyMessage: "Không có tổ chức phù hợp với bộ lọc.",
  defaultSort: "name",
  sortKeys: ["name", "status", "member_count", "created_at", "updated_at", "last_active_at"],
  filters: [
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["active", "Hoạt động"], ["suspended", "Tạm dừng"]] },
    { key: "subscriptionStatus", label: "Đăng ký", allLabel: "Mọi đăng ký", options: [["active", "Hoạt động"], ["expired", "Hết hạn"], ["suspended", "Tạm dừng"], ["cancelled", "Đã hủy"]] },
    { key: "packageId", label: "Gói dịch vụ", placeholder: "Mã gói", maxLength: 200 },
  ],
  columns: [
    { label: "Tổ chức", sortKey: "name" }, { label: "Liên hệ chính" }, { label: "Trạng thái", sortKey: "status" },
    { label: "Thành viên", sortKey: "member_count" }, { label: "Gói dịch vụ" },
    { label: "Trạng thái đăng ký" }, { label: "Hết hạn" },
    { label: "Hoạt động gần nhất", sortKey: "last_active_at" },
    { label: "Ngày tạo", sortKey: "created_at" }, { label: "Chi tiết" },
  ],
  rowMarkup(organization) {
    const subscription = organization?.subscription;
    const contact = organization?.primaryContact;
    const contactMarkup = contact ? `<strong>${text(contact.name)}</strong><div class="small text-secondary">${text(contact.email)}</div>` : "N/A";
    return `<tr><td data-label="Tổ chức"><strong>${text(organization?.name)}</strong><div class="small text-secondary">${text(organization?.id)}</div></td><td data-label="Liên hệ chính">${contactMarkup}</td><td data-label="Trạng thái">${text(organization?.status)}</td><td data-label="Thành viên">${Number.isFinite(organization?.memberCount) ? escapeHtml(organization.memberCount) : "N/A"}</td><td data-label="Gói dịch vụ">${text(subscription?.packageId)}</td><td data-label="Trạng thái đăng ký">${text(subscription?.status)}</td><td data-label="Hết hạn">${formatDate(subscription?.expiresAt)}</td><td data-label="Hoạt động gần nhất">${formatDate(organization?.lastActiveAt)}</td><td data-label="Ngày tạo">${formatDate(organization?.createdAt)}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-detail-id="${text(organization?.id, "")}">Xem và thao tác</button></td></tr>`;
  },
  bindResultActions(root, options) { bindDirectoryDetails(root, options.payload?.items || [], options, "organization"); },
});

export function renderAdminUsers(container, options) {
  return renderAdminDirectory(container, USER_DIRECTORY, options);
}

export function renderAdminOrganizations(container, options) {
  return renderAdminDirectory(container, ORGANIZATION_DIRECTORY, options);
}
