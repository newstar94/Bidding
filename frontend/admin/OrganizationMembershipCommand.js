import { apiFetch } from "../shared/apiClient.js";

const COMMAND_BY_CONTROLLER = new WeakMap();

export class OrganizationMembershipCommand {
  // Membership changes no longer look accounts up by email (ADR 0093);
  // this command only coalesces projection reloads per workspace.
  constructor(controller, { request = apiFetch } = {}) {
    this.controller = controller;
    this.request = request;
    this.reloadFlights = new Map();
  }

  scopeKey() {
    const model = this.controller?.model;
    return String(model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "workspace");
  }

  reloadProjection(task) {
    const model = this.controller?.model;
    const generation = String(model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "workspace");
    const existing = this.reloadFlights.get(generation);
    if (existing) return existing;
    // Invoke synchronously so callers capture their workspace lease at the
    // user action boundary. Deferring task() to a microtask can attach a
    // response for workspace A to workspace B after a rapid switch.
    let result;
    try {
      result = task();
    } catch (error) {
      result = Promise.reject(error);
    }
    const request = Promise.resolve(result).finally(() => {
      if (this.reloadFlights.get(generation) === request) this.reloadFlights.delete(generation);
    });
    this.reloadFlights.set(generation, request);
    return request;
  }

  dispose() {
    this.reloadFlights.clear();
  }
}

export function organizationMembershipCommand(controller) {
  let command = COMMAND_BY_CONTROLLER.get(controller);
  if (!command) {
    command = new OrganizationMembershipCommand(controller);
    COMMAND_BY_CONTROLLER.set(controller, command);
  }
  return command;
}
