export const DRAFT_RECOVERY_RETIREMENTS_KEY = "draft_recovery_retirements_v1";
const RETIREMENT_LIMIT = 512;

function fingerprint(value) {
  const source = JSON.stringify(value);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  return `${source.length}:${seeds.map((seed) => {
    let hash = seed;
    for (let index = 0; index < source.length; index++) {
      hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }).join("")}`;
}

function validateRetirements(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)
    || Object.values(value).some((entries) => !entries || typeof entries !== "object"
      || Array.isArray(entries) || Object.values(entries).some((stamp) => typeof stamp !== "string"))) {
    throw new Error("Invalid draft retirement metadata");
  }
  return value;
}

function retirementMatches(stamp, draft) {
  if (String(stamp || "").startsWith("before:")) {
    const savedAt = Number(draft?.savedAt);
    return !Number.isFinite(savedAt) || savedAt <= Number(stamp.slice(7));
  }
  return stamp === fingerprint(draft);
}

function pruneRetirements(entries, storage) {
  const next = structuredClone(entries);
  for (const [storageKey, keys] of Object.entries(next)) {
    let drafts;
    try { drafts = JSON.parse(storage?.getItem?.(storageKey) || "{}"); } catch { continue; }
    if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) continue;
    for (const [key, stamp] of Object.entries(keys)) {
      if (!drafts[key] || !retirementMatches(stamp, drafts[key])) delete keys[key];
    }
    if (!Object.keys(keys).length) delete next[storageKey];
  }
  return next;
}

export async function hydrateDraftRecoveryRetirements(model) {
  const database = model.db;
  const cache = model._draftRecoveryRetirements ||= { ready: false, entries: {} };
  try {
    cache.entries = validateRetirements(await database.get(DRAFT_RECOVERY_RETIREMENTS_KEY));
    cache.ready = true;
    return true;
  } catch (error) {
    cache.ready = false;
    cache.error = error;
    return false;
  }
}

export function draftRecoveryRetirementOptions(model) {
  const database = model?.db;
  const storage = model?.workspaceStorage;
  const cache = model ? (model._draftRecoveryRetirements ||= { ready: true, entries: {} }) : null;
  return {
    retirementCache: cache,
    async persistRetirement(storageKey, key, stamp) {
      if (typeof database?.update !== "function") throw new Error("Draft retirement storage is unavailable");
      const entries = await database.update(DRAFT_RECOVERY_RETIREMENTS_KEY, (current) => {
        const next = pruneRetirements(validateRetirements(current), storage);
        next[storageKey] ||= {};
        next[storageKey][key] = stamp;
        if (Object.values(next).reduce((count, keys) => count + Object.keys(keys).length, 0) > RETIREMENT_LIMIT) {
          throw new Error("Draft retirement storage limit reached");
        }
        return next;
      });
      cache.entries = entries;
      cache.ready = true;
    },
  };
}

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
    retirementCache = null,
    persistRetirement = null,
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
    this.retirementCache = retirementCache;
    this.persistRetirement = persistRetirement;
    this.pending = new Map();
    this.retired = new Set();
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
    const drafts = this.readAll();
    if (this.durability !== "ready") return false;
    drafts[normalizedKey] = {
      [this.payloadField]: structuredClone(payload),
      savedAt: this.now(),
      pendingServerSync: Boolean(pendingServerSync),
    };
    const saved = this.writeAll(drafts);
    if (saved) this.retired.delete(normalizedKey);
    return saved;
  }

  schedule(key, capture) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || typeof capture !== "function") return null;
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
    if (this.retired.has(normalizedKey)) return null;
    if (this.retirementCache?.ready === false) {
      this.reportError(this.retirementCache.error || new Error("Draft retirement metadata unavailable"), "unavailable");
      return null;
    }
    const draft = this.readAll()[normalizedKey];
    if (!draft || !Object.prototype.hasOwnProperty.call(draft, this.payloadField)) return null;
    const stamp = this.retirementCache?.entries?.[this.storageKey]?.[normalizedKey];
    if (stamp && retirementMatches(stamp, draft)) return null;
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
    return true;
  }

  retire(key) {
    const normalizedKey = String(key || "");
    this.retired.add(normalizedKey);
    return this.clear(normalizedKey);
  }

  async retireDurably(key) {
    const normalizedKey = String(key || "");
    const draft = this.readAll()[normalizedKey];
    if (this.retire(normalizedKey)) return true;
    if (typeof this.persistRetirement !== "function") return false;
    try {
      await this.persistRetirement(this.storageKey, normalizedKey,
        draft ? fingerprint(draft) : `before:${this.now()}`);
      return true;
    } catch (error) {
      this.reportError(error, "degraded");
      return false;
    }
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
