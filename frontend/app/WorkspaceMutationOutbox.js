import {
  buildMutationPayload,
  createEmptyMutationQueue,
  mutationQueueHasChanges,
  normalizeMutationQueue
} from "./mutationQueue.js";
import { generateUUID as defaultCreateId } from "../shared/idUtils.js";

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function recordKey(operation, table, id) {
  return `${operation}:${table}:${String(id)}`;
}

function hasRecordId(record) {
  return record && record.id !== undefined && record.id !== null && String(record.id) !== "";
}

const OUTBOX_PARENT_REFERENCES = {
  kehoach: [{ table: "chudautu", fields: ["chuDauTuId"] }],
  goithau: [
    { table: "kehoach", fields: ["keHoachId"] },
    { table: "nhathau", fields: ["nhaThauTrungThauId"] },
    { table: "goithau", fields: ["rebidFromPackageId"] },
  ],
  hopdong: [
    { table: "kehoach", fields: ["keHoachId"] },
    { table: "chudautu", fields: ["chuDauTuId", "chuDauTuThanhLyId"] },
    { table: "nhathau", fields: ["nhaThauId", "nhaThauThanhLyId"] },
    { table: "goithau", fields: ["goiThauIds"], many: true },
  ],
  thongtinmothau: [
    { table: "goithau", fields: ["goiThauId"] },
    { table: "nhathau", fields: ["nhaThauId"] },
  ],
  goithauhanghoa: [{ table: "goithau", fields: ["goiThauId"] }],
  hanghoaduthaunhathau: [
    { table: "goithau", fields: ["goiThauId"] },
    { table: "thongtinmothau", fields: ["thongTinMoThauId"] },
    { table: "goithauhanghoa", fields: ["goiThauHangHoaId"] },
  ],
};

function parentKeysForRecord(table, record) {
  const keys = [];
  (OUTBOX_PARENT_REFERENCES[table] || []).forEach((reference) => {
    reference.fields.forEach((field) => {
      const raw = record?.[field];
      const values = reference.many ? (Array.isArray(raw) ? raw : []) : [raw];
      values.forEach((value) => {
        if (value !== undefined && value !== null && String(value) !== "") {
          keys.push(`${reference.table}:${String(value)}`);
        }
      });
    });
  });
  if (table === "assignments") {
    const parentTable = {
      kehoach: "kehoach",
      goithau: "goithau",
      hopdong: "hopdong",
    }[String(record?.type || "")];
    if (parentTable && record?.targetId) keys.push(`${parentTable}:${String(record.targetId)}`);
  }
  return keys;
}

export class WorkspaceMutationOutbox {
  constructor({
    store,
    getBaseSyncVersion = () => "0",
    createId = defaultCreateId,
    isSyncedType = () => true,
    normalizeRecord = (record) => cloneValue(record),
    serializeRecord = normalizeRecord,
    resolveServerTable = (table) => table,
    onChange = null,
  } = {}) {
    if (!store) throw new Error("WorkspaceMutationOutbox requires a durable store");
    this.store = store;
    this.getBaseSyncVersion = getBaseSyncVersion;
    this.createId = createId;
    this.isSyncedType = isSyncedType;
    this.normalizeRecord = normalizeRecord;
    this.serializeRecord = serializeRecord;
    this.resolveServerTable = resolveServerTable;
    this.onChange = onChange;
    this.queue = createEmptyMutationQueue(this.getBaseSyncVersion(), this.createId());
    this.localDeletions = [];
    this.generation = 0;
    this.recordGenerations = new Map();
    this.tableGenerations = new Map();
  }

  snapshot() {
    return cloneValue(this.queue);
  }

  checkpoint() {
    return {
      queue: cloneValue(this.queue),
      localDeletions: cloneValue(this.localDeletions),
    };
  }

  restore(checkpoint) {
    if (!checkpoint || typeof checkpoint !== "object") return false;
    this.queue = normalizeMutationQueue(cloneValue(checkpoint.queue), {
      baseSyncVersion: this.getBaseSyncVersion(),
      createId: this.createId,
    });
    this.localDeletions = Array.isArray(checkpoint.localDeletions)
      ? cloneValue(checkpoint.localDeletions)
      : [];
    this._rebuildGenerations();
    this._persist();
    return true;
  }

