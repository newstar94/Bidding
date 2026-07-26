import { normalizeMutationQueue } from "./mutationQueue.js";
import { generateUUID as createUUID } from "../shared/idUtils.js";

const MUTATION_QUEUE_KEY = "bf_mutation_queue";
const LOCAL_DELETIONS_KEY = "bf_local_deletions";
const OUTBOX_ENVELOPE_VERSION = 1;

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, "queue")) {
    return {
      version: Number(value.version || 0),
      revision: Number(value.revision || 0),
      savedAt: Number(value.savedAt || 0),
      queue: cloneValue(value.queue),
      localDeletions: Array.isArray(value.localDeletions)
        ? cloneValue(value.localDeletions)
        : undefined,
    };
  }
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
    .map(normalizeEnvelope)
    .filter(Boolean)
    .sort((left, right) => (
      right.revision - left.revision
      || right.savedAt - left.savedAt
    ))[0] || null;
}

function normalizeWriteError(error) {
  return error instanceof Error
    ? error
    : new Error(String(error || "Không thể lưu outbox đồng bộ."));
}

export class WorkspaceMutationOutboxStore {
  constructor({ storage = null, database = null, now = () => Date.now() } = {}) {
    this.storage = storage;
    this.database = database;
    this.now = now;
    this.revision = 0;
    this.writePromise = Promise.resolve();
    this.writeError = null;
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
    this.storage?.writeJson(MUTATION_QUEUE_KEY, envelope);
    this.storage?.writeJson(LOCAL_DELETIONS_KEY, envelope.localDeletions);

    const database = this.database;
    if (typeof database?.set !== "function") return envelope.revision;
    this.writePromise = this.writePromise
      .then(() => database.set(MUTATION_QUEUE_KEY, envelope))
      .then(() => {
        this.writeError = null;
      })
      .catch((error) => {
        this.writeError = normalizeWriteError(error);
      });
    return envelope.revision;
  }

  async hydrate({ baseSyncVersion = "0", createId = createUUID } = {}) {
    let localValue = null;
    let databaseValue = null;
    try {
      localValue = this.storage?.readJson(MUTATION_QUEUE_KEY, null) || null;
    } catch (_error) {
      localValue = null;
    }
    try {
      databaseValue = typeof this.database?.get === "function"
        ? await this.database.get(MUTATION_QUEUE_KEY)
        : null;
    } catch (_error) {
      databaseValue = null;
    }

    const selected = selectNewestEnvelope(localValue, databaseValue);
    this.revision = Math.max(this.revision, Number(selected?.revision || 0));
    this.writeError = null;
    const queue = normalizeMutationQueue(cloneValue(selected?.queue), {
      baseSyncVersion,
      createId,
    });

    let legacyDeletions = [];
    if (!Array.isArray(selected?.localDeletions)) {
      try {
        const value = this.storage?.readJson(LOCAL_DELETIONS_KEY, []);
        legacyDeletions = Array.isArray(value) ? value : [];
      } catch (_error) {
        legacyDeletions = [];
      }
    }
    const localDeletions = Array.isArray(selected?.localDeletions)
      ? cloneValue(selected.localDeletions)
      : cloneValue(legacyDeletions);
    return { queue, localDeletions };
  }

  async flush() {
    await this.writePromise;
    if (this.writeError) throw this.writeError;
  }
}
