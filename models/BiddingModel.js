import * as formatters from "/views/utils/formatters.js";
import { normalizeOrganizationName } from "/controllers/main_controller/domUtils.js";
import {
  CLIENT_TABLE_MAP,
  COMMON_FIELD_NAME_OVERRIDES,
  FIELD_MAP_BY_TABLE,
  resolveSchemaTable
} from "/models/schemaContract.js";
import { generateUUID as createUUID } from "/models/idUtils.js";
const STATE_KEY_BY_SERVER_TABLE = Object.fromEntries(
  Object.entries(CLIENT_TABLE_MAP).map(([stateKey, tableName]) => [tableName, stateKey])
);
const SYNCED_STATE_KEYS = /* @__PURE__ */ new Set([
  "chudautu",
  "kehoach",
  "goithau",
  "chuyengia",
  "nhathau",
  "hopdong",
  "assignments",
  "custompaperstatuses",
  "thongtinmothau",
  "permissionmatrix"
]);
const MUTATION_QUEUE_KEY = "bf_mutation_queue";
const LOCAL_DELETIONS_KEY = "bf_local_deletions";
function readLocalJson(key, fallback) {
  if (typeof localStorage === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (e) {
    return fallback;
  }
}
function writeLocalJson(key, value) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}
class BrowserDB {
  constructor(dbName = "BiddingFlowDB") {
    this.dbName = dbName;
    this.db = null;
    this.stores = [
      "chudautu",
      "nhathau",
      "chuyengia",
      "kehoach",
      "goithau",
      "hopdong",
      "systempackages",
      "organizations",
      "employees",
      "permissionmatrix",
      "custompaperstatuses",
      "assignments",
      "thongtinmothau",
      "kv_store"
    ];
  }
  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 2);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        this.stores.forEach((storeName) => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, storeName === "kv_store" ? {} : { keyPath: "id" });
          }
        });
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this);
      };
      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }
  get(key) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(null);
      try {
        const transaction = this.db.transaction("kv_store", "readonly");
        const store = transaction.objectStore("kv_store");
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }
  set(key, value) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject("Database not initialized");
      try {
        const transaction = this.db.transaction("kv_store", "readwrite");
        const store = transaction.objectStore("kv_store");
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  getTableData(tableName) {
    return new Promise((resolve) => {
      if (!this.db || !this.db.objectStoreNames.contains(tableName)) return resolve([]);
      try {
        const transaction = this.db.transaction(tableName, "readonly");
        const store = transaction.objectStore(tableName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }
  countTableData(tableName) {
    return new Promise((resolve) => {
      if (!this.db || !this.db.objectStoreNames.contains(tableName)) return resolve(0);
      try {
        const transaction = this.db.transaction(tableName, "readonly");
        const store = transaction.objectStore(tableName);
        const request = store.count();
        request.onsuccess = () => resolve(request.result || 0);
        request.onerror = () => resolve(0);
      } catch (e) {
        resolve(0);
      }
    });
  }
  async hasAnyTableData(tableNames) {
    const names = Array.isArray(tableNames) ? tableNames : [];
    const counts = await Promise.all(names.map((name) => this.countTableData(name)));
    return counts.some((count) => count > 0);
  }
  putTableData(tableName, dataArray) {
    return new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains(tableName)) return resolve();
      try {
        const transaction = this.db.transaction(tableName, "readwrite");
        const store = transaction.objectStore(tableName);
        const getKeysRequest = store.getAllKeys();
        getKeysRequest.onsuccess = () => {
          const existingKeys = new Set(getKeysRequest.result || []);
          const incomingKeys = new Set((dataArray || []).map((item) => item.id));
          existingKeys.forEach((key) => {
            if (!incomingKeys.has(key)) {
              store.delete(key);
            }
          });
          (dataArray || []).forEach((item) => {
            store.put(item);
          });
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  putRecord(tableName, record) {
    return new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains(tableName)) return resolve();
      try {
        const transaction = this.db.transaction(tableName, "readwrite");
        const store = transaction.objectStore(tableName);
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  deleteRecord(tableName, recordId) {
    return new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains(tableName)) return resolve();
      try {
        const transaction = this.db.transaction(tableName, "readwrite");
        const store = transaction.objectStore(tableName);
        const request = store.delete(recordId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  putRecords(tableName, dataArray) {
    return new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains(tableName)) return resolve();
      try {
        const transaction = this.db.transaction(tableName, "readwrite");
        const store = transaction.objectStore(tableName);
        (dataArray || []).forEach((item) => {
          store.put(item);
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  deleteRecords(tableName, idsArray) {
    return new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains(tableName)) return resolve();
      try {
        const transaction = this.db.transaction(tableName, "readwrite");
        const store = transaction.objectStore(tableName);
        (idsArray || []).forEach((id) => {
          store.delete(id);
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  applySyncChanges({ replacements = {}, upserts = {}, deletions = {} } = {}) {
    const tableNames = Array.from(new Set([
      ...Object.keys(replacements),
      ...Object.keys(upserts),
      ...Object.keys(deletions)
    ])).filter((name) => this.db?.objectStoreNames.contains(name));
    if (!this.db || tableNames.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(tableNames, "readwrite");
        tableNames.forEach((tableName) => {
          const store = transaction.objectStore(tableName);
          if (Object.prototype.hasOwnProperty.call(replacements, tableName)) {
            store.clear();
            (replacements[tableName] || []).forEach((item) => store.put(item));
            return;
          }
          (upserts[tableName] || []).forEach((item) => store.put(item));
          (deletions[tableName] || []).forEach((id) => store.delete(id));
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB sync transaction failed"));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB sync transaction aborted"));
      } catch (error) {
        reject(error);
      }
    });
  }
}
const snakeToCamel = (key, type = null) => {
  if (!key || !key.includes("_")) return key;
  const tableName = type ? resolveSchemaTable(type) : null;
  const tableFieldMap = tableName ? FIELD_MAP_BY_TABLE[tableName] : null;
  if (tableFieldMap?.[key]) return tableFieldMap[key];
  if (COMMON_FIELD_NAME_OVERRIDES[key]) return COMMON_FIELD_NAME_OVERRIDES[key];
  return key.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
};
export class BiddingModel {
  constructor() {
    Object.assign(this, formatters);
    this.db = new BrowserDB();
    this.STORAGE_KEYS = {
      CHUDAUTU: "bf_chudautu",
      NHATHAU: "bf_nhathau",
      CHUYENGIA: "bf_chuyengia",
      KEHOACH: "bf_kehoach",
      GOITHAU: "bf_goithau",
      HOPDONG: "bf_hopdong",
      THEME: "bf_dark_mode",
      // New RBAC Storage Keys
      ACTIVEROLE: "bf_active_role",
      ACTIVEUSER: "bf_active_user",
      ORGANIZATIONS: "bf_organizations",
      EMPLOYEES: "bf_employees",
      PERMISSIONMATRIX: "bf_permission_matrix",
      CUSTOMPAPERSTATUSES: "bf_custom_paper_statuses",
      ASSIGNMENTS: "bf_assignments",
      SYSTEMPACKAGES: "bf_system_packages",
      THONGTINMOTHAU: "bf_thong_tin_mo_thau"
    };
    this.state = {
      chudautu: [],
      nhathau: [],
      chuyengia: [],
      kehoach: [],
      goithau: [],
      hopdong: [],
      systempackages: [],
      selectedPlanVersion: {},
      selectedPackageVersion: {},
      // Explicitly define RBAC and dynamic keys to ensure proper serialization and sync
      organizations: [],
      employees: [],
      permissionmatrix: [],
      custompaperstatuses: [],
      assignments: [],
      thongtinmothau: []
    };
    this.sortState = {
      kehoach: { field: "maKeHoach", order: "asc" },
      goithau: { field: "maGoiThau", order: "asc" },
      chudautu: { field: "tenChuDauTu", order: "asc" },
      nhathau: { field: "tenNhaThau", order: "asc" },
      chuyengia: { field: "hoTen", order: "asc" },
      hopdong: { field: "tenHopDong", order: "asc" }
    };
    const savedPages = (() => {
      try {
        return JSON.parse(sessionStorage.getItem("bf_current_pages") || "{}");
      } catch {
        return {};
      }
    })();
    this.currentPage = {
      kehoach: savedPages.kehoach || 1,
      goithau: savedPages.goithau || 1,
      chudautu: savedPages.chudautu || 1,
      nhathau: savedPages.nhathau || 1,
      chuyengia: savedPages.chuyengia || 1,
      hopdong: savedPages.hopdong || 1
    };
    this.pageSize = 10;
    this._loadedStorageKeys = /* @__PURE__ */ new Set();
    this._allDataLoadPromise = null;
    this._hasPersistedWorkspaceData = false;
    this._suspendMutationTracking = 0;
  }
  normalizeRecordKeys(record, type = null) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return record;
    }
    const normalized = {};
    Object.entries(record).forEach(([key, value]) => {
      const canonicalKey = snakeToCamel(key, type);
      if (!(canonicalKey in normalized) || normalized[canonicalKey] === void 0 || normalized[canonicalKey] === null || normalized[canonicalKey] === "") {
        normalized[canonicalKey] = value;
      }
    });
    if (type === "chudautu" && normalized.tenChuDauTu) {
      normalized.tenChuDauTu = normalizeOrganizationName(normalized.tenChuDauTu);
    } else if (type === "nhathau" && normalized.tenNhaThau) {
      normalized.tenNhaThau = normalizeOrganizationName(normalized.tenNhaThau);
    }
    return normalized;
  }
  normalizeRecords(type, records) {
    if (!Array.isArray(records)) return records;
    const normalized = records.map((record) => this.normalizeRecordKeys(record, type));
    this.state[type] = normalized;
    return normalized;
  }
  /** Lưu trang hiện tại vào sessionStorage để F5 không mất trang */
  savePage(table) {
    try {
      const pages = JSON.parse(sessionStorage.getItem("bf_current_pages") || "{}");
      pages[table] = this.currentPage[table] || 1;
      sessionStorage.setItem("bf_current_pages", JSON.stringify(pages));
    } catch (e) {
    }
  }
  async loadStorageKeys(keysToLoad) {
    const requested = new Set(keysToLoad || Object.keys(this.STORAGE_KEYS));
    const loadPromises = Object.keys(this.STORAGE_KEYS).map(async (key) => {
      if (!requested.has(key) || this._loadedStorageKeys.has(key)) return;
      if (key === "THEME" || key === "ACTIVEROLE" || key === "ACTIVEUSER") return;
      const lowKey = key.toLowerCase();
      try {
        let stored;
        if (this.db.stores.includes(lowKey)) {
          stored = await this.db.getTableData(lowKey);
        } else {
          stored = await this.db.get(this.STORAGE_KEYS[key]);
        }
        if (stored) {
          this.state[lowKey] = Array.isArray(stored) ? this.normalizeRecords(lowKey, stored) : stored;
        } else {
          this.state[lowKey] = [];
          if (this.db.stores.includes(lowKey)) {
            await this.db.putTableData(lowKey, []);
          } else {
            await this.db.set(this.STORAGE_KEYS[key], []);
          }
        }
      } catch (e) {
        this.state[lowKey] = [];
      } finally {
        this._loadedStorageKeys.add(key);
      }
    });
    await Promise.all(loadPromises);
  }
  ensureAllDataLoaded() {
    if (!this._allDataLoadPromise) {
      this._allDataLoadPromise = this.loadStorageKeys(Object.keys(this.STORAGE_KEYS));
    }
    return this._allDataLoadPromise;
  }
  hydrateRemainingStorageKeysIdle(timeout = 2500) {
    if (this._remainingHydrationScheduled) return;
    this._remainingHydrationScheduled = true;
    const hydrate = () => {
      this.ensureAllDataLoaded().catch((err) => console.error("Failed to hydrate remaining local data:", err)).finally(() => {
        this._remainingHydrationScheduled = false;
      });
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      requestIdleCallback(hydrate, { timeout });
    } else {
      setTimeout(hydrate, Math.min(timeout, 1e3));
    }
  }
  async init(options = {}) {
    const userId = sessionStorage.getItem("bf_user_id");
    if (userId) {
      const cleanUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, "");
      this.db = new BrowserDB(`BiddingFlowDB_${cleanUserId}`);
    } else {
      this.db = new BrowserDB();
    }
    this._loadedStorageKeys = /* @__PURE__ */ new Set();
    this._allDataLoadPromise = null;
    await this.db.init();
    const persistedDataPromise = this.db.hasAnyTableData([
      "kehoach",
      "goithau",
      "chudautu",
      "nhathau",
      "chuyengia",
      "hopdong",
      "thongtinmothau",
      "assignments"
    ]);
    const priorityLoadPromise = this.loadStorageKeys(options.priorityKeys || Object.keys(this.STORAGE_KEYS));
    [this._hasPersistedWorkspaceData] = await Promise.all([persistedDataPromise, priorityLoadPromise]);
    if (!this.state.systempackages) {
      this.state.systempackages = [];
    }
    let storedRole = null;
    let storedUser = null;
    try {
      const localRole = sessionStorage.getItem(this.STORAGE_KEYS.ACTIVEROLE);
      const localUser = sessionStorage.getItem(this.STORAGE_KEYS.ACTIVEUSER);
      if (localRole) storedRole = JSON.parse(localRole);
      if (localUser) storedUser = JSON.parse(localUser);
    } catch (e) {
      console.error("Failed to read active role/user from localStorage:", e);
    }
    if (!storedRole || !storedUser) {
      try {
        storedRole = storedRole || await this.db.get(this.STORAGE_KEYS.ACTIVEROLE);
        storedUser = storedUser || await this.db.get(this.STORAGE_KEYS.ACTIVEUSER);
      } catch (e) {
      }
    }
    try {
      this.state.activerole = BiddingModel.resolveAllowedActiveRole(storedUser, storedRole);
    } catch (e) {
      this.state.activerole = "employee";
    }
    try {
      this.state.activeuser = storedUser || { name: "Khách", title: "Chuyên viên", id: "" };
      this.state.activeuser.title = BiddingModel.getRoleTitle(this.state.activerole);
    } catch (e) {
      this.state.activeuser = { name: "Khách", title: "Chuyên viên", id: "" };
    }
  }
  async trackDeletions(type) {
    try {
      const oldData = await this.db.getTableData(type);
      if (Array.isArray(oldData) && Array.isArray(this.state[type])) {
        const newIds = new Set(this.state[type].map((x) => x.id).filter(Boolean));
        const deletedIds = oldData.map((x) => x.id).filter((id) => id && !newIds.has(id));
        if (deletedIds.length > 0) {
          this.markDeleted(type, deletedIds);
        }
      }
    } catch (e) {
      console.error("Error checking deletions in trackDeletions:", e);
    }
  }
  _isSyncedStateKey(type) {
    return SYNCED_STATE_KEYS.has(type);
  }
  _emptyMutationQueue() {
    return {
      baseSyncVersion: typeof localStorage !== "undefined" ? localStorage.getItem("bf_last_sync_version") || "0" : "0",
      clientMutationId: createUUID(),
      dirtyTables: {},
      upserts: {},
      deletes: [],
      revision: 0
    };
  }
  getMutationQueue() {
    const queue = readLocalJson(MUTATION_QUEUE_KEY, null) || this._emptyMutationQueue();
    queue.baseSyncVersion = queue.baseSyncVersion ?? (typeof localStorage !== "undefined" ? localStorage.getItem("bf_last_sync_version") || "0" : "0");
    queue.clientMutationId = queue.clientMutationId || createUUID();
    queue.dirtyTables = queue.dirtyTables && typeof queue.dirtyTables === "object" ? queue.dirtyTables : {};
    queue.upserts = queue.upserts && typeof queue.upserts === "object" ? queue.upserts : {};
    queue.deletes = Array.isArray(queue.deletes) ? queue.deletes : [];
    queue.revision = Number.isFinite(Number(queue.revision)) ? Number(queue.revision) : 0;
    return queue;
  }
  isRecordPending(type, recordId) {
    if (!type || !recordId) return false;
    const queue = this.getMutationQueue();
    return Object.prototype.hasOwnProperty.call(queue.upserts?.[type] || {}, recordId);
  }
  getPendingLabel(type, recordId) {
    return this.isRecordPending(type, recordId) ? " (Chờ đồng bộ)" : "";
  }
  discardRejectedMutations(errors) {
    const queue = this.getMutationQueue();
    const rejectedByRecord = /* @__PURE__ */ new Map();
    (errors || []).forEach((error) => {
      const type = STATE_KEY_BY_SERVER_TABLE[error?.table] || error?.table;
      const id = String(error?.id || "");
      if (!type || !id) return;
      if (queue.upserts?.[type]?.[id]) {
        delete queue.upserts[type][id];
        if (Object.keys(queue.upserts[type]).length === 0) delete queue.upserts[type];
      }
      const key = `${type}:${id}`;
      const existing = rejectedByRecord.get(key);
      rejectedByRecord.set(key, {
        type,
        id,
        conflictingId: String(error?.conflictingId || existing?.conflictingId || "")
      });
    });
    const rejected = Array.from(rejectedByRecord.values());
    if (rejected.length > 0) {
      queue.clientMutationId = createUUID();
      this._touchMutationQueue(queue);
      this._saveMutationQueue(queue);
    }
    return rejected;
  }
  rebasePendingMutationQueue(syncVersion) {
    if (syncVersion === void 0 || syncVersion === null || syncVersion === "") return;
    const queue = this.getMutationQueue();
    const hasUpserts = Object.values(queue.upserts || {}).some(
      (records) => records && Object.keys(records).length > 0
    );
    const hasDeletes = Array.isArray(queue.deletes) && queue.deletes.length > 0;
    if (!hasUpserts && !hasDeletes) return;
    queue.baseSyncVersion = String(syncVersion);
    queue.clientMutationId = createUUID();
    this._touchMutationQueue(queue);
    this._saveMutationQueue(queue);
  }
  _saveMutationQueue(queue) {
    const hasDirtyTables = Object.keys(queue.dirtyTables || {}).some((key) => queue.dirtyTables[key]);
    const hasUpserts = Object.values(queue.upserts || {}).some((items) => items && Object.keys(items).length > 0);
    const hasDeletes = Array.isArray(queue.deletes) && queue.deletes.length > 0;
    if (!hasDirtyTables && !hasUpserts && !hasDeletes) {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(MUTATION_QUEUE_KEY);
      }
      return;
    }
    writeLocalJson(MUTATION_QUEUE_KEY, queue);
  }
  _touchMutationQueue(queue) {
    queue.revision = (Number(queue.revision) || 0) + 1;
    queue.clientMutationId = queue.clientMutationId || createUUID();
    if (queue.baseSyncVersion === void 0 || queue.baseSyncVersion === null || queue.baseSyncVersion === "") {
      queue.baseSyncVersion = typeof localStorage !== "undefined" ? localStorage.getItem("bf_last_sync_version") || "0" : "0";
    }
  }
  markRecordDirty(type, records) {
    if (this._suspendMutationTracking > 0 || !this._isSyncedStateKey(type)) return;
    const list = Array.isArray(records) ? records : [records];
    const validRecords = list.filter((record) => record && record.id);
    if (validRecords.length === 0) return;
    const queue = this.getMutationQueue();
    if (!queue.upserts[type]) queue.upserts[type] = {};
    validRecords.forEach((record) => {
      queue.upserts[type][record.id] = this.normalizeRecordKeys(record, type);
      queue.deletes = queue.deletes.filter((item) => !(item.table === type && String(item.id) === String(record.id)));
    });
    this._touchMutationQueue(queue);
    this._saveMutationQueue(queue);
  }
  markTableDirty(type) {
    if (this._suspendMutationTracking > 0 || !this._isSyncedStateKey(type)) return;
    const records = Array.isArray(this.state[type]) ? this.state[type].filter((record) => record && record.id).map((record) => this.normalizeRecordKeys(record, type)) : [];
    if (records.length === 0) return;
    const queue = this.getMutationQueue();
    queue.dirtyTables[type] = false;
    queue.upserts[type] = {};
    const currentIds = /* @__PURE__ */ new Set();
    records.forEach((record) => {
      currentIds.add(String(record.id));
      queue.upserts[type][record.id] = record;
    });
    queue.deletes = queue.deletes.filter((item) => item.table !== type || !currentIds.has(String(item.id)));
    this._touchMutationQueue(queue);
    this._saveMutationQueue(queue);
  }
  markDeleted(type, recordIds) {
    const ids = Array.isArray(recordIds) ? recordIds : [recordIds];
    let localDeletions = readLocalJson(LOCAL_DELETIONS_KEY, []);
    ids.filter(Boolean).forEach((id) => {
      if (!localDeletions.some((d) => d.id === id && d.table === type)) {
        localDeletions.push({ table: type, id });
      }
    });
    writeLocalJson(LOCAL_DELETIONS_KEY, localDeletions);
    if (this._suspendMutationTracking > 0 || !this._isSyncedStateKey(type)) return;
    const queue = this.getMutationQueue();
    ids.filter(Boolean).forEach((id) => {
      if (queue.upserts[type]) {
        delete queue.upserts[type][id];
      }
      if (!queue.deletes.some((d) => d.id === id && d.table === type)) {
        queue.deletes.push({ table: type, id });
      }
    });
    this._touchMutationQueue(queue);
    this._saveMutationQueue(queue);
  }
  buildMutationSyncPayload() {
    const queue = this.getMutationQueue();
    const payload = {
      clientMutationId: queue.clientMutationId,
      baseSyncVersion: queue.baseSyncVersion,
      upserts: {},
      deletions: []
    };
    const snapshot = JSON.parse(JSON.stringify(queue));
    Object.keys(queue.dirtyTables || {}).forEach((type) => {
      if (!queue.dirtyTables[type] || !this._isSyncedStateKey(type)) return;
      payload[type] = Array.isArray(this.state[type]) ? this.state[type].map((record) => this.normalizeRecordKeys(record, type)) : [];
      payload.upserts[type] = payload[type];
    });
    Object.entries(queue.upserts || {}).forEach(([type, recordsById]) => {
      if (!this._isSyncedStateKey(type) || payload[type]) return;
      const records = Object.values(recordsById || {}).map((record) => this.normalizeRecordKeys(record, type));
      if (records.length > 0) {
        payload[type] = records;
        payload.upserts[type] = records;
      }
    });
    const queuedDeletes = Array.isArray(queue.deletes) ? queue.deletes : [];
    const localDeletions = readLocalJson(LOCAL_DELETIONS_KEY, []);
    const deleteMap = /* @__PURE__ */ new Map();
    [...queuedDeletes, ...localDeletions].forEach((item) => {
      if (!item || !item.table || !item.id) return;
      deleteMap.set(`${item.table}::${item.id}`, { table: item.table, id: item.id });
    });
    payload.deletions = Array.from(deleteMap.values());
    const hasUpserts = Object.keys(payload.upserts).length > 0;
    if (!hasUpserts && payload.deletions.length === 0) {
      return null;
    }
    return { payload, snapshot };
  }
  clearSyncedMutationQueue(snapshot) {
    const current = this.getMutationQueue();
    if (!snapshot || current.clientMutationId === snapshot.clientMutationId && current.revision === snapshot.revision) {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(MUTATION_QUEUE_KEY);
        localStorage.removeItem(LOCAL_DELETIONS_KEY);
      }
      return;
    }
    Object.entries(snapshot.upserts || {}).forEach(([type, recordsById]) => {
      Object.entries(recordsById || {}).forEach(([id, record]) => {
        const currentRecord = current.upserts?.[type]?.[id];
        if (JSON.stringify(currentRecord) === JSON.stringify(record)) {
          delete current.upserts[type][id];
        }
      });
      if (current.upserts?.[type] && Object.keys(current.upserts[type]).length === 0) {
        delete current.upserts[type];
      }
    });
    current.deletes = (current.deletes || []).filter(
      (item) => !(snapshot.deletes || []).some((oldItem) => oldItem.table === item.table && String(oldItem.id) === String(item.id))
    );
    this._saveMutationQueue(current);
    writeLocalJson(LOCAL_DELETIONS_KEY, current.deletes || []);
  }
  suspendMutationTracking(callback) {
    this._suspendMutationTracking += 1;
    try {
      return callback();
    } finally {
      this._suspendMutationTracking = Math.max(0, this._suspendMutationTracking - 1);
    }
  }
  async persistData(type, options = {}) {
    const key = type.toUpperCase();
    if (this.STORAGE_KEYS[key]) {
      if (Array.isArray(this.state[type])) {
        this.normalizeRecords(type, this.state[type]);
      }
      // Queue the current state before the first await. Callers that start an
      // immediate sync must not be able to build a payload without this write.
      if (options.trackMutation !== false) {
        this.markTableDirty(type);
      }
      if (options.trackMutation !== false && this._isSyncedStateKey(type)) {
        await this.trackDeletions(type);
      }
      if (this.db.stores.includes(type)) {
        try {
          await this.db.putTableData(type, this.state[type]);
        } catch (err) {
          console.error("Failed to persist data for type:", type, err);
        }
      } else {
        try {
          await this.db.set(this.STORAGE_KEYS[key], this.state[type]);
        } catch (err) {
          console.error("Failed to persist data for type:", type, err);
        }
      }
    }
  }
  async addRecord(type, record) {
    if (!this.state[type]) {
      this.state[type] = [];
    }
    const normalizedRecord = this.normalizeRecordKeys(record, type);
    this.state[type].push(normalizedRecord);
    if (this.db.stores.includes(type)) {
      await this.db.putRecord(type, normalizedRecord);
    } else {
      this.persistData(type);
    }
    this.markRecordDirty(type, normalizedRecord);
  }
  async updateRecord(type, record) {
    if (!this.state[type]) {
      this.state[type] = [];
    }
    const normalizedRecord = this.normalizeRecordKeys(record, type);
    const index = this.state[type].findIndex((x) => x.id === normalizedRecord.id);
    if (index !== -1) {
      this.state[type][index] = normalizedRecord;
    } else {
      this.state[type].push(normalizedRecord);
    }
    if (this.db.stores.includes(type)) {
      await this.db.putRecord(type, normalizedRecord);
    } else {
      this.persistData(type);
    }
    this.markRecordDirty(type, normalizedRecord);
  }
  async deleteRecord(type, recordId) {
    if (this.state[type]) {
      this.state[type] = this.state[type].filter((x) => x.id !== recordId);
    }
    this.markDeleted(type, recordId);
    if (this.db.stores.includes(type)) {
      await this.db.deleteRecord(type, recordId);
    } else {
      this.persistData(type);
    }
  }
  switchActiveRole(role, userName, userId) {
    const allowedRole = BiddingModel.resolveAllowedActiveRole(this.state.activeuser, role);
    this.state.activerole = allowedRole;
    const title = BiddingModel.getRoleTitle(allowedRole);
    this.state.activeuser = {
      ...this.state.activeuser || {},
      name: userName,
      title,
      id: userId
    };
    sessionStorage.setItem(this.STORAGE_KEYS.ACTIVEROLE, JSON.stringify(this.state.activerole));
    sessionStorage.setItem(this.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.state.activeuser));
  }
  clearSessionData() {
    Object.keys(this.STORAGE_KEYS).forEach((key) => {
      if (key !== "THEME") {
        localStorage.removeItem(this.STORAGE_KEYS[key]);
        sessionStorage.removeItem(this.STORAGE_KEYS[key]);
      }
    });
    sessionStorage.removeItem("bf_session_token");
    sessionStorage.removeItem("bf_username");
    sessionStorage.removeItem("bf_user_id");
    localStorage.removeItem("bf_remember_me");
    localStorage.removeItem("bf_session_token");
    localStorage.removeItem("bf_username");
    localStorage.removeItem("bf_user_id");
    Object.keys(this.state).forEach((key) => {
      if (Array.isArray(this.state[key])) {
        this.state[key] = [];
      } else if (typeof this.state[key] === "object" && this.state[key] !== null) {
        this.state[key] = {};
      }
    });
    this.state.activerole = null;
    this.state.activeuser = null;
  }
  // ==========================================
  // ROLE HIERARCHY HELPERS
  // ==========================================
  static ROLE_HIERARCHY = {
    super_admin: ["super_admin", "manager", "employee"],
    manager: ["manager", "employee"],
    employee: ["employee"]
  };
  static getRoleTitle(role) {
    if (role === "super_admin") return "Super Admin";
    if (role === "manager") return "Quản lý";
    return "Chuyên viên";
  }
  static resolveAllowedActiveRole(user, requestedRole = null) {
    const rolesFromServer = Array.isArray(user?.dbRoles) ? user.dbRoles : [];
    const roleSource = rolesFromServer.length > 0 ? rolesFromServer.join(",") : user?.dbRole || user?.role || "";
    if (!roleSource) {
      return user && requestedRole && BiddingModel.ROLE_HIERARCHY[requestedRole] ? requestedRole : "employee";
    }
    const allowedRoles = new Set(BiddingModel.getEffectiveRoles(roleSource));
    if (allowedRoles.size === 0) {
      allowedRoles.add("employee");
    }
    if (requestedRole && allowedRoles.has(requestedRole)) {
      return requestedRole;
    }
    if (allowedRoles.has("super_admin")) return "super_admin";
    if (allowedRoles.has("manager")) return "manager";
    return "employee";
  }
  /**
   * Kiểm tra xem user (dựa vào cỗt role) có role yêu cầu hay không (kể cả kế thừa).
   * @param {Object|string} userOrRoleStr - Object user có thuộc tính .role, hoặc chuỗi role trực tiếp
   * @param {string} requiredRole - Role cần kiểm tra
   */
  hasEffectiveRole(userOrRoleStr, requiredRole) {
    const roleStr = typeof userOrRoleStr === "string" ? userOrRoleStr : userOrRoleStr && userOrRoleStr.role ? userOrRoleStr.role : "";
    const roles = roleStr.split(",").map((r) => r.trim()).filter(Boolean);
    const effective = new Set(
      roles.flatMap((r) => BiddingModel.ROLE_HIERARCHY[r] || [r])
    );
    return effective.has(requiredRole);
  }
  /**
   * Kiểm tra xem active role hiện tại có chứa requiredRole hay không.
   * @param {string} requiredRole
   */
  hasActiveEffectiveRole(requiredRole) {
    return this.hasEffectiveRole(this.state.activerole, requiredRole);
  }
  /**
   * Lấy danh sách tất cả role hữu hiệu từ chuỗi role của user.
   * @param {string} roleStr
   * @returns {Set<string>}
   */
  static getEffectiveRoles(roleStr) {
    const roles = (roleStr || "").split(",").map((r) => r.trim()).filter(Boolean);
    const effective = new Set(
      roles.flatMap((r) => BiddingModel.ROLE_HIERARCHY[r] || [r])
    );
    return effective;
  }
  hasPermission(empId, moduleName, permissionType) {
    if (this.hasActiveEffectiveRole("manager")) {
      return true;
    }
    const matrix = this.state.permissionmatrix.find((m) => m.empId === empId);
    if (!matrix) return false;
    const perm = matrix[moduleName];
    if (!perm) return false;
    if (permissionType === "edit") {
      return perm === "edit";
    }
    return perm === "view" || perm === "edit";
  }
  isAssigned(empId, targetId, type) {
    if (this.hasActiveEffectiveRole("manager")) {
      return true;
    }
    const cleanEmpId = String(empId).replace(/^(emp-|user-|sa-|mgr-)+/, "");
    const cleanTargetId = String(targetId).replace(/^(gt-|hd-)+/, "");
    return this.state.assignments.some(
      (a) => String(a.empId).replace(/^(emp-|user-|sa-|mgr-)+/, "") === cleanEmpId && String(a.targetId).replace(/^(gt-|hd-)+/, "") === cleanTargetId && a.type === type
    );
  }
  // Filter plans, packages, contracts for the active employee
  getFilteredKeHoach() {
    const allPlans = this.getLatestPlans();
    if (this.hasActiveEffectiveRole("manager")) {
      return allPlans;
    }
    const empId = this.state.activeuser?.id;
    if (!empId) {
      return [];
    }
    const cleanEmpId = String(empId).replace(/^(emp-|user-|sa-|mgr-)+/, "");
    const assignedPlanIds = this.state.assignments.filter((a) => String(a.empId).replace(/^(emp-|user-|sa-|mgr-)+/, "") === cleanEmpId && a.type === "kehoach").map((a) => String(a.targetId).replace(/^(gt-|hd-)+/, ""));
    const assignedPackages = this.state.assignments.filter((a) => String(a.empId).replace(/^(emp-|user-|sa-|mgr-)+/, "") === cleanEmpId && a.type === "goithau").map((a) => String(a.targetId).replace(/^(gt-|hd-)+/, ""));
    return allPlans.filter((kh) => {
      const isPlanAssigned = assignedPlanIds.includes(String(kh.id).replace(/^(gt-|hd-)+/, ""));
      if (isPlanAssigned) return true;
      const planPackages = this.state.goithau.filter((gt) => gt.keHoachId === kh.id);
      return planPackages.some((gt) => assignedPackages.includes(String(gt.id).replace(/^(gt-|hd-)+/, "")));
    });
  }
  getFilteredGoiThau() {
    const allPackages = this.getLatestPackages();
    if (this.hasActiveEffectiveRole("manager")) {
      return allPackages;
    }
    const empId = this.state.activeuser?.id;
    if (!empId) {
      return [];
    }
    return allPackages.filter((gt) => this.isAssigned(empId, gt.id, "goithau"));
  }
  getFilteredHopDong() {
    const allContracts = this.state.hopdong || [];
    if (this.hasActiveEffectiveRole("manager")) {
      return allContracts;
    }
    const empId = this.state.activeuser?.id;
    if (!empId) {
      return [];
    }
    return allContracts.filter((hd) => this.isAssigned(empId, hd.id, "hopdong"));
  }
  // --- Format Utilities imported from /views/utils/formatters.js ---
  getLatestPlans() {
    const latestMap = {};
    (this.state.kehoach || []).forEach((kh) => {
      const root = kh.rootId || kh.id;
      const verNum = parseInt(kh.phienBan) || 0;
      const isLatest = kh.isLatest == 1;
      if (!latestMap[root]) {
        latestMap[root] = kh;
      } else {
        const existingVer = parseInt(latestMap[root].phienBan) || 0;
        const existingLatest = latestMap[root].isLatest == 1;
        if (isLatest && !existingLatest) {
          latestMap[root] = kh;
        } else if (verNum > existingVer) {
          latestMap[root] = kh;
        }
      }
    });
    return Object.values(latestMap);
  }
  getLatestPackages() {
    const rootMap = {};
    (this.state.goithau || []).forEach((gt) => {
      const root = gt.rootId || gt.id;
      if (!rootMap[root]) rootMap[root] = [];
      rootMap[root].push(gt);
    });
    const result = [];
    Object.values(rootMap).forEach((candidates) => {
      const maxVer = Math.max(...candidates.map((g) => parseInt(g.phienBan) || 0));
      const topVersionCandidates = candidates.filter((g) => (parseInt(g.phienBan) || 0) === maxVer);
      let best = topVersionCandidates[0];
      if (topVersionCandidates.length > 1) {
        let maxPlanVer = -1;
        topVersionCandidates.forEach((c) => {
          const plan = (this.state.kehoach || []).find((k) => k.id === c.keHoachId);
          if (plan) {
            const ver = parseInt(plan.phienBan) || 0;
            if (ver > maxPlanVer) {
              maxPlanVer = ver;
              best = c;
            }
          }
        });
      }
      if (best) result.push(best);
    });
    return result;
  }
  getLatestPackagesForPlan(planId) {
    if (!planId) return [];
    const rootMap = {};
    (this.state.goithau || []).filter((gt) => String(gt.keHoachId) === String(planId)).forEach((gt) => {
      const root = gt.rootId || gt.id;
      if (!rootMap[root]) rootMap[root] = [];
      rootMap[root].push(gt);
    });
    return Object.values(rootMap).map((candidates) => {
      const explicitLatest = candidates.find((g) => g.isLatest == 1);
      if (explicitLatest) return explicitLatest;
      return candidates.reduce((best, current) => {
        const currentVer = parseInt(current.phienBan || 0);
        const bestVer = parseInt(best.phienBan || 0);
        return currentVer > bestVer ? current : best;
      }, candidates[0]);
    }).filter(Boolean);
  }
  formatCurrency(value) {
    if (value === null || value === void 0 || value === "") return "--";
    const num = Number(value);
    if (isNaN(num)) return value;
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  }
  getLatestChuDauTu() {
    const chudautuList = Array.isArray(this.state.chudautu) ? this.state.chudautu : [];
    const latestMap = {};
    chudautuList.forEach((c) => {
      const root = c.rootId || c.id;
      const verNum = parseInt(c.phienBan) || 0;
      const isLatest = c.isLatest == 1;
      if (!latestMap[root]) {
        latestMap[root] = c;
      } else {
        const existingVer = parseInt(latestMap[root].phienBan) || 0;
        const existingLatest = latestMap[root].isLatest == 1;
        if (isLatest && !existingLatest) {
          latestMap[root] = c;
        } else if (verNum > existingVer) {
          latestMap[root] = c;
        }
      }
    });
    return Object.values(latestMap);
  }
  getLatestNhaThau() {
    const nhathauList = Array.isArray(this.state.nhathau) ? this.state.nhathau : [];
    const latestMap = {};
    nhathauList.forEach((n) => {
      const root = n.rootId || n.id;
      const verNum = parseInt(n.phienBan) || 0;
      const isLatest = n.isLatest == 1;
      if (!latestMap[root]) {
        latestMap[root] = n;
      } else {
        const existingVer = parseInt(latestMap[root].phienBan) || 0;
        const existingLatest = latestMap[root].isLatest == 1;
        if (isLatest && !existingLatest) {
          latestMap[root] = n;
        } else if (verNum > existingVer) {
          latestMap[root] = n;
        }
      }
    });
    return Object.values(latestMap);
  }
  getLatestChuyenGia() {
    const chuyengiaList = Array.isArray(this.state.chuyengia) ? this.state.chuyengia : [];
    const latestMap = {};
    chuyengiaList.forEach((c) => {
      const root = c.rootId || c.id;
      const verNum = parseInt(c.phienBan) || 0;
      const isLatest = c.isLatest == 1;
      if (!latestMap[root]) {
        latestMap[root] = c;
      } else {
        const existingVer = parseInt(latestMap[root].phienBan) || 0;
        const existingLatest = latestMap[root].isLatest == 1;
        if (isLatest && !existingLatest) {
          latestMap[root] = c;
        } else if (verNum > existingVer) {
          latestMap[root] = c;
        }
      }
    });
    return Object.values(latestMap);
  }
  getLatestHopDong() {
    const latestPkgs = this.getLatestPackages();
    const latestPkgIds = latestPkgs.map((g) => g.id);
    const allContracts = this.getFilteredHopDong();
    const validContracts = allContracts.filter((hd) => {
      let linkedIds = [];
      if (hd.goiThauId) {
        linkedIds.push(hd.goiThauId);
      }
      if (hd.goiThauIds) {
        if (Array.isArray(hd.goiThauIds)) {
          linkedIds.push(...hd.goiThauIds);
        } else if (typeof hd.goiThauIds === "string") {
          try {
            const parsed = JSON.parse(hd.goiThauIds);
            if (Array.isArray(parsed)) {
              linkedIds.push(...parsed);
            } else {
              linkedIds.push(hd.goiThauIds);
            }
          } catch (e) {
            linkedIds.push(...hd.goiThauIds.split(",").map((s) => s.trim()));
          }
        }
      }
      linkedIds = linkedIds.filter(Boolean);
      if (linkedIds.length === 0) return true;
      return linkedIds.some((id) => {
        const pkg = (this.state.goithau || []).find((g) => g.id === id);
        if (!pkg) return false;
        const root = pkg.rootId || pkg.id;
        return latestPkgs.some((g) => g.rootId === root || g.id === root);
      });
    });
    const latestMap = {};
    validContracts.forEach((h) => {
      const root = h.rootId || h.id;
      const verNum = parseInt(h.phienBan) || 0;
      const isLatest = h.isLatest == 1;
      if (!latestMap[root]) {
        latestMap[root] = h;
      } else {
        const existingVer = parseInt(latestMap[root].phienBan) || 0;
        const existingLatest = latestMap[root].isLatest == 1;
        if (isLatest && !existingLatest) {
          latestMap[root] = h;
        } else if (verNum > existingVer) {
          latestMap[root] = h;
        }
      }
    });
    return Object.values(latestMap);
  }
  getLatestPlan(planId) {
    if (!planId) return null;
    const plan = (this.state.kehoach || []).find((k) => k.id === planId);
    if (!plan) return null;
    const root = plan.rootId || plan.id;
    const latest = (this.state.kehoach || []).find((k) => (k.rootId === root || k.id === root) && k.isLatest == 1);
    return latest || plan;
  }
  getLatestPackage(packageId) {
    if (!packageId) return null;
    const pkg = (this.state.goithau || []).find((g) => g.id === packageId);
    if (!pkg) return null;
    const root = pkg.rootId || pkg.id;
    const all = (this.state.goithau || []).filter((g) => g.rootId === root || g.id === root);
    if (all.length === 0) return pkg;
    if (all.length === 1) return all[0];
    const maxVer = Math.max(...all.map((g) => parseInt(g.phienBan) || 0));
    const topVersionCandidates = all.filter((g) => (parseInt(g.phienBan) || 0) === maxVer);
    if (topVersionCandidates.length === 1) return topVersionCandidates[0];
    let best = topVersionCandidates[0];
    let maxPlanVer = -1;
    topVersionCandidates.forEach((c) => {
      const plan = (this.state.kehoach || []).find((k) => k.id === c.keHoachId);
      if (plan) {
        const ver = parseInt(plan.phienBan) || 0;
        if (ver > maxPlanVer) {
          maxPlanVer = ver;
          best = c;
        }
      }
    });
    return best;
  }
  getLatestContract(contractId) {
    if (!contractId) return null;
    const hd = (this.state.hopdong || []).find((h) => h.id === contractId);
    if (!hd) return null;
    const root = hd.rootId || hd.id;
    const latest = (this.state.hopdong || []).find((h) => (h.rootId === root || h.id === root) && h.isLatest == 1);
    return latest || hd;
  }
}
