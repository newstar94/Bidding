import { isSyncedStateKey } from "./persistencePolicy.js";
import { workspaceMutationCoordinator } from "./WorkspaceMutationCoordinator.js";

function explicitTableChanges(changes, table) {
  if (!changes || typeof changes !== "object") return null;
  const hasUpserts = Object.prototype.hasOwnProperty.call(changes.upserts || {}, table);
  const hasDeletions = Object.prototype.hasOwnProperty.call(changes.deletions || {}, table);
  if (!hasUpserts && !hasDeletions) return null;
  const upserts = hasUpserts
    ? (Array.isArray(changes.upserts[table]) ? changes.upserts[table] : [changes.upserts[table]])
    : [];
  const deletions = hasDeletions
    ? (Array.isArray(changes.deletions[table]) ? changes.deletions[table] : [changes.deletions[table]])
    : [];
  return {
    upserts: upserts.filter(Boolean),
    deletions: deletions
      .map((value) => value && typeof value === "object" ? value.id : value)
      .filter((value) => value !== undefined && value !== null && String(value) !== ""),
  };
}

export async function persistAndSync(controller, tableKeys, {
  afterCanonicalSync,
  afterLocalDurable,
  afterPersist,
  allowLegacyPersistence = false,
  authoritativeBoundaryChecked = false,
  backgroundSync = false,
  changes = null,
  releaseBeforeRemoteSync = false,
  workspaceMutation = null,
} = {}) {
  const keys = [...new Set((Array.isArray(tableKeys) ? tableKeys : [tableKeys]).filter(Boolean))];
  for (const key of keys) {
    if (isSyncedStateKey(key) && !explicitTableChanges(changes, key) && !allowLegacyPersistence) {
      const error = new Error(
        `Explicit changes are required to persist synced table "${key}"`,
      );
      error.code = "EXPLICIT_CHANGES_REQUIRED";
      error.table = key;
      throw error;
    }
  }
  if (!authoritativeBoundaryChecked
    && typeof controller?.awaitAuthoritativeMutationBoundary === "function") {
    await controller.awaitAuthoritativeMutationBoundary();
  }
  const model = controller.model;
  const ownsMutation = !workspaceMutation
    && typeof model?.beginWorkspaceMutation === "function";
  const mutation = workspaceMutation || (ownsMutation ? model.beginWorkspaceMutation() : null);
  let mutationReleased = false;
  const releaseMutation = () => {
    if (!mutation || mutationReleased) return;
    model.finishWorkspaceMutation?.(mutation);
    mutationReleased = true;
  };
  if (mutation) model.assertWorkspaceMutation?.(mutation);
  try {
  model?.assertStorageTablesWritable?.(keys);
  controller._deferImmediateSync = true;
  if (controller._syncImmediateTimer) {
    clearTimeout(controller._syncImmediateTimer);
    controller._syncImmediateTimer = null;
  }
  try {
    for (const key of keys) {
      const tableChanges = explicitTableChanges(changes, key);
      if (tableChanges && typeof model.persistChanges === "function") {
        await model.persistChanges(key, tableChanges, {
          throwOnError: true,
          ...(mutation ? { workspaceMutation: mutation } : {}),
        });
      } else if (typeof model.persistData === "function") {
        await model.persistData(key, {
          throwOnError: true,
          ...(mutation ? { workspaceMutation: mutation } : {}),
        });
      }
    }
  } finally {
    controller._deferImmediateSync = false;
    if (controller._syncImmediateTimer) {
      clearTimeout(controller._syncImmediateTimer);
      controller._syncImmediateTimer = null;
    }
  }
  if (
    mutation
    && typeof model.workspaceMutationUsesCurrentResources === "function"
    && !model.workspaceMutationUsesCurrentResources(mutation)
  ) {
    await mutation.outbox?.flush?.();
    return { ok: false, code: "WORKSPACE_CHANGED", workspaceChanged: true };
  }
  const usesServerPagination = Boolean(model?.useServerSidePagination);
  const phaseCoordinator = workspaceMutationCoordinator(controller);
  // The server-side mutation flow already refreshes changed tables from
  // autoSync(). Defer that refresh when the caller supplies afterPersist so
  // the view is rendered exactly once after the sync has committed. Rendering
  // twice can abort the first pagination request and briefly show a false
  // "cannot load data" state after a delete.
  if (usesServerPagination && typeof afterPersist === "function" && !backgroundSync) {
    controller._deferPostCommitRender = true;
  }
  if (!usesServerPagination && typeof afterPersist === "function") {
    await afterPersist();
  }
  if (mutation?.outbox) await mutation.outbox.flush();
  else await model?.flushMutationOutbox?.();
  const startRemoteSync = async () => {
    let syncResult;
    try {
      syncResult = typeof controller.autoSync === "function"
        ? await controller.autoSync()
        : { ok: true };
    } catch (error) {
      syncResult = { ok: false, transport: true, error };
    }
    if (
      syncResult?.idempotencyKeyReused === true
      && syncResult?.retryable !== false
      && typeof controller.forceSyncData === "function"
      && typeof controller.autoSync === "function"
    ) {
      const pullResult = await controller.forceSyncData(false, true);
      if (!pullResult?.ok) return pullResult;
      syncResult = await controller.autoSync({ idempotencyRecoveryAttempted: true });
    }
    if (!backgroundSync && usesServerPagination && syncResult?.ok !== false && typeof afterPersist === "function") {
      await afterPersist();
    }
    if (syncResult?.ok !== false && typeof afterCanonicalSync === "function") {
      await phaseCoordinator.afterCanonicalSync(keys.join(","), afterCanonicalSync);
    }
    return syncResult;
  };
  if (backgroundSync) {
    const localCallback = afterLocalDurable || afterPersist;
    if (typeof localCallback === "function") {
      // The local state and outbox are durable now. Render that state
      // immediately without making delayed pagination part of the save path.
      phaseCoordinator.afterLocalDurable(localCallback);
    }
    const syncPromise = startRemoteSync();
    // Once IndexedDB and the outbox are durable, the workspace lease no longer
    // needs to be held by network latency. autoSync captures the current scope
    // synchronously before this release, so a later workspace switch cannot
    // redirect the request to another tenant.
    if (ownsMutation || releaseBeforeRemoteSync) releaseMutation();
    // autoSync owns user-visible error/conflict reporting. This handler only
    // prevents a caller that intentionally does not await the background work
    // from creating an unhandled rejection.
    void syncPromise.catch((error) => {
      console.error("Background synchronization failed:", error);
    });
    return { ok: true, local: true, queued: true, syncPromise };
  }
  if (ownsMutation || releaseBeforeRemoteSync) releaseMutation();
  return await startRemoteSync();
  } finally {
    if (ownsMutation && !mutationReleased) releaseMutation();
  }
}

