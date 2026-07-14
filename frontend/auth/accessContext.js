import { getActiveOrganizationId, setActiveOrganizationId } from "../app/workspaceState.js";

const ACTIVE_ORG_KEY = "bf_active_org";

export function normalizeOrganizations(payload = {}) {
  if (Array.isArray(payload.organizations)) {
    return payload.organizations.map((organization) => ({
      id: String(organization?.id || "").trim(),
      name: String(organization?.name || "").trim(),
      role: String(organization?.role || "viewer").trim().toLowerCase(),
      status: String(organization?.status || "active").trim().toLowerCase()
    })).filter((organization) => organization.id && organization.name);
  }
  return [];
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
  target.dbRole = payload.role || (target.platformRole === "super_admin" ? "super_admin" : target.membershipRole || "viewer");
  const membershipHierarchy = {
    owner: ["owner", "manager", "employee", "viewer"],
    manager: ["manager", "employee", "viewer"],
    employee: ["employee"],
    viewer: ["viewer"]
  };
  target.dbRoles = target.platformRole === "super_admin"
    ? ["super_admin", "owner", "manager", "employee", "viewer"]
    : [...membershipHierarchy[target.membershipRole] || []];
  target.dbRole = target.platformRole === "super_admin" ? "super_admin" : target.membershipRole || "viewer";
  target.organizations = organizations;
  target.activeOrganizationId = selected?.id || null;
  target.organization_name = organizations.map((organization) => organization.name).join(", ");
  return selected;
}