  async hydrate(options = {}) {
    const hydrated = await this.store.hydrate({
      baseSyncVersion: this.getBaseSyncVersion(),
      createId: this.createId,
      ...options,
    });
    this.queue = normalizeMutationQueue(hydrated.queue, {
      baseSyncVersion: this.getBaseSyncVersion(),
      createId: this.createId,
    });
    this.localDeletions = Array.isArray(hydrated.localDeletions)
      ? hydrated.localDeletions
      : [];
    this._rebuildGenerations();
    this._notify();
    return this.snapshot();
  }

  async flush() {
    await this.store.flush();
  }

  enqueue(command = {}) {
    const kind = String(command.kind || "");
    let changed = false;
    if (kind === "upsert") changed = this._enqueueUpserts(command.table, command.records);
    else if (kind === "replace-table") changed = this._replaceTable(command.table, command.records);
    else if (kind === "delete") changed = this._enqueueDeletes(command.table, command.records);
    else if (kind === "server-row-version") changed = this._applyServerRowVersions(command.entries);
    else if (kind === "ack-server-deletions") changed = this._acknowledgeServerDeletions(command.deletionsByTable);
    else if (kind === "rebase") changed = this._rebase(command.syncVersion);
    if (!changed) return false;
    this._persist();
    return true;
  }

  snapshotForSync(state) {
    if (!mutationQueueHasChanges(this.queue)) return null;
    this._repairUnsyncedParentDependencies(state);
    const receipt = this._createReceipt();
    return buildMutationPayload({
      queue: this.queue,
      state,
      localDeletions: this.localDeletions,
      isSyncedType: this.isSyncedType,
      normalizeRecord: this.serializeRecord,
      snapshot: receipt,
    });
  }

  _repairUnsyncedParentDependencies(state) {
    let changed = false;
    let dependencyAdded = true;
    while (dependencyAdded) {
      dependencyAdded = false;
      Object.entries(this.queue.upserts || {}).forEach(([table, records]) => {
        Object.values(records || {}).forEach((record) => {
          parentKeysForRecord(table, record).forEach((parentKey) => {
            const separator = parentKey.indexOf(":");
            const parentTable = parentKey.slice(0, separator);
            const parentId = parentKey.slice(separator + 1);
            if (!parentTable || !parentId || this.queue.upserts?.[parentTable]?.[parentId]) return;
            const parent = (state?.[parentTable] || []).find(
              (candidate) => String(candidate?.id || "") === parentId,
            );
            if (!parent || parent.referenceOnly === true || Number(parent.rowVersion) > 0) return;
            if (!this.queue.upserts[parentTable]) this.queue.upserts[parentTable] = {};
            this.queue.upserts[parentTable][parentId] = cloneValue(
              this.normalizeRecord(parent, parentTable),
            );
            this._bumpRecord("upsert", parentTable, parentId);
            changed = true;
            dependencyAdded = true;
          });
        });
      });
    }
    if (changed) {
      this._touchForNewPayload();
      this._persist();
    }
    return changed;
  }

  ack(receipt) {
    if (!receipt || !mutationQueueHasChanges(this.queue)) return false;
    if (
      receipt.clientMutationId === this.queue.clientMutationId
      && Number(receipt.revision) === Number(this.queue.revision)
    ) {
      this._clear();
      return true;
    }

    let changed = false;
    Object.entries(receipt.upserts || {}).forEach(([table, records]) => {
      Object.entries(records || {}).forEach(([id, generation]) => {
        const key = recordKey("upsert", table, id);
        if (this.recordGenerations.get(key) !== generation) return;
        if (this.queue.upserts?.[table]?.[id]) {
          delete this.queue.upserts[table][id];
          changed = true;
        }
        this.recordGenerations.delete(key);
      });
      if (this.queue.upserts?.[table] && Object.keys(this.queue.upserts[table]).length === 0) {
        delete this.queue.upserts[table];
      }
    });
    Object.entries(receipt.dirtyTables || {}).forEach(([table, generation]) => {
      if (this.tableGenerations.get(table) !== generation) return;
      if (this.queue.dirtyTables?.[table]) {
        delete this.queue.dirtyTables[table];
        changed = true;
      }
      this.tableGenerations.delete(table);
    });
    Object.entries(receipt.deletes || {}).forEach(([key, generation]) => {
      if (this.recordGenerations.get(key) !== generation) return;
      const [, table, ...idParts] = key.split(":");
      const id = idParts.join(":");
      const before = this.queue.deletes.length;
      this.queue.deletes = this.queue.deletes.filter(
        (item) => !(item.table === table && String(item.id) === id)
      );
      this.localDeletions = this.localDeletions.filter(
        (item) => !(item.table === table && String(item.id) === id)
      );
      changed = changed || before !== this.queue.deletes.length;
      this.recordGenerations.delete(key);
    });
    if (changed) {
      if (mutationQueueHasChanges(this.queue)) this._touchForNewPayload();
      this._persist();
    }
    return changed;
  }