/**
 * Deletions can be initiated from a paginated view whose IndexedDB copy is
 * older than the server row. Refresh the target before capturing its
 * expectedVersion so the first delete request is not rejected as a conflict.
 */
export async function refreshRecordBeforeDelete(controller, tableKey, recordId) {
  const target = await refreshRecordBeforeMutation(controller, tableKey, recordId);
  if (!target || typeof controller?.fetchRecordByLookup !== "function") return target;

  const familyRoot = String(target.rootId || target.id || "");
  const records = controller?.model?.state?.[tableKey] || [];
  const familyIds = new Set([
    ...(Array.isArray(target.allVersions) ? target.allVersions : [])
      .map((version) => String(version?.id || "")),
    ...records
      .filter((record) => String(record?.rootId || record?.id || "") === familyRoot)
      .map((record) => String(record?.id || "")),
  ].filter(Boolean));
  familyIds.delete(String(target.id));
  await Promise.all(
    [...familyIds].map((id) => refreshRecordBeforeMutation(controller, tableKey, id)),
  );
  return controller.model.state[tableKey]?.find(
    (record) => String(record?.id) === String(target.id),
  ) || target;
}

/**
 * Refresh a versioned record before staging a state transition so the
 * mutation carries the latest rowVersion instead of a stale page snapshot.
 */
