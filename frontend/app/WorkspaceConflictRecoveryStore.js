const STORAGE_KEY = "bf_conflict_recovery_drafts_v1";
const STORE_VERSION = 1;
const MAX_DRAFTS = 20;

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizedErrors(data = {}) {
  return (Array.isArray(data?.errors) ? data.errors : [])
    .filter((error) => error && typeof error === "object")
    .map((error) => ({
      table: String(error.table || ""),
      id: String(error.id || ""),
      code: String(error.code || ""),
      message: String(error.message || ""),
    }));
}

function conflictFingerprint(checkpoint, data) {
  const records = normalizedErrors(data)
    .map((error) => `${error.table}:${error.id}:${error.code}`)
    .sort();
  if (records.length > 0) return records.join("|");
  return String(checkpoint?.queue?.clientMutationId || checkpoint?.queue?.revision || "unknown");
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
          draft && typeof draft === "object" && String(draft.id || "") && draft.checkpoint
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

  quarantine(checkpoint, data = {}) {
    if (!checkpoint?.queue) return null;
    const envelope = this._read();
    if (this.lastError) return null;
    const fingerprint = conflictFingerprint(checkpoint, data);
    const existing = envelope.drafts.find((draft) => draft.fingerprint === fingerprint);
    const draft = {
      id: existing?.id || String(this.createId()),
      fingerprint,
      checkpoint: cloneValue(checkpoint),
      currentSyncVersion: data?.currentSyncVersion ?? null,
      errors: normalizedErrors(data),
      savedAt: this.now(),
    };
    envelope.drafts = [
      draft,
      ...envelope.drafts.filter((item) => item.id !== draft.id),
    ].slice(0, MAX_DRAFTS);
    return this._write(envelope) ? cloneValue(draft) : null;
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
