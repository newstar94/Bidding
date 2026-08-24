const STORAGE_KEY = "bf_conflict_recovery_refs_v2";
const STORE_VERSION = 2;
const MAX_DRAFTS = 20;

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export class WorkspaceConflictRecoveryStore {
  constructor({
    storage,
    storageKey = STORAGE_KEY,
    now = () => Date.now(),
    createId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
  } = {}) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.now = now;
    this.createId = createId;
    this.lastError = null;
  }

  _read() {
    try {
      const parsed = JSON.parse(this.storage?.getItem?.(this.storageKey) || "null");
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.drafts)) {
        return { version: STORE_VERSION, drafts: [] };
      }
      this.lastError = null;
      return {
        version: STORE_VERSION,
        drafts: parsed.drafts.filter((draft) => (
          draft && typeof draft === "object" && String(draft.id || "")
        )),
      };
    } catch (error) {
      this.lastError = error;
      return { version: STORE_VERSION, drafts: [] };
    }
  }

  _write(envelope) {
    try {
      this.storage?.setItem?.(this.storageKey, JSON.stringify(envelope));
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error;
      return false;
    }
  }

  remember(serverDrafts) {
    const incoming = (Array.isArray(serverDrafts) ? serverDrafts : [serverDrafts])
      .filter((draft) => draft && typeof draft === "object" && String(draft.id || ""));
    if (incoming.length === 0) return [];
    const envelope = this._read();
    if (this.lastError) return [];
    const normalized = incoming.map((draft) => ({
      id: String(draft.id),
      entityType: String(draft.entityType || ""),
      tableName: String(draft.tableName || ""),
      recordId: String(draft.recordId || ""),
      status: String(draft.status || "ACTIVE"),
      expiresAt: Number(draft.expiresAt || 0),
      savedAt: this.now(),
    }));
    const incomingIds = new Set(normalized.map((draft) => draft.id));
    envelope.drafts = [
      ...normalized,
      ...envelope.drafts.filter((item) => !incomingIds.has(String(item.id))),
    ].slice(0, MAX_DRAFTS);
    return this._write(envelope) ? cloneValue(normalized) : [];
  }

  replace(serverDrafts) {
    const envelope = { version: STORE_VERSION, drafts: [] };
    if (!this._write(envelope)) return [];
    return this.remember(serverDrafts);
  }

  list() {
    return cloneValue(this._read().drafts)
      .sort((left, right) => Number(right.savedAt || 0) - Number(left.savedAt || 0));
  }

  latest() {
    return this.list()[0] || null;
  }

  count() {
    return this._read().drafts.length;
  }

  clear() {
    const envelope = this._read();
    if (this.lastError) return false;
    if (envelope.drafts.length === 0) return true;
    envelope.drafts = [];
    return this._write(envelope);
  }

  remove(id) {
    const normalizedId = String(id || "");
    if (!normalizedId) return false;
    const envelope = this._read();
    if (this.lastError) return false;
    const filtered = envelope.drafts.filter((draft) => String(draft.id) !== normalizedId);
    if (filtered.length === envelope.drafts.length) return true;
    envelope.drafts = filtered;
    return this._write(envelope);
  }
}
