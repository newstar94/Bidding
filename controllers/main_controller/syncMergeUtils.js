export function normalizeIncomingRecords(model, key, records) {
  if (model && typeof model.normalizeRecordKeys === "function") {
    return (records || []).map((record) => model.normalizeRecordKeys(record, key));
  }
  return records || [];
}
export function mergeIncomingRecords(model, key, incoming) {
  if (!Array.isArray(model.state[key])) {
    model.state[key] = [];
  }
  incoming.forEach((item) => {
    const idx = model.state[key].findIndex((x) => String(x.id) === String(item.id));
    if (idx !== -1) {
      model.state[key][idx] = item;
    } else {
      model.state[key].push(item);
    }
  });
}
export function applySyncPayload(model, dbData, options = {}) {
  const metadataKeys = /* @__PURE__ */ new Set(["deletions", "useServerSidePagination", "timestamp", "paginatedKeys", "recordManifest", "syncVersion", "dashboardSummary", "partial"]);
  const changedKeys = /* @__PURE__ */ new Set();
  const deletionsByTable = {};
  const replacementsByTable = {};
  const upsertsByTable = {};
  const paginatedKeys = new Set(dbData.paginatedKeys || []);
  const useServerSidePagination = !!dbData.useServerSidePagination;
  const isFullInitialSync = !options.useVersionDelta && options.since === "0";
  if (isFullInitialSync || useServerSidePagination) {
    model.useServerSidePagination = useServerSidePagination;
  }
  if (dbData.dashboardSummary != null) {
    model.dashboardSummary = dbData.dashboardSummary;
    changedKeys.add("dashboardSummary");
  } else if (isFullInitialSync) {
    model.dashboardSummary = null;
  }
  const shouldSkipEmptyPaginatedStore = (key, incoming) => {
    return useServerSidePagination && paginatedKeys.has(key) && Array.isArray(incoming) && incoming.length === 0 && Array.isArray(model.state[key]) && model.state[key].length > 0;
  };
  const applyIncoming = () => Object.keys(dbData).forEach((key) => {
    if (metadataKeys.has(key) || !Array.isArray(dbData[key])) return;
    const incoming = normalizeIncomingRecords(model, key, dbData[key]);
    if (isFullInitialSync) {
      if (shouldSkipEmptyPaginatedStore(key, incoming)) {
        return;
      }
      model.state[key] = incoming;
      changedKeys.add(key);
      replacementsByTable[key] = incoming;
      return;
    }
    if (incoming.length === 0) return;
    mergeIncomingRecords(model, key, incoming);
    changedKeys.add(key);
    upsertsByTable[key] = incoming;
  });
  if (typeof model.suspendMutationTracking === "function") {
    model.suspendMutationTracking(applyIncoming);
  } else {
    applyIncoming();
  }
  const mutationQueue = typeof model.getMutationQueue === "function" ? model.getMutationQueue() : null;
  Object.entries(dbData.recordManifest || {}).forEach(([key, serverRecordIds]) => {
    if (!Array.isArray(serverRecordIds) || !Array.isArray(model.state[key])) return;
    const serverIds = new Set(serverRecordIds.map((id) => String(id)));
    const pendingIds = new Set(Object.keys(mutationQueue?.upserts?.[key] || {}).map((id) => String(id)));
    const removedIds = [];
    model.state[key] = model.state[key].filter((item) => {
      const id = String(item?.id || "");
      const keep = serverIds.has(id) || pendingIds.has(id);
      if (!keep && id) removedIds.push(id);
      return keep;
    });
    if (removedIds.length > 0) {
      changedKeys.add(key);
      if (!deletionsByTable[key]) deletionsByTable[key] = [];
      deletionsByTable[key].push(...removedIds);
    }
  });
  if (!isFullInitialSync) {
    (dbData.deletions || []).forEach((del) => {
      const key = del.table;
      const id = del.id;
      if (model.state[key]) {
        model.state[key] = model.state[key].filter((x) => String(x.id) !== String(id));
        changedKeys.add(key);
        if (!deletionsByTable[key]) {
          deletionsByTable[key] = [];
        }
        deletionsByTable[key].push(id);
      }
    });
  }
  let persistencePromise = Promise.resolve();
  if (model.db && typeof model.db.applySyncChanges === "function") {
    persistencePromise = model.db.applySyncChanges({
      replacements: replacementsByTable,
      upserts: upsertsByTable,
      deletions: deletionsByTable
    });
  } else if (typeof model.persistData === "function") {
    persistencePromise = Promise.all(Array.from(changedKeys).map((key) => model.persistData(key, { trackMutation: false })));
  }
  return { changedKeys, deletionsByTable, useServerSidePagination, persistencePromise };
}
