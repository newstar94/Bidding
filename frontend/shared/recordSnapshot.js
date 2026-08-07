/**
 * Multi-step forms capture a local snapshot before they commit, so a sibling
 * save inside those steps (for example saving a package while the plan
 * breakdown modal is still open) can already have synced its records. Row
 * versions belong to the server from that moment on, so a snapshot must never
 * resurrect the version it captured: the next sync would send a stale
 * expectedVersion and the server would reject the whole batch with
 * ROW_VERSION_CONFLICT (HTTP 409).
 */
const SERVER_OWNED_RECORD_FIELDS = [
  "rowVersion",
  "syncVersion",
  "organizationId",
  "ownerType",
  "archivedAt",
  // The server recalculates is_latest for a version family, and it is guarded
  // by a unique index. Reviving the captured flag would mark two versions of
  // the same family as latest.
  "isLatest",
];

function indexById(records) {
  return new Map(
    (Array.isArray(records) ? records : [])
      .filter((record) => record?.id !== undefined && record?.id !== null)
      .map((record) => [String(record.id), record]),
  );
}

function cloneRecord(record) {
  if (!record || typeof record !== "object") return record;
  return typeof structuredClone === "function"
    ? structuredClone(record)
    : JSON.parse(JSON.stringify(record));
}

/**
 * A record the server has already accepted carries a row version. Undoing a
 * local form must not delete it: the row exists in the database, so dropping it
 * from local state makes the client recompute derived values (such as the next
 * `phienBan` of a version family) from an incomplete picture and collide with
 * the rows it cannot see.
 */
function isCommittedOnServer(record) {
  return Number.isInteger(record?.rowVersion) && record.rowVersion > 0;
}

/**
 * Restore the business fields captured in `snapshotRecords` while keeping the
 * server-owned metadata of the records that are currently live.
 *
 * Records that appeared after the snapshot was captured are kept when the
 * server already committed them, and dropped otherwise so that cancelling a
 * form still discards the rows that form created locally.
 */
export function restoreRecordSnapshot(liveRecords, snapshotRecords) {
  const liveById = indexById(liveRecords);
  const snapshots = Array.isArray(snapshotRecords) ? snapshotRecords : [];
  const snapshotIds = new Set(snapshots.map((snapshot) => String(snapshot?.id)));
  const restored = snapshots.map((snapshot) => {
    const restored = cloneRecord(snapshot);
    const live = liveById.get(String(snapshot?.id));
    if (!live) return restored;
    SERVER_OWNED_RECORD_FIELDS.forEach((field) => {
      if (live[field] === undefined) delete restored[field];
      else restored[field] = live[field];
    });
    return restored;
  });
  const committedAfterSnapshot = (Array.isArray(liveRecords) ? liveRecords : []).filter(
    (record) => !snapshotIds.has(String(record?.id)) && isCommittedOnServer(record),
  );
  return [...restored, ...committedAfterSnapshot];
}
