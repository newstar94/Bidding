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

export async function fetchDeltaSnapshot(apiFetch, {
  afterVersion,
  headers,
  maxPages = 10_000,
} = {}) {
  const aggregate = { deletions: [] };
  let cursor = "";
  let lastResponse = null;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const query = new URLSearchParams(
      cursor ? { cursor } : { after_version: String(afterVersion ?? 0) },
    );
    lastResponse = await apiFetch(`/api/sync/delta?${query}`, { headers });
    if (!lastResponse.ok) return { response: lastResponse, snapshot: null };
    const page = await lastResponse.json();
    Object.entries(page).forEach(([key, value]) => {
      if (!Array.isArray(value)) return;
      aggregate[key] ||= [];
      aggregate[key].push(...value);
    });
    aggregate.throughVersion = page.throughVersion;
    cursor = String(page.nextCursor || "");
    if (!cursor) {
      aggregate.partial = false;
      aggregate.syncVersion = page.syncVersion ?? page.throughVersion;
      return { response: lastResponse, snapshot: aggregate };
    }
  }
  throw new Error("SYNC_DELTA_PAGE_LIMIT_EXCEEDED");
}
