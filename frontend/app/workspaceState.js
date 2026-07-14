const ACTIVE_ORG_KEY = "bf_active_org";
const WORKSPACE_PREFIX = "bf_workspace";

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
