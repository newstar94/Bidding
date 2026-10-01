export class DraftRecoveryStore {
  constructor(storage, {
    storageKey,
    payloadField = "payload",
    delay = 800,
    now = () => Date.now(),
    schedule = (callback, timeout) => setTimeout(callback, timeout),
    cancel = (timer) => clearTimeout(timer),
    onError = () => {},
    shouldStore = () => true,
  } = {}) {
    if (!String(storageKey || "").trim()) {
      throw new TypeError("Draft recovery store requires a storage key.");
    }
    this.storage = storage;
    this.storageKey = storageKey;
    this.payloadField = payloadField;
    this.delay = delay;
    this.now = now;
    this.scheduleTimer = schedule;
    this.cancelTimer = cancel;
    this.onError = onError;
    this.shouldStore = shouldStore;
    this.pending = new Map();
    this.heldUntilReload = new Map();
    this.sequence = 0;
    this.durability = "ready";
    this.lastError = null;
  }

  reportError(error, durability) {
    this.lastError = error instanceof Error ? error : new Error(String(error));
    this.durability = durability;
    this.onError(this.lastError);
  }

  readAll() {
    let raw;
    try {
      raw = this.storage?.getItem?.(this.storageKey) || "{}";
    } catch (error) {
      this.reportError(error, "unavailable");
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError("Draft recovery payload must be an object.");
      }
      this.durability = "ready";
      this.lastError = null;
      return parsed;
    } catch (error) {
      this.reportError(error, "corrupt");
      return {};
    }
  }

  writeAll(drafts) {
    try {
      this.storage?.setItem?.(this.storageKey, JSON.stringify(drafts));
      this.durability = "ready";
      this.lastError = null;
      return true;
    } catch (error) {
      this.reportError(error, "degraded");
      return false;
    }
  }

  save(key, payload, { pendingServerSync = true } = {}) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || !this.shouldStore(payload)) return false;
    if (this.heldUntilReload.has(normalizedKey)) {
      this.heldUntilReload.set(normalizedKey, this.sessionDraft(payload));
      return false;
    }
    const drafts = this.readAll();
    if (this.durability !== "ready") return false;
    drafts[normalizedKey] = {
      [this.payloadField]: structuredClone(payload),
      savedAt: this.now(),
      pendingServerSync: Boolean(pendingServerSync),
    };
    return this.writeAll(drafts);
  }

  schedule(key, capture) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || typeof capture !== "function") return null;
    if (this.heldUntilReload.has(normalizedKey)) {
      this.heldUntilReload.set(normalizedKey, this.sessionDraft(capture()));
      return null;
    }
    const previous = this.pending.get(normalizedKey);
    if (previous) this.cancelTimer(previous.timer);
    const token = ++this.sequence;
    const timer = this.scheduleTimer(() => {
      const pending = this.pending.get(normalizedKey);
      if (!pending || pending.token !== token) return;
      this.pending.delete(normalizedKey);
      this.save(normalizedKey, capture());
    }, this.delay);
    this.pending.set(normalizedKey, { timer, token });
    return token;
  }

  restore(key) {
    const normalizedKey = String(key || "");
    const draft = this.heldUntilReload.get(normalizedKey) || this.readAll()[normalizedKey];
    if (!draft || !Object.prototype.hasOwnProperty.call(draft, this.payloadField)) return null;
    return structuredClone(draft);
  }

  clear(key) {
    const normalizedKey = String(key || "");
    const pending = this.pending.get(normalizedKey);
    if (pending) this.cancelTimer(pending.timer);
    this.pending.delete(normalizedKey);
    const drafts = this.readAll();
    if (this.durability !== "ready") return false;
    if (Object.prototype.hasOwnProperty.call(drafts, normalizedKey)) {
      delete drafts[normalizedKey];
      if (!this.writeAll(drafts)) return false;
    }
    this.heldUntilReload.delete(normalizedKey);
    return true;
  }

  sessionDraft(payload) {
    return {
      [this.payloadField]: structuredClone(payload), savedAt: this.now(),
      pendingServerSync: false, sessionOnly: true, reloadRequired: true,
    };
  }

  holdUntilReload(key, payload = undefined) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return { held: false, durableRemoval: false };
    const prior = this.restore(normalizedKey);
    const snapshot = payload === undefined ? prior?.[this.payloadField] : payload;
    const pending = this.pending.get(normalizedKey);
    if (pending) this.cancelTimer(pending.timer);
    this.pending.delete(normalizedKey);
    // Keep the entered input in this instance, even if durable removal fails.
    // Fresh instances never receive this session-only recovery.
    this.heldUntilReload.set(normalizedKey, this.sessionDraft(snapshot));
    const drafts = this.readAll();
    if (this.durability !== "ready") return { held: true, durableRemoval: false };
    if (!Object.prototype.hasOwnProperty.call(drafts, normalizedKey)) return { held: true, durableRemoval: true };
    delete drafts[normalizedKey];
    return { held: true, durableRemoval: this.writeAll(drafts) };
  }

  acknowledge(key, result) {
    if (!result?.ok) return false;
    return this.clear(key);
  }
}

export function isConfirmedRowVersionConflict(result) {
  if (result?.ok !== false) return false;
  const errors = Array.isArray(result?.data?.errors)
    ? result.data.errors : result?.data?.fields?.errors;
  return Array.isArray(errors) && errors.some((error) => error?.code === "ROW_VERSION_CONFLICT");
}
