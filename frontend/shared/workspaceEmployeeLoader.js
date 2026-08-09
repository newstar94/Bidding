import { organizationEmployeeProfile } from "../auth/accessContext.js";
import {
  assertWorkspaceLeaseCurrent,
  beginWorkspaceRequest,
  finishWorkspaceRequest,
} from "../app/workspaceLease.js";
import { apiFetch } from "./apiClient.js";

export async function loadWorkspaceEmployees(model, { onLoaded = null } = {}) {
  const request = beginWorkspaceRequest(model);
  try {
    const response = await apiFetch("/api/auth/users", { signal: request.signal });
    assertWorkspaceLeaseCurrent(model, request.lease);
    if (!response.ok) {
      throw new Error(`Failed to load workspace employees: HTTP ${response.status}`);
    }
    const users = await response.json();
    assertWorkspaceLeaseCurrent(model, request.lease);
    const employees = (Array.isArray(users) ? users : []).map((user) => {
      const employeeProfile = organizationEmployeeProfile(user);
      return {
        id: String(user.id || ""),
        name: employeeProfile.name,
        email: user.email || "",
        phone: employeeProfile.phone,
        role: user.role,
      };
    });
    request.lease.state.employees = employees;
    assertWorkspaceLeaseCurrent(model, request.lease);
    onLoaded?.(employees);
    return employees;
  } finally {
    finishWorkspaceRequest(model, request);
  }
}
