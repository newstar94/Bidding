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

export async function persistAndSync(controller, tableKeys, { afterPersist, changes = null } = {}) {
  const keys = [...new Set((Array.isArray(tableKeys) ? tableKeys : [tableKeys]).filter(Boolean))];
  controller._deferImmediateSync = true;
  if (controller._syncImmediateTimer) {
    clearTimeout(controller._syncImmediateTimer);
    controller._syncImmediateTimer = null;
  }
  try {
    for (const key of keys) {
      const tableChanges = explicitTableChanges(changes, key);
      if (tableChanges && typeof controller.model.persistChanges === "function") {
        await controller.model.persistChanges(key, tableChanges, { throwOnError: true });
      } else if (typeof controller.model.persistData === "function") {
        await controller.model.persistData(key, { throwOnError: true });
      }
    }
  } finally {
    controller._deferImmediateSync = false;
    if (controller._syncImmediateTimer) {
      clearTimeout(controller._syncImmediateTimer);
      controller._syncImmediateTimer = null;
    }
  }
  const usesServerPagination = Boolean(controller.model?.useServerSidePagination);
  // The server-side mutation flow already refreshes changed tables from
  // autoSync(). Defer that refresh when the caller supplies afterPersist so
  // the view is rendered exactly once after the sync has committed. Rendering
  // twice can abort the first pagination request and briefly show a false
  // "cannot load data" state after a delete.
  if (usesServerPagination && typeof afterPersist === "function") {
    controller._deferPostCommitRender = true;
  }
  if (!usesServerPagination && typeof afterPersist === "function") {
    await afterPersist();
  }
  await controller.model?.flushMutationOutbox?.();
  let syncResult;
  try {
    syncResult = typeof controller.autoSync === "function"
      ? await controller.autoSync()
      : { ok: true };
  } catch (error) {
    syncResult = { ok: false, transport: true, error };
  }
  if (usesServerPagination && syncResult?.ok !== false && typeof afterPersist === "function") {
    await afterPersist();
  }
  return syncResult;
}

/**
 * Deletions can be initiated from a paginated view whose IndexedDB copy is
 * older than the server row. Refresh the target before capturing its
 * expectedVersion so the first delete request is not rejected as a conflict.
 */
export async function refreshRecordBeforeDelete(controller, tableKey, recordId) {
  return refreshRecordBeforeMutation(controller, tableKey, recordId);
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
    return await controller.fetchRecordByLookup(tableKey, recordId) || localRecord;
  } catch (error) {
    console.warn(`[Sync] Could not refresh ${tableKey}/${recordId} before mutation.`, error);
    return localRecord;
  }
}

export function stageLocalRecords(model, table, records) {
  const staged = (Array.isArray(records) ? records : [records]).filter(
    (record) => record?.id !== undefined && record?.id !== null && String(record.id) !== "",
  );
  if (!table || !staged.length || typeof model?.commitLocalMutation !== "function") return [];
  model.commitLocalMutation(table, { records: staged });
  return staged;
}

export function applyStateMutations(model, { upserts = {}, deletions = {}, mutate } = {}) {
  const changed = new Set();
  const state = model.state;
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
    stageLocalRecords(model, table, staged);
    changed.add(table);
  });
  Object.entries(deletions).forEach(([table, ids]) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    const deleted = new Set(idList.map(String));
    const deletedRecords = (state[table] || []).filter((record) => deleted.has(String(record.id)));
    state[table] = (state[table] || []).filter((record) => !deleted.has(String(record.id)));
    model.markDeleted?.(table, deletedRecords.length ? deletedRecords : idList);
    changed.add(table);
  });
  return [...changed];
}

export async function mutatePersistAndSync(controller, mutation, options = {}) {
  const changedTables = applyStateMutations(controller.model, mutation);
  const tableKeys = options.tableKeys || changedTables;
  return persistAndSync(controller, tableKeys, { ...options, changes: mutation });
}
