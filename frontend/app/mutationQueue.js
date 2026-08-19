export function createEmptyMutationQueue(baseSyncVersion = "0", clientMutationId = "") {
  return {
    baseSyncVersion: String(baseSyncVersion || "0"),
    clientMutationId,
    dirtyTables: {},
    upserts: {},
    patches: {},
    deletes: [],
    revision: 0
  };
}

export function normalizeMutationQueue(queue, { baseSyncVersion = "0", createId = () => "" } = {}) {
  const normalized = queue && typeof queue === "object"
    ? queue
    : createEmptyMutationQueue(baseSyncVersion, createId());
  normalized.baseSyncVersion = normalized.baseSyncVersion ?? String(baseSyncVersion || "0");
  normalized.clientMutationId = normalized.clientMutationId || createId();
  normalized.dirtyTables = normalized.dirtyTables && typeof normalized.dirtyTables === "object" ? normalized.dirtyTables : {};
  normalized.upserts = normalized.upserts && typeof normalized.upserts === "object" ? normalized.upserts : {};
  if (normalized.patches !== undefined
    && (!normalized.patches || typeof normalized.patches !== "object")) {
    normalized.patches = {};
  }
  normalized.deletes = Array.isArray(normalized.deletes) ? normalized.deletes : [];
  normalized.revision = Number.isFinite(Number(normalized.revision)) ? Number(normalized.revision) : 0;
  return normalized;
}

export function mutationQueueHasChanges(queue = {}) {
  return Object.keys(queue.dirtyTables || {}).some((key) => queue.dirtyTables[key])
    || Object.values(queue.upserts || {}).some((items) => items && Object.keys(items).length > 0)
    || Object.values(queue.patches || {}).some((items) => items && Object.keys(items).length > 0)
    || (Array.isArray(queue.deletes) && queue.deletes.length > 0);
}

export function buildMutationPayload({
  queue,
  state,
  localDeletions = [],
  isSyncedType,
  normalizeRecord,
  snapshot = undefined
}) {
  const payload = {
    clientMutationId: queue.clientMutationId,
    baseSyncVersion: queue.baseSyncVersion,
    deletions: []
  };
  const queueSnapshot = snapshot === undefined
    ? JSON.parse(JSON.stringify(queue))
    : snapshot;
  Object.keys(queue.dirtyTables || {}).forEach((type) => {
    if (!queue.dirtyTables[type] || !isSyncedType(type)) return;
    payload[type] = Array.isArray(state[type])
      ? state[type].map((record) => normalizeRecord(record, type))
      : [];
  });
  Object.entries(queue.upserts || {}).forEach(([type, recordsById]) => {
    if (!isSyncedType(type) || payload[type]) return;
    const records = Object.values(recordsById || {})
      .map((record) => normalizeRecord(record, type));
    if (records.length > 0) {
      payload[type] = records;
    }
  });
  Object.entries(queue.patches || {}).forEach(([type, recordsById]) => {
    if (!isSyncedType(type)) return;
    const canonicalById = new Map(
      (Array.isArray(state[type]) ? state[type] : [])
        .filter((record) => record?.id !== undefined && record?.id !== null)
        .map((record) => [String(record.id), record]),
    );
    const materialized = Object.values(recordsById || {}).flatMap((patch) => {
      const canonical = canonicalById.get(String(patch?.id || ""));
      return canonical ? [normalizeRecord(applyRecordPatch(canonical, patch), type)] : [];
    });
    if (materialized.length === 0) return;
    const existing = Array.isArray(payload[type]) ? payload[type] : [];
    const byId = new Map(existing.map((record) => [String(record?.id || ""), record]));
    materialized.forEach((record) => byId.set(String(record.id), record));
    payload[type] = [...byId.values()];
  });
  const deleteMap = new Map();
  [...(queue.deletes || []), ...(localDeletions || [])].forEach((item) => {
    if (!item?.table || !item?.id) return;
    deleteMap.set(`${item.table}::${item.id}`, {
      table: item.table,
      id: item.id,
      ...(Number.isInteger(item.expectedVersion) ? { expectedVersion: item.expectedVersion } : {})
    });
  });
  payload.deletions = [...deleteMap.values()];
  const hasUpserts = Object.keys(payload).some((key) => !["clientMutationId", "baseSyncVersion", "deletions"].includes(key));
  return hasUpserts || payload.deletions.length
    ? { payload, snapshot: queueSnapshot }
    : null;
}

const PATCH_AUTHORITATIVE_FIELDS = new Set([
  "id",
  "rootId",
  "rowVersion",
  "organizationId",
  "ownerType",
  "syncVersion",
  "createdAt",
  "archivedAt",
]);

export function applyRecordPatch(canonical, patch) {
  const merged = { ...(canonical || {}) };
  Object.entries(patch || {}).forEach(([field, value]) => {
    if (!PATCH_AUTHORITATIVE_FIELDS.has(field)) merged[field] = value;
  });
  PATCH_AUTHORITATIVE_FIELDS.forEach((field) => {
    if (canonical && Object.prototype.hasOwnProperty.call(canonical, field)) {
      merged[field] = canonical[field];
    }
  });
  return merged;
}
