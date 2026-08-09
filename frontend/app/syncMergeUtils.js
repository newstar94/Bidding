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
function overlayPendingUpserts(incoming, pendingUpserts) {
  const merged = [...incoming];
  const indexById = new Map(
    merged.map((record, index) => [String(record?.id || ""), index]),
  );
  for (const record of pendingUpserts) {
    const id = String(record?.id || "");
    if (!id) continue;
    const index = indexById.get(id);
    if (index === undefined) {
      indexById.set(id, merged.length);
      merged.push(record);
    } else {
      merged[index] = record;
    }
  }
  return merged;
}
const hasMeaningfulValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== void 0 && value !== null && value !== "";
};
export function mergeReferenceRecords(model, key, incoming, { preserveLocalIds = new Set() } = {}) {
  if (!Array.isArray(model.state[key])) {
    model.state[key] = [];
  }
  const recordIndexById = new Map();
  model.state[key].forEach((item, index) => {
    const id = String(item?.id);
    if (!recordIndexById.has(id)) recordIndexById.set(id, index);
  });
  const mergedRecords = [];
  incoming.forEach((item) => {
    const referenceItem = { ...item, referenceOnly: true };
    const recordId = String(referenceItem.id);
    const idx = recordIndexById.get(recordId);
    if (idx === undefined) {
      recordIndexById.set(recordId, model.state[key].length);
      model.state[key].push(referenceItem);
      mergedRecords.push(referenceItem);
      return;
    }
    const existing = model.state[key][idx] || {};
    const referenceKeys = new Set([...Object.keys(referenceItem), "referenceOnly"]);
    const hasFullRecordFields = existing.referenceOnly === false || Object.entries(existing).some(
      ([field, value]) => !referenceKeys.has(field) && hasMeaningfulValue(value)
    );
    const isAuthoritativePackageReference = key === "goithau" && !preserveLocalIds.has(String(referenceItem.id));
    const authoritativeReference = isAuthoritativePackageReference
      ? Object.fromEntries(Object.entries(referenceItem).filter(([field]) => field !== "referenceOnly"))
      : {};
    const mergedRecord = hasFullRecordFields
      ? { ...referenceItem, ...existing, ...authoritativeReference, referenceOnly: isAuthoritativePackageReference }
      : { ...existing, ...referenceItem, referenceOnly: true };
    model.state[key][idx] = mergedRecord;
    mergedRecords.push(mergedRecord);
  });
  return mergedRecords;
}
export function applyServerSnapshot(model, dbData, options = {}) {
  const metadataKeys = /* @__PURE__ */ new Set(["deletions", "useServerSidePagination", "timestamp", "paginatedKeys", "recordManifest", "referenceData", "syncVersion", "dashboardSummary", "domainContract", "partial"]);
  const changedKeys = /* @__PURE__ */ new Set();
  const deletionsByTable = {};
  const overlayDeletionsByTable = {};
  const replacementsByTable = {};
  const upsertsByTable = {};
  const paginatedKeys = new Set(dbData.paginatedKeys || []);
  const useServerSidePagination = !!dbData.useServerSidePagination;
  const isFullInitialSync = !options.useVersionDelta && options.since === "0";
  const mutationBatch = typeof model.getMutationQueue === "function"
    ? model.getMutationQueue()
    : null;
  const pendingDeleteIdsByTable = new Map();
  for (const deletion of mutationBatch?.deletes || []) {
    const table = String(deletion?.table || "");
    const id = String(deletion?.id || "");
    if (!table || !id) continue;
    if (!pendingDeleteIdsByTable.has(table)) {
      pendingDeleteIdsByTable.set(table, new Set());
    }
    pendingDeleteIdsByTable.get(table).add(id);
  }
  if (dbData.domainContract && typeof dbData.domainContract === "object") {
    model.domainContract = Object.freeze(dbData.domainContract);
  }
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
    return useServerSidePagination && paginatedKeys.has(key) && Array.isArray(incoming) && incoming.length === 0;
  };
  const applyIncoming = () => Object.keys(dbData).forEach((key) => {
    if (metadataKeys.has(key) || !Array.isArray(dbData[key])) return;
    const incoming = normalizeIncomingRecords(model, key, dbData[key]);
    if (isFullInitialSync) {
      if (shouldSkipEmptyPaginatedStore(key, incoming)) {
        return;
      }
      const pendingUpserts = Object.values(mutationBatch?.upserts?.[key] || {});
      const pendingDeleteIds = pendingDeleteIdsByTable.get(key) || new Set();
      const serverRecords = incoming.filter(
        (record) => !pendingDeleteIds.has(String(record?.id || "")),
      );
      const overlaid = overlayPendingUpserts(serverRecords, pendingUpserts);
      model.state[key] = overlaid;
      changedKeys.add(key);
      replacementsByTable[key] = overlaid;
      return;
    }
    const pendingUpserts = Object.values(mutationBatch?.upserts?.[key] || {});
    if (incoming.length === 0 && pendingUpserts.length === 0) return;
    const protectedIds = new Set(
      pendingUpserts.map((record) => String(record?.id || "")),
    );
    for (const id of pendingDeleteIdsByTable.get(key) || []) {
      protectedIds.add(id);
    }
    const serverIncoming = incoming.filter(
      (record) => !protectedIds.has(String(record?.id || "")),
    );
    mergeIncomingRecords(model, key, serverIncoming);
    mergeIncomingRecords(model, key, pendingUpserts);
    changedKeys.add(key);
    upsertsByTable[key] = [...serverIncoming, ...pendingUpserts];
  });
  if (typeof model.suspendMutationTracking === "function") {
    model.suspendMutationTracking(applyIncoming);
  } else {
    applyIncoming();
  }
  const applyReferenceData = () => Object.entries(dbData.referenceData || {}).forEach(([key, records]) => {
    if (!Array.isArray(records) || records.length === 0) return;
    const pendingDeleteIds = pendingDeleteIdsByTable.get(key) || new Set();
    const incoming = normalizeIncomingRecords(model, key, records).filter(
      (record) => !pendingDeleteIds.has(String(record?.id || "")),
    );
    if (incoming.length === 0) return;
    const inFlightIds = new Set(Object.keys(mutationBatch?.upserts?.[key] || {}).map((id) => String(id)));
    const mergedRecords = mergeReferenceRecords(
      model,
      key,
      incoming,
      { preserveLocalIds: inFlightIds },
    );
    changedKeys.add(key);
    upsertsByTable[key] = [...(upsertsByTable[key] || []), ...mergedRecords];
  });
  if (typeof model.suspendMutationTracking === "function") {
    model.suspendMutationTracking(applyReferenceData);
  } else {
    applyReferenceData();
  }
  Object.entries(dbData.recordManifest || {}).forEach(([key, serverRecordIds]) => {
    if (!Array.isArray(serverRecordIds) || !Array.isArray(model.state[key])) return;
    const serverIds = new Set(serverRecordIds.map((id) => String(id)));
    const inFlightIds = new Set(Object.keys(mutationBatch?.upserts?.[key] || {}).map((id) => String(id)));
    const removedIds = [];
    model.state[key] = model.state[key].filter((item) => {
      const id = String(item?.id || "");
      const keep = serverIds.has(id) || inFlightIds.has(id);
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
      const pendingUpsertIds = new Set(
        Object.keys(mutationBatch?.upserts?.[key] || {}).map(String),
      );
      if (pendingUpsertIds.has(String(id))) return;
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
  for (const [key, pendingDeleteIds] of pendingDeleteIdsByTable) {
    if (!Array.isArray(model.state[key]) || pendingDeleteIds.size === 0) continue;
    const removedIds = [];
    const retainedRecords = model.state[key].filter((record) => {
      const id = String(record?.id || "");
      if (!pendingDeleteIds.has(id)) return true;
      if (id) removedIds.push(id);
      return false;
    });
    if (removedIds.length > 0) {
      model.state[key].splice(0, model.state[key].length, ...retainedRecords);
      changedKeys.add(key);
      overlayDeletionsByTable[key] = removedIds;
    }
  }
  let persistencePromise = Promise.resolve();
  if (model.db && typeof model.db.applySyncChanges === "function") {
    const persistenceDeletions = { ...deletionsByTable };
    Object.entries(overlayDeletionsByTable).forEach(([key, ids]) => {
      persistenceDeletions[key] = [
        ...new Set([...(persistenceDeletions[key] || []), ...ids]),
      ];
    });
    persistencePromise = model.db.applySyncChanges({
      replacements: replacementsByTable,
      upserts: upsertsByTable,
      deletions: persistenceDeletions
    });
  } else if (typeof model.persistData === "function") {
    persistencePromise = Promise.all(Array.from(changedKeys).map((key) => model.persistData(key, { trackMutation: false })));
  }
  for (const key of changedKeys) model.entityIndexes?.invalidate?.(key);
  return { changedKeys, deletionsByTable, useServerSidePagination, persistencePromise };
}
