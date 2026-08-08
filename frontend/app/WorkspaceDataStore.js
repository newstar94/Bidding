import {
  mutatePersistAndSync,
  persistAndSync,
} from "../shared/MutationService.js";

function clone(value) {
  return structuredClone(value);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const LOCALLY_ACCEPTED_OUTCOMES = new Set([
  "committed",
  "offlineQueued",
  "transportFailed",
  "conflict",
]);

function classifySyncResult(result) {
  if (result?.ok !== false) {
    return result?.offline ? "offlineQueued" : "committed";
  }
  const status = Number(result?.status || 0);
  if (result?.conflict || status === 409 || result?.data?.status === "conflict") {
    return "conflict";
  }
  if (result?.validation || status === 400 || status === 422) {
    return "validationRejected";
  }
  if (result?.offline || globalThis.navigator?.onLine === false) {
    return "offlineQueued";
  }
  if (result?.transport || result?.error || status >= 500) {
    return "transportFailed";
  }
  return "validationRejected";
}

function normalizePatch({ upserts = {}, deletions = {} } = {}) {
  const normalizedUpserts = {};
  const normalizedDeletions = {};
  Object.entries(upserts || {}).forEach(([table, values]) => {
    const records = (Array.isArray(values) ? values : [values]).filter(
      (record) => record?.id !== undefined && record?.id !== null
        && String(record.id) !== "",
    );
    if (records.length > 0) normalizedUpserts[table] = records;
  });
  Object.entries(deletions || {}).forEach(([table, values]) => {
    const ids = (Array.isArray(values) ? values : [values])
      .map((value) => value && typeof value === "object" ? value.id : value)
      .filter((value) => value !== undefined && value !== null && String(value) !== "");
    if (ids.length > 0) normalizedDeletions[table] = ids;
  });
  return { upserts: normalizedUpserts, deletions: normalizedDeletions };
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

  async patch({ mutationId, upserts = {}, deletions = {} } = {}) {
    const normalizedMutationId = String(mutationId || "").trim();
    if (!normalizedMutationId) {
      return { status: "validationRejected", reason: "MUTATION_ID_REQUIRED" };
    }
    if (this.#completed.has(normalizedMutationId)) {
      return clone(this.#completed.get(normalizedMutationId));
    }
    const changes = normalizePatch({ upserts, deletions });
    const tables = [...new Set([
      ...Object.keys(changes.upserts),
      ...Object.keys(changes.deletions),
    ])];
    if (tables.length === 0) {
      return { status: "validationRejected", reason: "CHANGES_REQUIRED" };
    }
    const model = this.#controller.model;
    const mutationCheckpoint = model.captureMutationCheckpoint?.() ?? null;
    const before = this.#capturePatchBefore(changes, tables);
    let syncResult;
    try {
      syncResult = await mutatePersistAndSync(this.#controller, changes, { tableKeys: tables });
    } catch (error) {
      const rollbackError = await this.#rollbackPatch(before, mutationCheckpoint);
      return {
        status: "persistenceFailed",
        reason: "PERSISTENCE_FAILED",
        error,
        ...(rollbackError ? { rollbackError } : {}),
      };
    }
    const status = classifySyncResult(syncResult);
    if (status === "validationRejected") {
      const rollbackError = await this.#rollbackPatch(before, mutationCheckpoint);
      return {
        status,
        reason: syncResult?.code || "VALIDATION_REJECTED",
        ...(rollbackError ? { rollbackError } : {}),
      };
    }
    const outcome = {
      status,
      mutationId: normalizedMutationId,
      ...(status === "transportFailed" ? { queued: true } : {}),
    };
    if (LOCALLY_ACCEPTED_OUTCOMES.has(status)) {
      this.#completed.set(normalizedMutationId, clone(outcome));
    }
    this.#notify();
    return outcome;
  }

  async transaction({ tables, mutationId }, mutate) {
    const tableNames = [...new Set((tables || []).map(String).filter(Boolean))];
    const normalizedMutationId = String(mutationId || "").trim();
    if (!tableNames.length) return { status: "validationRejected", reason: "TABLES_REQUIRED" };
    if (!normalizedMutationId) return { status: "validationRejected", reason: "MUTATION_ID_REQUIRED" };
    if (this.#completed.has(normalizedMutationId)) {
      return clone(this.#completed.get(normalizedMutationId));
    }
    const model = this.#controller.model;
    const state = model.state;
    const mutationCheckpoint = model.captureMutationCheckpoint?.() ?? null;
    const snapshots = Object.fromEntries(
      tableNames.map((table) => [table, clone(state[table] || [])]),
    );
    const draft = clone(snapshots);
    let validation;
    try {
      validation = await mutate(draft);
    } catch (error) {
      return { status: "validationRejected", reason: "MUTATION_FAILED", error };
    }
    if (["rejected", "validationRejected"].includes(validation?.status)) {
      return { ...validation, status: "validationRejected" };
    }

    tableNames.forEach((table) => {
      state[table] = draft[table];
    });
    let syncResult;
    try {
      syncResult = typeof model.persistData === "function"
        ? await persistAndSync(this.#controller, tableNames)
        : { ok: true };
    } catch (error) {
      const rollbackError = await this.#rollback(snapshots, mutationCheckpoint);
      return {
        status: "persistenceFailed",
        reason: "PERSISTENCE_FAILED",
        error,
        ...(rollbackError ? { rollbackError } : {}),
      };
    }
    const status = classifySyncResult(syncResult);
    if (status === "validationRejected") {
      const rollbackError = await this.#rollback(snapshots, mutationCheckpoint);
      return {
        status,
        reason: syncResult?.code || "VALIDATION_REJECTED",
        ...(rollbackError ? { rollbackError } : {}),
      };
    }
    const outcome = {
      status,
      mutationId: normalizedMutationId,
      ...(status === "transportFailed" ? { queued: true } : {}),
    };
    if (LOCALLY_ACCEPTED_OUTCOMES.has(status)) {
      this.#completed.set(normalizedMutationId, clone(outcome));
    }
    this.#notify();
    return outcome;
  }

  async #rollback(snapshots, mutationCheckpoint) {
    const model = this.#controller.model;
    const state = model.state;
    let rollbackError = null;
    for (const [table, snapshot] of Object.entries(snapshots)) {
      state[table] = snapshot;
      try {
        await model.db?.putTableData?.(table, snapshot);
      } catch (error) {
        rollbackError ||= error;
      }
    }
    if (mutationCheckpoint !== null && typeof model.restoreMutationCheckpoint === "function") {
      try {
        await model.restoreMutationCheckpoint(mutationCheckpoint);
      } catch (error) {
        rollbackError ||= error;
      }
    }
    this.#notify();
    return rollbackError;
  }

  #capturePatchBefore(changes, tables) {
    const state = this.#controller.model.state;
    const before = {};
    for (const table of tables) {
      const affectedIds = new Set([
        ...(changes.upserts[table] || []).map((record) => String(record.id)),
        ...(changes.deletions[table] || []).map(String),
      ]);
      before[table] = [...affectedIds].map((id) => {
        const index = (state[table] || []).findIndex((record) => String(record.id) === id);
        return {
          id,
          index,
          record: index >= 0 ? clone(state[table][index]) : null,
        };
      });
    }
    return before;
  }

  async #rollbackPatch(before, mutationCheckpoint) {
    const model = this.#controller.model;
    const state = model.state;
    let rollbackError = null;
    for (const [table, entries] of Object.entries(before)) {
      const affectedIds = new Set(entries.map(({ id }) => id));
      const restored = (state[table] || []).filter(
        (record) => !affectedIds.has(String(record.id)),
      );
      entries
        .filter(({ record }) => record !== null)
        .sort((left, right) => left.index - right.index)
        .forEach(({ index, record }) => {
          restored.splice(Math.min(Math.max(index, 0), restored.length), 0, record);
        });
      state[table] = restored;
      const rollbackChanges = {
        upserts: entries.filter(({ record }) => record !== null).map(({ record }) => record),
        deletions: entries.filter(({ record }) => record === null).map(({ id }) => id),
      };
      try {
        if (typeof model.persistChanges === "function") {
          await model.persistChanges(table, rollbackChanges, {
            trackMutation: false,
            throwOnError: true,
          });
        } else {
          await model.db?.putTableData?.(table, restored);
        }
      } catch (error) {
        rollbackError ||= error;
      }
    }
    if (mutationCheckpoint !== null && typeof model.restoreMutationCheckpoint === "function") {
      try {
        await model.restoreMutationCheckpoint(mutationCheckpoint);
      } catch (error) {
        rollbackError ||= error;
      }
    }
    this.#notify();
    return rollbackError;
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
