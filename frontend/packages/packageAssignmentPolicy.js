import { normalizeAssigneeIds } from "../shared/MultiAssigneeSelect.js";

function normalizeId(value) {
  return String(value || "").trim();
}

export function resolvePackageAssigneeIds(selectedAssigneeIds) {
  return normalizeAssigneeIds(selectedAssigneeIds);
}

export function resolveInitialPackageAssigneeIds({
  packageId,
  assignedEmpIds,
} = {}) {
  return normalizeId(packageId) ? normalizeAssigneeIds(assignedEmpIds) : [];
}

export function derivePackageAssigneeControlState({
  activeRole,
  packageId,
  assignedEmpIds,
} = {}) {
  return {
    values: resolveInitialPackageAssigneeIds({
      packageId,
      assignedEmpIds,
    }),
    disabled: String(activeRole || "").trim().toLowerCase() === "employee",
  };
}

export function ensureCurrentUserAssignee(employees, currentUser = {}) {
  const candidates = Array.isArray(employees) ? [...employees] : [];
  const currentUserId = normalizeId(currentUser.id);
  if (!currentUserId || candidates.some((employee) => normalizeId(employee?.id) === currentUserId)) {
    return candidates;
  }
  candidates.push({
    id: currentUserId,
    name: String(currentUser.name || "").trim(),
    email: String(currentUser.email || "").trim(),
    role: String(currentUser.role || "employee").trim() || "employee",
  });
  return candidates;
}
