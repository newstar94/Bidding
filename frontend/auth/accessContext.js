import { getActiveOrganizationId, setActiveOrganizationId } from "../app/workspaceState.js";

const ACTIVE_ORG_KEY = "bf_active_org";

export function normalizeOrganizations(payload = {}) {
  if (Array.isArray(payload.organizations)) {
    return payload.organizations.map((organization) => ({
      id: String(organization?.id || "").trim(),
      name: String(organization?.name || "").trim(),
      scope_type: String(organization?.scope_type || "organization").trim().toLowerCase(),
      role: String(organization?.role || "employee").trim().toLowerCase(),
      status: String(organization?.status || "active").trim().toLowerCase(),
      employee_name: String(organization?.employee_name || "").trim(),
      employee_phone: String(organization?.employee_phone || "").trim(),
      subscription: organization?.subscription && typeof organization.subscription === "object"
        ? { ...organization.subscription }
        : null
    })).filter((organization) => organization.id && organization.name);
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
  return selected;
}
