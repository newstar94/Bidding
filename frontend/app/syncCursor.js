const VERSION_KEY = "bf_last_sync_version";
const TIMESTAMP_KEY = "bf_last_sync_timestamp";
const FETCH_TIME_KEY = "bf_last_fetch_time";

export function readSyncCursor(storage, { forceFull = false } = {}) {
  const lastSyncVersion = storage?.getItem(VERSION_KEY);
  const useVersionDelta = !forceFull && lastSyncVersion !== null && lastSyncVersion !== "";
  const since = forceFull ? "0" : storage?.getItem(TIMESTAMP_KEY) || "0";

  return {
    lastSyncVersion,
    since,
    useVersionDelta,
    query: useVersionDelta ? { after_version: lastSyncVersion } : { since }
  };
}

export function commitSyncCursor(storage, snapshot, { fetchedAt = Date.now() } = {}) {
  if (!storage) return { syncVersion: null, timestamp: null, fetchedAt };

  let syncVersion = null;
  let timestamp = null;
  if (!snapshot?.partial && snapshot?.syncVersion !== undefined && snapshot?.syncVersion !== null) {
    syncVersion = String(snapshot.syncVersion);
    storage.setItem(VERSION_KEY, syncVersion);
  }
  if (!snapshot?.partial && snapshot?.timestamp) {
    timestamp = String(snapshot.timestamp);
    storage.setItem(TIMESTAMP_KEY, timestamp);
  }
  storage.setItem(FETCH_TIME_KEY, String(fetchedAt));
  return { syncVersion, timestamp, fetchedAt };
}
