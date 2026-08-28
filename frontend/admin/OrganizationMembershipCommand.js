import { apiFetch } from "../shared/apiClient.js";

const COMMAND_BY_CONTROLLER = new WeakMap();

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export class OrganizationMembershipCommand {
  constructor(controller, { candidateTtlMs = 30_000, request = apiFetch } = {}) {
    this.controller = controller;
    this.candidateTtlMs = candidateTtlMs;
    this.request = request;
    this.candidates = new Map();
    this.candidateFlights = new Map();
    this.reloadFlights = new Map();
  }

  scopeKey() {
    const model = this.controller?.model;
    return String(model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "workspace");
  }

  lookupCandidate(email, { revalidate = false } = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized) return Promise.resolve(null);
    const candidateKey = `${this.scopeKey()}:${normalized}`;
    const cached = this.candidates.get(candidateKey);
    if (!revalidate && cached && Date.now() - cached.fetchedAt < this.candidateTtlMs) {
      return Promise.resolve(cached.value);
    }
    const existing = this.candidateFlights.get(candidateKey);
    if (existing && !revalidate) return existing;
    if (existing && revalidate) {
      return existing.then(() => {
        if (this.candidateFlights.get(candidateKey) === existing) {
          this.candidateFlights.delete(candidateKey);
        }
        return this.lookupCandidate(normalized, { revalidate: true });
      });
    }
    const request = this.request(`/api/organizations/membership-candidate?email=${encodeURIComponent(normalized)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload.error || "Không thể tra cứu tài khoản nhân sự.");
          error.status = response.status;
          error.requestId = payload.requestId || response.headers?.get?.("x-request-id") || "";
          throw error;
        }
        const value = payload.candidate || null;
        this.candidates.set(candidateKey, { fetchedAt: Date.now(), value });
        return value;
      })
      .finally(() => {
        if (this.candidateFlights.get(candidateKey) === request) this.candidateFlights.delete(candidateKey);
      });
    this.candidateFlights.set(candidateKey, request);
    return request;
  }

  prefetchCandidate(email) {
    return this.lookupCandidate(email).catch(() => null);
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
    this.candidates.clear();
    this.candidateFlights.clear();
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