  reject(receipt, errors = []) {
    const rejectedKeys = new Set();
    (errors || []).forEach((error) => {
      const type = this.resolveServerTable(error?.table) || error?.table;
      const id = String(error?.id || "");
      if (type && id) rejectedKeys.add(`${type}:${id}`);
    });
    let dependencyAdded = true;
    while (dependencyAdded) {
      dependencyAdded = false;
      Object.entries(receipt?.upserts || {}).forEach(([table, records]) => {
        Object.entries(records || {}).forEach(([id, generation]) => {
          const key = `${table}:${String(id)}`;
          if (rejectedKeys.has(key)) return;
          if (this.recordGenerations.get(recordKey("upsert", table, id)) !== generation) return;
          const queued = this.queue.upserts?.[table]?.[id];
          if (!queued) return;
          if (parentKeysForRecord(table, queued).some((parentKey) => rejectedKeys.has(parentKey))) {
            rejectedKeys.add(key);
            dependencyAdded = true;
          }
        });
      });
    }

    const rejectedByRecord = new Map();
    let changed = false;
    const errorsByRecord = new Map();
    (errors || []).forEach((error) => {
      const type = this.resolveServerTable(error?.table) || error?.table;
      const id = String(error?.id || "");
      if (type && id) errorsByRecord.set(`${type}:${id}`, error);
    });
    rejectedKeys.forEach((key) => {
      const separator = key.indexOf(":");
      const type = key.slice(0, separator);
      const id = key.slice(separator + 1);
      const error = errorsByRecord.get(key) || {};
      if (!type || !id) return;
      let operation = "";
      const upsertKey = recordKey("upsert", type, id);
      const sentUpsertGeneration = receipt?.upserts?.[type]?.[id];
      if (
        sentUpsertGeneration !== undefined
        && this.recordGenerations.get(upsertKey) === sentUpsertGeneration
        && this.queue.upserts?.[type]?.[id]
      ) {
        delete this.queue.upserts[type][id];
        if (Object.keys(this.queue.upserts[type]).length === 0) delete this.queue.upserts[type];
        this.recordGenerations.delete(upsertKey);
        operation = "upsert";
        changed = true;
      }

      const deleteKey = recordKey("delete", type, id);
      const sentDeleteGeneration = receipt?.deletes?.[deleteKey];
      if (
        !operation
        && sentDeleteGeneration !== undefined
        && this.recordGenerations.get(deleteKey) === sentDeleteGeneration
      ) {
        const before = this.queue.deletes.length;
        this.queue.deletes = this.queue.deletes.filter(
          (item) => !(item.table === type && String(item.id) === id)
        );
        this.localDeletions = this.localDeletions.filter(
          (item) => !(item.table === type && String(item.id) === id)
        );
        if (before !== this.queue.deletes.length) {
          operation = "delete";
          changed = true;
        }
        this.recordGenerations.delete(deleteKey);
      }
      if (!operation) return;
      const rejectedKey = `${type}:${id}`;
      const existing = rejectedByRecord.get(rejectedKey);
      rejectedByRecord.set(rejectedKey, {
        type,
        id,
        operation: existing?.operation || operation,
        conflictingId: String(error?.conflictingId || existing?.conflictingId || ""),
      });
    });
    if (changed) {
      if (mutationQueueHasChanges(this.queue)) this._touchForNewPayload();
      this._persist();
    }
    return Array.from(rejectedByRecord.values());
  }

  discard() {
    if (!mutationQueueHasChanges(this.queue) && this.localDeletions.length === 0) return false;
    this._clear();
    return true;
  }

