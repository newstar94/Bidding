import { normalizeMutationQueue } from "./mutationQueue.js";
import { generateUUID as createUUID } from "../shared/idUtils.js";

const MUTATION_QUEUE_KEY = "bf_mutation_queue";
const LOCAL_DELETIONS_KEY = "bf_local_deletions";
const OUTBOX_ENVELOPE_VERSION = 1;
const OUTBOX_DURABILITY_CODE = "OUTBOX_DURABILITY_DEGRADED";

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMutationQueue(value) {
  if (!isObject(value)) return false;
  const knownKeys = [
    "baseSyncVersion",
    "clientMutationId",
    "dirtyTables",
    "upserts",
    "deletes",
    "revision",
  ];
  if (!knownKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return false;
  if (value.dirtyTables !== undefined && !isObject(value.dirtyTables)) return false;
  if (value.upserts !== undefined && !isObject(value.upserts)) return false;
  if (value.deletes !== undefined && !Array.isArray(value.deletes)) return false;
  if (
    isObject(value.upserts)
    && Object.values(value.upserts).some((records) => (
      !isObject(records)
      || Object.values(records).some((record) => !isObject(record))
    ))
  ) return false;
  if (
    Array.isArray(value.deletes)
    && value.deletes.some((item) => (
      !isObject(item)
      || !String(item.table || "").trim()
      || !String(item.id || "").trim()
      || (item.expectedVersion !== undefined && !Number.isInteger(item.expectedVersion))
    ))
  ) return false;
  if (value.revision !== undefined && (!Number.isFinite(Number(value.revision)) || Number(value.revision) < 0)) {
    return false;
  }
  return true;
}

function normalizeEnvelope(value) {
  if (!isObject(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, "queue")) {
    if (value.queue !== null && !isMutationQueue(value.queue)) return null;
    if (value.localDeletions !== undefined && !Array.isArray(value.localDeletions)) return null;
    if (value.version !== undefined && !Number.isFinite(Number(value.version))) return null;
    if (value.revision !== undefined && (!Number.isFinite(Number(value.revision)) || Number(value.revision) < 0)) {
      return null;
    }
    if (value.savedAt !== undefined && (!Number.isFinite(Number(value.savedAt)) || Number(value.savedAt) < 0)) {
      return null;
    }
    return {
      version: Number(value.version || 0),
      revision: Number(value.revision || 0),
      savedAt: Number(value.savedAt || 0),
      queue: value.queue === null ? null : cloneValue(value.queue),
      localDeletions: Array.isArray(value.localDeletions)
        ? cloneValue(value.localDeletions)
        : undefined,
    };
  }
  if (!isMutationQueue(value)) return null;
  return {
    version: 0,
    revision: 0,
    savedAt: 0,
    queue: cloneValue(value),
    localDeletions: undefined,
  };
}

function selectNewestEnvelope(...values) {
  return values
    .filter(Boolean)
    .sort((left, right) => (
      right.revision - left.revision
      || right.savedAt - left.savedAt
    ))[0] || null;
}

function normalizeFailure(error, fallbackMessage) {
  return error instanceof Error
    ? error
    : new Error(String(error || fallbackMessage));
}

function buildDurabilityStatus(backends) {
  const configured = Object.values(backends).filter((state) => state !== "unavailable");
  const degraded = configured.length === 0
    || configured.some((state) => state !== "ready");
  return {
    backends: { ...backends },
    code: degraded ? OUTBOX_DURABILITY_CODE : null,
    recoverable: degraded,
    state: degraded ? "degraded" : "ready",
    trusted: !degraded,
  };
}

export class OutboxDurabilityError extends Error {
  constructor(status, failures = []) {
    const normalizedFailures = failures.filter(Boolean);
    super(normalizedFailures[0]?.message || "Mutation outbox durability is degraded");
    this.name = "OutboxDurabilityError";
    this.code = OUTBOX_DURABILITY_CODE;
    this.recoverable = true;
    this.status = cloneValue(status);
    this.failures = normalizedFailures;
  }
}

export class WorkspaceMutationOutboxStore {
  constructor({
    storage = null,
    database = null,
    now = () => Date.now(),
    onStatusChange = null,
  } = {}) {
    this.storage = storage;
    this.database = database;
    this.now = now;
    this.onStatusChange = onStatusChange;
    this.revision = 0;
    this.writePromise = Promise.resolve();
    this.writeError = null;
    this.status = {
      backends: { indexedDB: "pending", localStorage: "pending" },
      code: null,
      recoverable: false,
      state: "pending",
      trusted: false,
    };
  }

  getStatus() {
    return cloneValue(this.status);
  }

  _setStatus(status) {
    const changed = JSON.stringify(status) !== JSON.stringify(this.status);
    this.status = cloneValue(status);
    if (changed && typeof this.onStatusChange === "function") {
      this.onStatusChange(this.getStatus());
    }
  }

  persist(queue, localDeletions = []) {
    const envelope = {
      version: OUTBOX_ENVELOPE_VERSION,
      revision: this.revision + 1,
      savedAt: this.now(),
      queue: queue ? cloneValue(queue) : null,
      localDeletions: cloneValue(Array.isArray(localDeletions) ? localDeletions : []),
    };
    this.revision = envelope.revision;

    const localConfigured = typeof this.storage?.writeJson === "function";
    const databaseConfigured = typeof this.database?.set === "function";
    this._setStatus({
      backends: {
        indexedDB: databaseConfigured ? "pending" : "unavailable",
        localStorage: localConfigured ? "pending" : "unavailable",
      },
      code: null,
      recoverable: false,
      state: "pending",
      trusted: false,
    });
    let localFailure = null;
    if (localConfigured) {
      try {
        this.storage.writeJson(MUTATION_QUEUE_KEY, envelope);
        this.storage.writeJson(LOCAL_DELETIONS_KEY, envelope.localDeletions);
      } catch (error) {
        localFailure = normalizeFailure(error, "Cannot persist mutation outbox to localStorage");
      }
    }

    this.writePromise = this.writePromise.then(async () => {
      let databaseFailure = null;
      if (databaseConfigured) {
        try {
          await this.database.set(MUTATION_QUEUE_KEY, envelope);
        } catch (error) {
          databaseFailure = normalizeFailure(error, "Cannot persist mutation outbox to IndexedDB");
        }
      }
      const status = buildDurabilityStatus({
        indexedDB: databaseConfigured
          ? (databaseFailure ? "failed" : "ready")
          : "unavailable",
        localStorage: localConfigured
          ? (localFailure ? "failed" : "ready")
          : "unavailable",
      });
      this._setStatus(status);
      this.writeError = status.state === "degraded"
        ? new OutboxDurabilityError(status, [localFailure, databaseFailure])
        : null;
    });
    return envelope.revision;
  }

  async hydrate({
    baseSyncVersion = "0",
    createId = createUUID,
    repairCorrupt = false,
  } = {}) {
    await this.writePromise;
    const localConfigured = typeof this.storage?.readJson === "function";
    const databaseConfigured = typeof this.database?.get === "function";
    const localResult = {
      envelope: null,
      error: null,
      state: localConfigured ? "empty" : "unavailable",
    };
    const databaseResult = {
      envelope: null,
      error: null,
      state: databaseConfigured ? "empty" : "unavailable",
    };

    if (localConfigured) {
      try {
        const rawValue = typeof this.storage?.getItem === "function"
          ? this.storage.getItem(MUTATION_QUEUE_KEY)
          : null;
        const value = rawValue === null || rawValue === undefined
          ? this.storage.readJson(MUTATION_QUEUE_KEY, null)
          : typeof rawValue === "string"
            ? JSON.parse(rawValue)
            : rawValue;
        if (value !== null && value !== undefined) {
          localResult.envelope = normalizeEnvelope(value);
          localResult.state = localResult.envelope ? "ready" : "corrupt";
        }
      } catch (error) {
        localResult.error = normalizeFailure(error, "Cannot read mutation outbox from localStorage");
        localResult.state = error instanceof SyntaxError ? "corrupt" : "failed";
      }
    }
    if (databaseConfigured) {
      try {
        const value = await this.database.get(MUTATION_QUEUE_KEY);
        if (value !== null && value !== undefined) {
          databaseResult.envelope = normalizeEnvelope(value);
          databaseResult.state = databaseResult.envelope ? "ready" : "corrupt";
        }
      } catch (error) {
        databaseResult.error = normalizeFailure(error, "Cannot read mutation outbox from IndexedDB");
        databaseResult.state = "failed";
      }
    }

    if (
      localResult.envelope
      && databaseResult.envelope
      && localResult.envelope.revision === databaseResult.envelope.revision
      && localResult.envelope.savedAt === databaseResult.envelope.savedAt
      && JSON.stringify(localResult.envelope) !== JSON.stringify(databaseResult.envelope)
    ) {
      localResult.state = "conflict";
      databaseResult.state = "conflict";
    }

    const selected = selectNewestEnvelope(localResult.envelope, databaseResult.envelope);
    this.revision = Math.max(
      this.revision,
      Number(localResult.envelope?.revision || 0),
      Number(databaseResult.envelope?.revision || 0),
    );
    let localDeletions = Array.isArray(selected?.localDeletions)
      ? cloneValue(selected.localDeletions)
      : [];
    if (
      selected
      && !Array.isArray(selected.localDeletions)
      && localConfigured
      && ["ready", "empty"].includes(localResult.state)
    ) {
      try {
        const legacy = this.storage.readJson(LOCAL_DELETIONS_KEY, []);
        if (!Array.isArray(legacy)) localResult.state = "corrupt";
        else localDeletions = cloneValue(legacy);
      } catch (error) {
        localResult.error = normalizeFailure(error, "Cannot read local deletion evidence");
        localResult.state = "failed";
      }
    }

    this._setStatus(buildDurabilityStatus({
      indexedDB: databaseResult.state === "empty" ? "ready" : databaseResult.state,
      localStorage: localResult.state === "empty" ? "ready" : localResult.state,
    }));

    const queue = normalizeMutationQueue(cloneValue(selected?.queue), {
      baseSyncVersion,
      createId,
    });
    const corruptRepairAllowed = repairCorrupt
      && selected
      && ![localResult.state, databaseResult.state].includes("failed")
      && [localResult.state, databaseResult.state].includes("corrupt");
    if ((this.status.state === "ready" || corruptRepairAllowed) && selected) {
      const signature = JSON.stringify(selected);
      const needsRepair = [localResult, databaseResult].some((result) => (
        result.state !== "unavailable"
        && JSON.stringify(result.envelope) !== signature
      ));
      if (needsRepair) {
        this.persist(queue, localDeletions);
        try {
          await this.flush();
        } catch {
          // The degraded status is returned to the caller for explicit recovery.
        }
      }
    }
    if (this.status.state === "ready") this.writeError = null;
    return {
      durability: this.getStatus(),
      localDeletions,
      queue,
    };
  }

  async flush() {
    await this.writePromise;
    if (this.writeError) throw this.writeError;
  }
}