export async function refreshRecordBeforeMutation(controller, tableKey, recordId) {
  const localRecord = controller?.model?.state?.[tableKey]?.find?.(
    (record) => String(record?.id) === String(recordId)
  ) || null;
  if (typeof controller?.fetchRecordByLookup !== "function") return localRecord;
  try {
    const authoritativeRecord = await controller.fetchRecordByLookup(tableKey, recordId);
    if (!authoritativeRecord) return localRecord;
    const records = Array.isArray(controller?.model?.state?.[tableKey])
      ? controller.model.state[tableKey]
      : [];
    const index = records.findIndex(
      (record) => String(record?.id) === String(authoritativeRecord.id),
    );
    const nextRecords = [...records];
    if (index >= 0) nextRecords[index] = authoritativeRecord;
    else nextRecords.push(authoritativeRecord);
    replaceTableProjection(controller.model, tableKey, nextRecords);
    return authoritativeRecord;
  } catch (error) {
    console.warn(`[Sync] Could not refresh ${tableKey}/${recordId} before mutation.`, error);
    return localRecord;
  }
}

export function stageLocalRecords(
  model,
  table,
  records,
  workspaceMutation = null,
  baseRecords = [],
) {
  const staged = (Array.isArray(records) ? records : [records]).filter(
    (record) => record?.id !== undefined && record?.id !== null && String(record.id) !== "",
  );
  if (!table || !staged.length || typeof model?.commitLocalMutation !== "function") return [];
  if (workspaceMutation && typeof model.commitWorkspaceMutation === "function") {
    model.commitWorkspaceMutation(workspaceMutation, table, { records: staged, baseRecords });
  } else {
    model.commitLocalMutation(table, { records: staged, baseRecords });
  }
  return staged;
}

// Intentional reducer boundary for business projections. Persistence and
// outbox staging remain explicit at the caller so a table replacement cannot
// silently become a full-table sync mutation.
export function replaceTableProjection(model, table, records) {
  model.assertStorageTablesWritable?.(table);
  model.state[table] = Array.isArray(records) ? records : [];
  model.entityIndexes?.invalidate?.(table);
  return model.state[table];
}

export function applyStateMutations(
  model,
  { upserts = {}, deletions = {}, mutate } = {},
  workspaceMutation = null,
) {
  const changed = new Set();
  model.assertStorageTablesWritable?.([
    ...Object.keys(upserts || {}),
    ...Object.keys(deletions || {}),
  ]);
  const state = workspaceMutation?.state || model.state;
  if (typeof mutate === "function") mutate(state, model);
  Object.entries(upserts).forEach(([table, records]) => {
    state[table] = Array.isArray(state[table]) ? state[table] : [];
    const staged = (Array.isArray(records) ? records : [records]).filter(Boolean).map((record) => {
      const normalized = model.normalizeRecordKeys?.(record, table) || record;
      const index = state[table].findIndex((item) => String(item.id) === String(normalized.id));
      if (index >= 0) state[table][index] = normalized;
      else state[table].push(normalized);
      return normalized;
    });
    stageLocalRecords(model, table, staged, workspaceMutation);
    changed.add(table);
  });
  Object.entries(deletions).forEach(([table, ids]) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    const deleted = new Set(idList.map(String));
    const deletedRecords = (state[table] || []).filter((record) => deleted.has(String(record.id)));
    state[table] = (state[table] || []).filter((record) => !deleted.has(String(record.id)));
    if (workspaceMutation && typeof model.commitWorkspaceMutation === "function") {
      model.commitWorkspaceMutation(workspaceMutation, table, {
        deletedIds: deletedRecords.length ? deletedRecords : idList,
      });
    } else {
      model.markDeleted?.(table, deletedRecords.length ? deletedRecords : idList);
    }
    changed.add(table);
  });
  return [...changed];
}

export async function mutatePersistAndSync(controller, mutation, options = {}) {
  const model = controller.model;
  if (typeof controller?.awaitAuthoritativeMutationBoundary === "function") {
    await controller.awaitAuthoritativeMutationBoundary();
  }
  const ownsMutation = !options.workspaceMutation
    && typeof model?.beginWorkspaceMutation === "function";
  const workspaceMutation = options.workspaceMutation
    || (ownsMutation ? model.beginWorkspaceMutation() : null);
  try {
    const changedTables = applyStateMutations(model, mutation, workspaceMutation);
    const tableKeys = options.tableKeys || changedTables;
    return await persistAndSync(controller, tableKeys, {
      ...options,
      authoritativeBoundaryChecked: true,
      changes: mutation,
      releaseBeforeRemoteSync: ownsMutation,
      workspaceMutation,
    });
  } finally {
    if (ownsMutation) model.finishWorkspaceMutation?.(workspaceMutation);
  }
}
