const ACTIVE_ORG_KEY = "bf_active_org";
const WORKSPACE_PREFIX = "bf_workspace";
export const WORKSPACE_PURGE_EVENT_KEY = "bf_workspace_purge";
export const WORKSPACE_PURGE_CHANNEL = "biddingflow-workspace-purge";
const WORKSPACE_PURGE_PENDING_PREFIX = "bf_workspace_purge_pending:";

function getStorage(candidate, fallbackName) {
  if (candidate) return candidate;
  return typeof globalThis !== "undefined" ? globalThis[fallbackName] : null;
}

function requireIdentityPart(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Missing ${label} for workspace state`);
  return normalized;
}

export function getActiveOrganizationId(options = {}) {
  const session = getStorage(options.sessionStorage, "sessionStorage");
  const local = getStorage(options.localStorage, "localStorage");
  return String(session?.getItem(ACTIVE_ORG_KEY) || local?.getItem(ACTIVE_ORG_KEY) || "").trim();
}

export function setActiveOrganizationId(organizationId, options = {}) {
  const session = getStorage(options.sessionStorage, "sessionStorage");
  const local = getStorage(options.localStorage, "localStorage");
  const normalized = String(organizationId || "").trim();
  if (normalized) {
    session?.setItem(ACTIVE_ORG_KEY, normalized);
    if (options.persistPreference !== false) local?.setItem(ACTIVE_ORG_KEY, normalized);
  } else {
    session?.removeItem(ACTIVE_ORG_KEY);
    if (options.persistPreference !== false) local?.removeItem(ACTIVE_ORG_KEY);
  }
  return normalized;
}

export function createWorkspaceScope(userId, organizationId) {
  const user = requireIdentityPart(userId, "user ID");
  const organization = requireIdentityPart(organizationId, "organization ID");
  return {
    userId: user,
    organizationId: organization,
    key: `${encodeURIComponent(user)}:${encodeURIComponent(organization)}`
  };
}

export function resolveWorkspaceScope(options = {}) {
  const session = getStorage(options.sessionStorage, "sessionStorage");
  const local = getStorage(options.localStorage, "localStorage");
  const userId = options.userId || session?.getItem("bf_user_id") || local?.getItem("bf_user_id");
  const organizationId = options.organizationId || getActiveOrganizationId({ sessionStorage: session, localStorage: local });
  return createWorkspaceScope(userId, organizationId);
}

export function workspaceStorageKey(baseKey, scope) {
  if (!baseKey) throw new Error("Missing workspace storage key");
  return `${WORKSPACE_PREFIX}:${scope.key}:${baseKey}`;
}

export function workspaceDatabaseName(scope) {
  return `BiddingFlowDB_${scope.key}`;
}

function removeUserWorkspaceStorage(storage, userId) {
  if (!storage || !userId) return;
  const prefix = `${WORKSPACE_PREFIX}:${encodeURIComponent(userId)}:`;
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

async function deleteWorkspaceDatabase(databaseApi, databaseName) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const request = databaseApi.deleteDatabase(databaseName);
        const timeout = globalThis.setTimeout(
          () => reject(new Error(`Workspace database is still open: ${databaseName}`)),
          2_000
        );
        const finish = (callback) => {
          globalThis.clearTimeout(timeout);
          callback();
        };
        request.onsuccess = () => finish(resolve);
        request.onerror = () => finish(() => reject(request.error || new Error("Cannot delete workspace database")));
        request.onblocked = () => finish(() => reject(new Error(`Workspace database deletion is blocked: ${databaseName}`)));
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function purgeWorkspaceLocalData(scope, options = {}) {
  if (!scope?.key) return false;
  const local = getStorage(options.localStorage, "localStorage");
  const session = getStorage(options.sessionStorage, "sessionStorage");
  const purgeMessage = { scopeKey: scope.key, userId: scope.userId, at: Date.now() };
  const pendingKey = `${WORKSPACE_PURGE_PENDING_PREFIX}${encodeURIComponent(scope.userId)}`;
  local?.setItem(pendingKey, JSON.stringify({
    userId: scope.userId,
    organizationId: scope.organizationId,
    scopeKey: scope.key,
  }));
  local?.setItem(WORKSPACE_PURGE_EVENT_KEY, JSON.stringify(purgeMessage));
  const channel = typeof globalThis.BroadcastChannel === "function"
    ? new globalThis.BroadcastChannel(WORKSPACE_PURGE_CHANNEL)
    : null;
  channel?.postMessage(purgeMessage);
  removeUserWorkspaceStorage(local, scope.userId);
  removeUserWorkspaceStorage(session, scope.userId);
  const databaseApi = options.indexedDB || globalThis.indexedDB;
  if (!databaseApi?.deleteDatabase) {
    channel?.close();
    local?.removeItem(WORKSPACE_PURGE_EVENT_KEY);
    local?.removeItem(pendingKey);
    return true;
  }
  try {
    const currentName = workspaceDatabaseName(scope);
    let databaseNames = [currentName];
    if (typeof databaseApi.databases === "function") {
      const userPrefix = `BiddingFlowDB_${encodeURIComponent(scope.userId)}:`;
      const knownDatabases = await databaseApi.databases();
      databaseNames = knownDatabases
        .map((entry) => entry?.name)
        .filter((name) => name === currentName || name?.startsWith(userPrefix));
      if (!databaseNames.includes(currentName)) databaseNames.push(currentName);
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    for (const databaseName of new Set(databaseNames)) {
      await deleteWorkspaceDatabase(databaseApi, databaseName);
    }
    local?.removeItem(pendingKey);
  } finally {
    channel?.close();
    local?.removeItem(WORKSPACE_PURGE_EVENT_KEY);
  }
  return true;
}

export async function retryPendingWorkspacePurges(options = {}) {
  const local = getStorage(options.localStorage, "localStorage");
  if (!local) return 0;
  const pending = [];
  for (let index = 0; index < local.length; index += 1) {
    const key = local.key(index);
    if (!key?.startsWith(WORKSPACE_PURGE_PENDING_PREFIX)) continue;
    try {
      const value = JSON.parse(local.getItem(key) || "null");
      if (value?.userId && value?.organizationId) pending.push(value);
    } catch (_) {
      local.removeItem(key);
    }
  }
  let completed = 0;
  for (const item of pending) {
    try {
      await purgeWorkspaceLocalData(createWorkspaceScope(item.userId, item.organizationId), options);
      completed += 1;
    } catch (error) {
      console.warn("Pending workspace purge is still blocked:", error);
    }
  }
  return completed;
}

export class ScopedWorkspaceStorage {
  constructor(scope, storage = null) {
    this.scope = scope;
    this.storage = getStorage(storage, "localStorage");
  }

  key(baseKey) {
    return workspaceStorageKey(baseKey, this.scope);
  }

  getItem(baseKey) {
    return this.storage?.getItem(this.key(baseKey)) ?? null;
  }

  setItem(baseKey, value) {
    this.storage?.setItem(this.key(baseKey), String(value));
  }

  removeItem(baseKey) {
    this.storage?.removeItem(this.key(baseKey));
  }

  readJson(baseKey, fallback) {
    try {
      const value = this.getItem(baseKey);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  writeJson(baseKey, value) {
    this.setItem(baseKey, JSON.stringify(value));
  }
}

export function getWorkspaceStorage(options = {}) {
  const scope = options.scope || resolveWorkspaceScope(options);
  return new ScopedWorkspaceStorage(scope, options.storage || options.localStorage);
}

export function isWorkspaceStorageEvent(event, scope) {
  return typeof event?.key === "string" && event.key.startsWith(`${WORKSPACE_PREFIX}:${scope.key}:`);
}
