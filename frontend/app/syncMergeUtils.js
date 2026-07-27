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
  const replacementsByTable = {};
  const upsertsByTable = {};
  const paginatedKeys = new Set(dbData.paginatedKeys || []);
  const useServerSidePagination = !!dbData.useServerSidePagination;
  const isFullInitialSync = !options.useVersionDelta && options.since === "0";
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
  const mutationBatch = typeof model.getMutationQueue === "function" ? model.getMutationQueue() : null;
  const applyReferenceData = () => Object.entries(dbData.referenceData || {}).forEach(([key, records]) => {
    if (!Array.isArray(records) || records.length === 0) return;
    const incoming = normalizeIncomingRecords(model, key, records);
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
