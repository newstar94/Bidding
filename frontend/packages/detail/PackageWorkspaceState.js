import { normalizeAppRoute } from "../../app/RouteRegistry.js";

function clone(value) {
  return structuredClone(value);
}

function workspaceState(route = {}) {
  const normalized = normalizeAppRoute(route);
  return {
    ...normalized,
    dirty: Boolean(route.dirty),
    draft: route.draft ?? null,
  };
}

export class PackageWorkspaceState {
  #state = workspaceState();
  #listeners = new Set();
  #disposed = false;

  load(route) {
    this.#assertActive();
    this.#state = workspaceState(route);
    this.#notify();
    return clone(this.#state);
  }

  transition(event = {}) {
    this.#assertActive();
    if (
      event.type === "LOAD_ROUTE"
      && this.#state.dirty
      && String(event.route?.packageId || "") !== this.#state.packageId
    ) {
      return {
        state: clone(this.#state),
        effects: [{ type: "CONFIRM_DIRTY_NAVIGATION" }],
      };
    }
    const next = clone(this.#state);
    let effects = [];
    if (event.type === "LOAD_ROUTE") {
      this.#state = workspaceState(event.route);
      effects = [{ type: "RENDER_WORKSPACE" }];
    } else if (event.type === "SELECT_TAB") {
      next.workflowTab = String(event.tab || "preparation");
      next.dirty = false;
      next.draft = null;
      this.#state = workspaceState(next);
      effects = [{ type: "SYNC_ROUTE" }];
    } else if (event.type === "SELECT_BID") {
      next.bidId = String(event.bidId || "");
      this.#state = workspaceState(next);
      effects = [{ type: "SYNC_ROUTE" }];
    } else if (event.type === "SELECT_ROUND") {
      next.evaluationRoundId = String(event.roundId || "technical");
      this.#state = workspaceState(next);
      effects = [{ type: "SYNC_ROUTE" }];
    } else if (event.type === "SELECT_LOTS") {
      next.lotScope = { mode: event.mode, ids: event.ids || [] };
      this.#state = workspaceState(next);
      effects = [{ type: "SYNC_ROUTE" }];
    } else if (event.type === "SET_DIRTY") {
      this.#state = { ...next, dirty: Boolean(event.dirty) };
    } else if (event.type === "SET_DRAFT") {
      this.#state = { ...next, draft: event.draft ?? null };
    } else {
      throw new Error(`Unsupported package workspace event: ${String(event.type || "")}`);
    }
    this.#notify();
    return { state: clone(this.#state), effects };
  }

  snapshot() {
    this.#assertActive();
    const { dirty: _dirty, draft: _draft, pathname: _pathname, ...route } = this.#state;
    return clone(route);
  }

  isDirty() {
    this.#assertActive();
    return this.#state.dirty === true;
  }

  subscribe(listener) {
    this.#assertActive();
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.#listeners.clear();
    this.#disposed = true;
  }

  #notify() {
    const snapshot = clone(this.#state);
    this.#listeners.forEach((listener) => listener(snapshot));
  }

  #assertActive() {
    if (this.#disposed) throw new Error("PackageWorkspaceState is disposed");
  }
}

const WORKSPACES = new WeakMap();

export function packageWorkspaceFor(owner) {
  if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
    throw new TypeError("package workspace owner must be an object");
  }
  let workspace = WORKSPACES.get(owner);
  if (!workspace) {
    workspace = new PackageWorkspaceState();
    WORKSPACES.set(owner, workspace);
  }
  return workspace;
}

export function completePackageWorkspaceEdit(owner) {
  packageWorkspaceFor(owner).transition({ type: "SET_DIRTY", dirty: false });
}
