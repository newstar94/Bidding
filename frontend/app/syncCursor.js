const VERSION_KEY = "bf_last_sync_version";
const TIMESTAMP_KEY = "bf_last_sync_timestamp";
const FETCH_TIME_KEY = "bf_last_fetch_time";
const VISIBILITY_KEY = "bf_visibility_token";
const ACTIVE_ROLE_KEY = "bf_sync_active_role";

export function readSyncCursor(storage, { forceFull = false, currentRole = "" } = {}) {
  const lastSyncVersion = storage?.getItem(VERSION_KEY);
  const storedVisibilityToken = storage?.getItem(VISIBILITY_KEY) || "";
  const storedActiveRole = String(storage?.getItem(ACTIVE_ROLE_KEY) || "").trim().toLowerCase();
  const normalizedCurrentRole = String(currentRole || "").trim().toLowerCase();
  const roleMatchesCursor = !normalizedCurrentRole
    || (Boolean(storedActiveRole) && storedActiveRole === normalizedCurrentRole);
  const hasLegacyVersionWithoutVisibility = !forceFull
    && lastSyncVersion !== null
    && lastSyncVersion !== ""
    && !storedVisibilityToken;
  const useVersionDelta = !forceFull
    && lastSyncVersion !== null
    && lastSyncVersion !== ""
    && Boolean(storedVisibilityToken)
    && roleMatchesCursor;
  const since = forceFull || hasLegacyVersionWithoutVisibility || !roleMatchesCursor
    ? "0"
    : storage?.getItem(TIMESTAMP_KEY) || "0";
  const visibilityToken = forceFull ? "" : storedVisibilityToken;

  return {
    lastSyncVersion,
    since,
    useVersionDelta,
    visibilityToken,
    query: useVersionDelta
      ? { after_version: lastSyncVersion, ...(visibilityToken ? { visibility_token: visibilityToken } : {}) }
      : { since }
  };
}

export function commitSyncCursor(storage, snapshot, {
  fetchedAt = Date.now(),
  currentRole = "",
} = {}) {
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
  if (!snapshot?.partial && snapshot?.visibilityToken) {
    storage.setItem(VISIBILITY_KEY, String(snapshot.visibilityToken));
  }
  const normalizedCurrentRole = String(currentRole || "").trim().toLowerCase();
  if (!snapshot?.partial && normalizedCurrentRole) {
    storage.setItem(ACTIVE_ROLE_KEY, normalizedCurrentRole);
  }
  storage.setItem(FETCH_TIME_KEY, String(fetchedAt));
  return { syncVersion, timestamp, fetchedAt };
}

export async function fetchDeltaSnapshot(apiFetch, {
  afterVersion,
  visibilityToken,
  headers,
  signal,
  maxPages = 10_000,
} = {}) {
  const aggregate = { deletions: [] };
  let cursor = "";
  let lastResponse = null;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const query = new URLSearchParams(
      cursor
        ? { cursor }
        : {
            after_version: String(afterVersion ?? 0),
            ...(visibilityToken ? { visibility_token: visibilityToken } : {}),
          },
    );
    lastResponse = await apiFetch(`/api/sync/delta?${query}`, { headers, signal });
    if (!lastResponse.ok) return { response: lastResponse, snapshot: null };
    const page = await lastResponse.json();
    Object.entries(page).forEach(([key, value]) => {
      if (!Array.isArray(value)) return;
      aggregate[key] ||= [];
      aggregate[key].push(...value);
    });
    aggregate.throughVersion = page.throughVersion;
    aggregate.visibilityToken = page.visibilityToken;
    cursor = String(page.nextCursor || "");
    if (!cursor) {
      aggregate.partial = false;
      aggregate.syncVersion = page.syncVersion ?? page.throughVersion;
      return { response: lastResponse, snapshot: aggregate };
    }
  }
  throw new Error("SYNC_DELTA_PAGE_LIMIT_EXCEEDED");
}
