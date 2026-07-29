import { getActiveOrganizationId, setActiveOrganizationId } from "../app/workspaceState.js";

const ACTIVE_ORG_KEY = "bf_active_org";

export function normalizeOrganizations(payload = {}) {
  if (Array.isArray(payload.organizations)) {
    return payload.organizations.map((organization) => {
      const scopeType = String(organization?.scope_type || "organization").trim().toLowerCase();
      return {
        id: String(organization?.id || "").trim(),
        name: scopeType === "personal" ? "Cá nhân" : String(organization?.name || "").trim(),
        scope_type: scopeType,
        role: String(organization?.role || "employee").trim().toLowerCase(),
        status: String(organization?.status || "active").trim().toLowerCase(),
        employee_name: String(organization?.employee_name || "").trim(),
        employee_phone: String(organization?.employee_phone || "").trim(),
        subscription: organization?.subscription && typeof organization.subscription === "object"
          ? { ...organization.subscription }
          : null,
        entitlements: organization?.entitlements && typeof organization.entitlements === "object"
          ? { ...organization.entitlements }
          : { word_export: false }
      };
    }).filter((organization) => organization.id && organization.name);
  }
  return [];
}

export function businessOrganizations(payload = {}) {
  return normalizeOrganizations(payload).filter(
    (organization) => organization.scope_type === "organization"
  );
}

export function organizationDisplayName(payload = {}) {
  return businessOrganizations(payload).map((organization) => organization.name).join(", ");
}

export function organizationEmployeeProfile(payload = {}, organizationId = getActiveOrganizationId()) {
  const membership = normalizeOrganizations(payload).find(
    (organization) => organization.id === String(organizationId || "")
  );
  if (membership?.scope_type === "organization") {
    return {
      name: membership.employee_name,
      phone: membership.employee_phone
    };
  }
  return {
    name: String(payload?.name || "").trim(),
    phone: ""
  };
}

export function organizationEmployeeLabel(payload = {}, organizationId = getActiveOrganizationId()) {
  const name = organizationEmployeeProfile(payload, organizationId).name;
  const email = String(payload?.email || "").trim();
  if (name && email) return `${name} - ${email}`;
  return name || email;
}

export function canUploadWorkspaceAssets(
  payload = {},
  activeRole = payload?.activeRole || payload?.active_role || payload?.membershipRole || payload?.membership_role,
  organizationId = payload?.activeOrganizationId || payload?.active_org_id || getActiveOrganizationId(),
) {
  const workspace = normalizeOrganizations(payload).find(
    (organization) => organization.id === String(organizationId || ""),
  );
  if (workspace?.scope_type === "personal") return true;
  return Boolean(
    workspace?.scope_type === "organization"
    && workspace.role === "manager"
    && String(activeRole || "").trim().toLowerCase() !== "employee"
  );
}

export function canManageWorkspaceWordVariables(
  payload = {},
  activeRole = payload?.activeRole || payload?.active_role || payload?.membershipRole || payload?.membership_role,
  organizationId = payload?.activeOrganizationId || payload?.active_org_id || getActiveOrganizationId(),
) {
  return canUploadWorkspaceAssets(payload, activeRole, organizationId);
}

export function selectActiveOrganization(payload = {}, storage = null) {
  const organizations = normalizeOrganizations(payload);
  const accessible = organizations.filter((organization) => organization.status === "active");
  const requestedId = String(payload.active_org_id || (storage ? storage.getItem(ACTIVE_ORG_KEY) : getActiveOrganizationId()) || "");
  const selected = accessible.find((organization) => organization.id === requestedId) || accessible[0] || null;
  if (storage) {
    if (selected) storage.setItem(ACTIVE_ORG_KEY, selected.id);
    else storage.removeItem(ACTIVE_ORG_KEY);
  } else {
    setActiveOrganizationId(selected?.id || "");
  }
  return { organizations, selected };
}

export function applyAccessContext(target, payload = {}, storage = null) {
  const { organizations, selected } = selectActiveOrganization(payload, storage);
  target.platformRole = payload.platform_role || "user";
  target.membershipRole = selected?.role || payload.membership_role || null;
  target.dbRole = payload.role || (target.platformRole === "super_admin" ? "super_admin" : target.membershipRole || "employee");
  const membershipHierarchy = {
    manager: ["manager", "employee"],
    employee: ["employee"]
  };
  target.dbRoles = target.platformRole === "super_admin"
    ? ["super_admin", "manager", "employee"]
    : [...membershipHierarchy[target.membershipRole] || ["employee"]];
  target.dbRole = target.platformRole === "super_admin" ? "super_admin" : target.membershipRole || "employee";
  target.organizations = organizations;
  target.activeOrganizationId = selected?.id || null;
  target.entitlements = target.platformRole === "super_admin"
    ? { ...(selected?.entitlements || {}), ...(payload.entitlements || {}) }
    : { ...(selected?.entitlements || payload.entitlements || {}) };
  target.wordExportEnabled = Boolean(target.entitlements.word_export);
  const wordNavigation = globalThis.document?.getElementById?.("btn-tab-bieumau");
  if (wordNavigation) {
    wordNavigation.disabled = !target.wordExportEnabled;
    wordNavigation.setAttribute("aria-disabled", target.wordExportEnabled ? "false" : "true");
    wordNavigation.title = target.wordExportEnabled
      ? "Quản lý biểu mẫu Word"
      : "Cần gói trả phí đang hoạt động để dùng biểu mẫu Word";
  }
  return selected;
}