  _enqueueUpserts(table, records) {
    if (!table || !this.isSyncedType(table)) return false;
    const validRecords = (Array.isArray(records) ? records : [records]).filter(hasRecordId);
    if (validRecords.length === 0) return false;
    if (!this.queue.upserts[table]) this.queue.upserts[table] = {};
    validRecords.forEach((record) => {
      const id = String(record.id);
      this.queue.upserts[table][id] = cloneValue(this.normalizeRecord(record, table));
      this.queue.deletes = this.queue.deletes.filter(
        (item) => !(item.table === table && String(item.id) === id)
      );
      this.localDeletions = this.localDeletions.filter(
        (item) => !(item.table === table && String(item.id) === id)
      );
      this.recordGenerations.delete(recordKey("delete", table, id));
      this._bumpRecord("upsert", table, id);
    });
    this._touchForNewPayload();
    return true;
  }

  _replaceTable(table, records) {
    if (!table || !this.isSyncedType(table)) return false;
    const validRecords = (Array.isArray(records) ? records : []).filter(hasRecordId);
    if (validRecords.length === 0) return false;
    this.queue.dirtyTables[table] = false;
    this.queue.upserts[table] = {};
    const currentIds = new Set();
    validRecords.forEach((record) => {
      const id = String(record.id);
      currentIds.add(id);
      this.queue.upserts[table][id] = cloneValue(this.normalizeRecord(record, table));
      this._bumpRecord("upsert", table, id);
      this.recordGenerations.delete(recordKey("delete", table, id));
    });
    this.queue.deletes = this.queue.deletes.filter(
      (item) => item.table !== table || !currentIds.has(String(item.id))
    );
    this.localDeletions = this.localDeletions.filter(
      (item) => item.table !== table || !currentIds.has(String(item.id))
    );
    this._touchForNewPayload();
    return true;
  }

  _enqueueDeletes(table, records) {
    if (!table || !this.isSyncedType(table)) return false;
    const validRecords = (Array.isArray(records) ? records : [records]).filter(hasRecordId);
    if (validRecords.length === 0) return false;
    validRecords.forEach((record) => {
      const id = String(record.id);
      const expectedVersion = Number.isInteger(record.rowVersion)
        ? record.rowVersion
        : undefined;
      if (this.queue.upserts[table]) delete this.queue.upserts[table][id];
      if (this.queue.upserts[table] && Object.keys(this.queue.upserts[table]).length === 0) {
        delete this.queue.upserts[table];
      }
      this.recordGenerations.delete(recordKey("upsert", table, id));
      this._upsertDeletion(this.queue.deletes, table, id, expectedVersion);
      this._upsertDeletion(this.localDeletions, table, id, expectedVersion);
      this._bumpRecord("delete", table, id);
    });
    this._touchForNewPayload();
    return true;
  }

  _applyServerRowVersions(entries = []) {
    let changed = false;
    (entries || []).forEach((entry) => {
      const table = entry?.table;
      const id = String(entry?.id || "");
      const rowVersion = entry?.rowVersion;
      if (!table || !id || !Number.isInteger(rowVersion)) return;
      const queued = this.queue.upserts?.[table]?.[id];
      if (queued && queued.rowVersion !== rowVersion) {
        queued.rowVersion = rowVersion;
        changed = true;
      }
    });
    if (changed) this._touchForNewPayload();
    return changed;
  }

  _acknowledgeServerDeletions(deletionsByTable = {}) {
    const acknowledged = new Set();
    Object.entries(deletionsByTable || {}).forEach(([table, ids]) => {
      (ids || []).forEach((id) => {
        if (table && id !== undefined && id !== null && String(id) !== "") {
          acknowledged.add(`${table}:${String(id)}`);
        }
      });
    });
    if (acknowledged.size === 0) return false;
    const beforeQueue = this.queue.deletes.length;
    const beforeLocal = this.localDeletions.length;
    this.queue.deletes = this.queue.deletes.filter(
      (item) => !acknowledged.has(`${item.table}:${String(item.id)}`)
    );
    this.localDeletions = this.localDeletions.filter(
      (item) => !acknowledged.has(`${item.table}:${String(item.id)}`)
    );
    acknowledged.forEach((key) => {
      const separator = key.indexOf(":");
      this.recordGenerations.delete(recordKey(
        "delete",
        key.slice(0, separator),
        key.slice(separator + 1)
      ));
    });
    const changed = beforeQueue !== this.queue.deletes.length
      || beforeLocal !== this.localDeletions.length;
    if (changed && mutationQueueHasChanges(this.queue)) this._touchForNewPayload();
    return changed;
  }

