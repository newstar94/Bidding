export async function persistAndSync(controller, tableKeys, { afterPersist } = {}) {
  const keys = [...new Set((Array.isArray(tableKeys) ? tableKeys : [tableKeys]).filter(Boolean))];
  for (const key of keys) {
    await controller.model.persistData(key);
  }
  const usesServerPagination = Boolean(controller.model?.useServerSidePagination);
  if (!usesServerPagination && typeof afterPersist === "function") {
    await afterPersist();
  }
  const syncResult = typeof controller.autoSync === "function"
    ? await controller.autoSync()
    : { ok: true };
  if (usesServerPagination && syncResult?.ok !== false && typeof afterPersist === "function") {
    await afterPersist();
  }
  return syncResult;
}

export function applyStateMutations(model, { upserts = {}, deletions = {}, mutate } = {}) {
  const changed = new Set();
  if (typeof mutate === "function") mutate(model.state, model);
  Object.entries(upserts).forEach(([table, records]) => {
    model.state[table] = Array.isArray(model.state[table]) ? model.state[table] : [];
    (Array.isArray(records) ? records : [records]).filter(Boolean).forEach((record) => {
      const normalized = model.normalizeRecordKeys?.(record, table) || record;
      const index = model.state[table].findIndex((item) => String(item.id) === String(normalized.id));
      if (index >= 0) model.state[table][index] = normalized;
      else model.state[table].push(normalized);
    });
    changed.add(table);
  });
  Object.entries(deletions).forEach(([table, ids]) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    const deleted = new Set(idList.map(String));
    model.state[table] = (model.state[table] || []).filter((record) => !deleted.has(String(record.id)));
    model.markDeleted?.(table, idList);
    changed.add(table);
  });
  return [...changed];
}

export async function mutatePersistAndSync(controller, mutation, options = {}) {
  const changedTables = applyStateMutations(controller.model, mutation);
  const tableKeys = options.tableKeys || changedTables;
  return persistAndSync(controller, tableKeys, options);
}
