import { normalizeAssigneeIds } from "../shared/MultiAssigneeSelect.js";

function normalizeId(value) {
  return String(value || "").trim();
}

export function resolvePackageAssigneeIds(selectedAssigneeIds, creatorId) {
  const selected = normalizeAssigneeIds(selectedAssigneeIds);
  return selected.length ? selected : normalizeAssigneeIds(creatorId);
}

export function resolveInitialPackageAssigneeIds({
  packageId,
  assignedEmpIds,
  creatorId,
} = {}) {
  return normalizeId(packageId)
    ? normalizeAssigneeIds(assignedEmpIds)
    : normalizeAssigneeIds(creatorId);
}

export function derivePackageAssigneeControlState({
  activeRole,
  packageId,
  assignedEmpIds,
  creatorId,
} = {}) {
  return {
    values: resolveInitialPackageAssigneeIds({
      packageId,
      assignedEmpIds,
      creatorId,
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
