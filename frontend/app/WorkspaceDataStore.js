import { persistAndSync } from "../shared/MutationService.js";

function clone(value) {
  return structuredClone(value);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class WorkspaceDataStore {
  #controller;
  #subscriptions = new Set();
  #completed = new Map();

  constructor(controller) {
    if (!controller?.model?.state) throw new TypeError("WorkspaceDataStore requires a controller model");
    this.#controller = controller;
  }

  query(selector) {
    if (typeof selector !== "function") throw new TypeError("selector must be a function");
    return clone(selector(this.#controller.model.state));
  }

  subscribe(selector, listener) {
    if (typeof selector !== "function" || typeof listener !== "function") {
      throw new TypeError("selector and listener must be functions");
    }
    const subscription = {
      selector,
      listener,
      value: clone(selector(this.#controller.model.state)),
    };
    this.#subscriptions.add(subscription);
    return () => this.#subscriptions.delete(subscription);
  }

  async transaction({ tables, mutationId }, mutate) {
    const tableNames = [...new Set((tables || []).map(String).filter(Boolean))];
    const normalizedMutationId = String(mutationId || "").trim();
    if (!tableNames.length) return { status: "rejected", reason: "TABLES_REQUIRED" };
    if (!normalizedMutationId) return { status: "rejected", reason: "MUTATION_ID_REQUIRED" };
    if (this.#completed.has(normalizedMutationId)) {
      return clone(this.#completed.get(normalizedMutationId));
    }
    const model = this.#controller.model;
    const snapshots = Object.fromEntries(
      tableNames.map((table) => [table, clone(model.state[table] || [])]),
    );
    const draft = clone(snapshots);
    let validation;
    try {
      validation = await mutate(draft);
    } catch (error) {
      return { status: "rejected", reason: "MUTATION_FAILED", error };
    }
    if (validation?.status === "rejected") return validation;

    tableNames.forEach((table) => {
      model.state[table] = draft[table];
    });
    let syncResult;
    try {
      syncResult = typeof model.persistData === "function"
        ? await persistAndSync(this.#controller, tableNames)
        : { ok: true };
    } catch (error) {
      await this.#rollback(snapshots);
      return { status: "rejected", reason: "PERSISTENCE_FAILED", error };
    }
    if (syncResult?.ok === false) {
      await this.#rollback(snapshots);
      return {
        status: syncResult.conflict || syncResult.status === 409 ? "conflict" : "rejected",
        reason: syncResult.code || "SYNC_REJECTED",
      };
    }
    const outcome = {
      status: syncResult?.offline ? "offlineQueued" : "committed",
      mutationId: normalizedMutationId,
    };
    this.#completed.set(normalizedMutationId, clone(outcome));
    this.#notify();
    return outcome;
  }

  async #rollback(snapshots) {
    const model = this.#controller.model;
    for (const [table, snapshot] of Object.entries(snapshots)) {
      model.state[table] = snapshot;
      await model.db?.putTableData?.(table, snapshot);
    }
    this.#notify();
  }

  #notify() {
    for (const subscription of this.#subscriptions) {
      const next = clone(subscription.selector(this.#controller.model.state));
      if (sameValue(next, subscription.value)) continue;
      subscription.value = clone(next);
      subscription.listener(next);
    }
  }
}

const STORES = new WeakMap();

export function workspaceDataStoreFor(controller) {
  let store = STORES.get(controller);
  if (!store) {
    store = new WorkspaceDataStore(controller);
    STORES.set(controller, store);
  }
  return store;
}
