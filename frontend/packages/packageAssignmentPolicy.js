function normalizeId(value) {
  return String(value || "").trim();
}

export function resolvePackageAssigneeId(selectedAssigneeId, creatorId) {
  return normalizeId(selectedAssigneeId) || normalizeId(creatorId);
}

export function resolveInitialPackageAssigneeId({
  packageId,
  assignedEmpId,
  creatorId,
} = {}) {
  return normalizeId(packageId)
    ? normalizeId(assignedEmpId)
    : normalizeId(creatorId);
}

export function derivePackageAssigneeControlState({
  activeRole,
  packageId,
  assignedEmpId,
  creatorId,
} = {}) {
  return {
    value: resolveInitialPackageAssigneeId({
      packageId,
      assignedEmpId,
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