  _rebase(syncVersion) {
    if (syncVersion === undefined || syncVersion === null || syncVersion === "") return false;
    if (!mutationQueueHasChanges(this.queue)) return false;
    const normalized = String(syncVersion);
    if (this.queue.baseSyncVersion === normalized) return false;
    this.queue.baseSyncVersion = normalized;
    this._touchForNewPayload();
    return true;
  }

  _upsertDeletion(target, table, id, expectedVersion) {
    const existing = target.find(
      (item) => item.table === table && String(item.id) === id
    );
    if (existing) {
      if (expectedVersion !== undefined) existing.expectedVersion = expectedVersion;
      return;
    }
    target.push({
      table,
      id,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    });
  }

  _touchForNewPayload() {
    this.queue.revision = (Number(this.queue.revision) || 0) + 1;
    this.queue.clientMutationId = this.createId();
    if (
      this.queue.baseSyncVersion === undefined
      || this.queue.baseSyncVersion === null
      || this.queue.baseSyncVersion === ""
    ) {
      this.queue.baseSyncVersion = String(this.getBaseSyncVersion() || "0");
    }
  }

  _bumpRecord(operation, table, id) {
    this.generation += 1;
    this.recordGenerations.set(recordKey(operation, table, id), this.generation);
  }

  _rebuildGenerations() {
    this.recordGenerations.clear();
    this.tableGenerations.clear();
    Object.entries(this.queue.upserts || {}).forEach(([table, records]) => {
      Object.keys(records || {}).forEach((id) => this._bumpRecord("upsert", table, id));
    });
    (this.queue.deletes || []).forEach((item) => {
      if (item?.table && hasRecordId(item)) this._bumpRecord("delete", item.table, item.id);
    });
    Object.entries(this.queue.dirtyTables || {}).forEach(([table, dirty]) => {
      if (!dirty) return;
      this.generation += 1;
      this.tableGenerations.set(table, this.generation);
    });
  }

  _createReceipt() {
    const upserts = {};
    Object.entries(this.queue.upserts || {}).forEach(([table, records]) => {
      Object.keys(records || {}).forEach((id) => {
        const generation = this.recordGenerations.get(recordKey("upsert", table, id));
        if (generation === undefined) return;
        if (!upserts[table]) upserts[table] = {};
        upserts[table][id] = generation;
      });
    });
    const deletes = {};
    (this.queue.deletes || []).forEach((item) => {
      const key = recordKey("delete", item.table, item.id);
      const generation = this.recordGenerations.get(key);
      if (generation !== undefined) deletes[key] = generation;
    });
    const dirtyTables = {};
    Object.entries(this.queue.dirtyTables || {}).forEach(([table, dirty]) => {
      if (!dirty) return;
      const generation = this.tableGenerations.get(table);
      if (generation !== undefined) dirtyTables[table] = generation;
    });
    return {
      id: `${this.queue.clientMutationId}:${this.queue.revision}`,
      clientMutationId: this.queue.clientMutationId,
      revision: this.queue.revision,
      upserts,
      deletes,
      dirtyTables,
    };
  }

  _persist() {
    if (!mutationQueueHasChanges(this.queue)) {
      this.queue = createEmptyMutationQueue(this.getBaseSyncVersion(), this.createId());
      this.localDeletions = [];
      this.recordGenerations.clear();
      this.tableGenerations.clear();
      this.store.persist(null, []);
      this._notify();
      return;
    }
    this.store.persist(this.queue, this.localDeletions);
    this._notify();
  }

  _clear() {
    this.queue = createEmptyMutationQueue(this.getBaseSyncVersion(), this.createId());
    this.localDeletions = [];
    this.recordGenerations.clear();
    this.tableGenerations.clear();
    this.store.persist(null, []);
    this._notify();
  }

  _notify() {
    if (!this.onChange) return;
    const upserts = Object.values(this.queue.upserts || {}).reduce(
      (total, records) => total + Object.keys(records || {}).length,
      0
    );
    const deletions = Array.isArray(this.queue.deletes) ? this.queue.deletes.length : 0;
    this.onChange({ upserts, deletions, pendingCount: upserts + deletions });
  }
}
