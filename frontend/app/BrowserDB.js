/* IndexedDB adapter. Domain state and mutation policy stay outside this module. */
export class BrowserDBError extends Error {
  constructor(code, message, { cause = null, operation = "", store = "" } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "BrowserDBError";
    this.code = code;
    this.operation = operation;
    this.store = store;
  }
}

function browserDBError(error, { operation, store = "", fallbackCode = "OPERATION_FAILED" }) {
  if (error instanceof BrowserDBError) return error;
  const name = String(error?.name || "");
  const code = name === "QuotaExceededError"
    ? "QUOTA_EXCEEDED"
    : name === "SecurityError"
      ? "PERMISSION_DENIED"
      : ["DataError", "VersionError", "ConstraintError"].includes(name)
        ? "CORRUPTED_OR_INCOMPATIBLE"
        : fallbackCode;
  return new BrowserDBError(
    code,
    `IndexedDB ${operation} failed${store ? ` for ${store}` : ""}`,
    { cause: error instanceof Error ? error : null, operation, store },
  );
}

export class BrowserDB {
  constructor(dbName = "BiddingFlowDB") {
    this.dbName = dbName;
    this.db = null;
    this.stores = [
      "chudautu",
      "nhathau",
      "chuyengia",
      "kehoach",
      "goithau",
      "goithauhanghoa",
      "hanghoaduthaunhathau",
      "hopdong",
      "systempackages",
      "organizations",
      "employees",
      "permissionmatrix",
      "customcontractstatuses",
      "assignments",
      "thongtinmothau",
      "kv_store"
    ];
  }
  init() {
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(this.dbName, 5);
      } catch (error) {
        reject(browserDBError(error, { operation: "open" }));
        return;
      }
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
        this.db.onversionchange = () => this.close();
        resolve(this);
      };
      request.onerror = (e) => {
        reject(browserDBError(e.target.error, { operation: "open" }));
      };
      request.onblocked = () => reject(new BrowserDBError(
        "MIGRATION_BLOCKED",
        "IndexedDB upgrade is blocked by another open tab",
        { operation: "open" },
      ));
    });
  }
  get(key) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new BrowserDBError(
        "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "get", store: "kv_store" },
      ));
      try {
        const transaction = this.db.transaction("kv_store", "readonly");
        const store = transaction.objectStore("kv_store");
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(browserDBError(request.error, {
          operation: "get", store: "kv_store",
        }));
      } catch (e) {
        reject(browserDBError(e, { operation: "get", store: "kv_store" }));
      }
    });
  }
  set(key, value) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new BrowserDBError(
        "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "set", store: "kv_store" },
      ));
      try {
        const transaction = this.db.transaction("kv_store", "readwrite");
        const store = transaction.objectStore("kv_store");
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(browserDBError(request.error, {
          operation: "set", store: "kv_store",
        }));
      } catch (e) {
        reject(browserDBError(e, { operation: "set", store: "kv_store" }));
      }
    });
  }
  getTableData(tableName) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new BrowserDBError(
        "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "read", store: tableName },
      ));
      if (!this.db.objectStoreNames.contains(tableName)) return reject(new BrowserDBError(
        "STORE_NOT_FOUND", `IndexedDB store does not exist: ${tableName}`, { operation: "read", store: tableName },
      ));
      try {
        const transaction = this.db.transaction(tableName, "readonly");
        const store = transaction.objectStore(tableName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(browserDBError(request.error, {
          operation: "read", store: tableName,
        }));
      } catch (e) {
        reject(browserDBError(e, { operation: "read", store: tableName }));
      }
    });
  }
  countTableData(tableName) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new BrowserDBError(
        "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "count", store: tableName },
      ));
      if (!this.db.objectStoreNames.contains(tableName)) return reject(new BrowserDBError(
        "STORE_NOT_FOUND", `IndexedDB store does not exist: ${tableName}`, { operation: "count", store: tableName },
      ));
      try {
        const transaction = this.db.transaction(tableName, "readonly");
        const store = transaction.objectStore(tableName);
        const request = store.count();
        request.onsuccess = () => resolve(request.result || 0);
        request.onerror = () => reject(browserDBError(request.error, {
          operation: "count", store: tableName,
        }));
      } catch (e) {
        reject(browserDBError(e, { operation: "count", store: tableName }));
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
      if (!this.db) return reject(new BrowserDBError(
        "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "replace", store: tableName },
      ));
      if (!this.db.objectStoreNames.contains(tableName)) return reject(new BrowserDBError(
        "STORE_NOT_FOUND", `IndexedDB store does not exist: ${tableName}`, { operation: "replace", store: tableName },
      ));
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
        transaction.onerror = (e) => reject(browserDBError(e.target.error, {
          operation: "replace", store: tableName,
        }));
      } catch (e) {
        reject(browserDBError(e, { operation: "replace", store: tableName }));
      }
    });
  }
  putRecord(tableName, record) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new BrowserDBError(
        "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "put", store: tableName },
      ));
      if (!this.db.objectStoreNames.contains(tableName)) return reject(new BrowserDBError(
        "STORE_NOT_FOUND", `IndexedDB store does not exist: ${tableName}`, { operation: "put", store: tableName },
      ));
      try {
        const transaction = this.db.transaction(tableName, "readwrite");
        const store = transaction.objectStore(tableName);
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(browserDBError(request.error, {
          operation: "put", store: tableName,
        }));
      } catch (e) {
        reject(browserDBError(e, { operation: "put", store: tableName }));
      }
    });
  }
  deleteRecord(tableName, recordId) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new BrowserDBError(
        "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "delete", store: tableName },
      ));
      if (!this.db.objectStoreNames.contains(tableName)) return reject(new BrowserDBError(
        "STORE_NOT_FOUND", `IndexedDB store does not exist: ${tableName}`, { operation: "delete", store: tableName },
      ));
      try {
        const transaction = this.db.transaction(tableName, "readwrite");
        const store = transaction.objectStore(tableName);
        const request = store.delete(recordId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(browserDBError(request.error, {
          operation: "delete", store: tableName,
        }));
      } catch (e) {
        reject(browserDBError(e, { operation: "delete", store: tableName }));
      }
    });
  }
  putRecords(tableName, dataArray) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new BrowserDBError(
        "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "put-many", store: tableName },
      ));
      if (!this.db.objectStoreNames.contains(tableName)) return reject(new BrowserDBError(
        "STORE_NOT_FOUND", `IndexedDB store does not exist: ${tableName}`, { operation: "put-many", store: tableName },
      ));
      try {
        const transaction = this.db.transaction(tableName, "readwrite");
        const store = transaction.objectStore(tableName);
        (dataArray || []).forEach((item) => {
          store.put(item);
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(browserDBError(e.target.error, {
          operation: "put-many", store: tableName,
        }));
      } catch (e) {
        reject(browserDBError(e, { operation: "put-many", store: tableName }));
      }
    });
  }
  deleteRecords(tableName, idsArray) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new BrowserDBError(
        "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "delete-many", store: tableName },
      ));
      if (!this.db.objectStoreNames.contains(tableName)) return reject(new BrowserDBError(
        "STORE_NOT_FOUND", `IndexedDB store does not exist: ${tableName}`, { operation: "delete-many", store: tableName },
      ));
      try {
        const transaction = this.db.transaction(tableName, "readwrite");
        const store = transaction.objectStore(tableName);
        (idsArray || []).forEach((id) => {
          store.delete(id);
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(browserDBError(e.target.error, {
          operation: "delete-many", store: tableName,
        }));
      } catch (e) {
        reject(browserDBError(e, { operation: "delete-many", store: tableName }));
      }
    });
  }
  close() {
    this.db?.close?.();
    this.db = null;
  }
  applySyncChanges({ replacements = {}, upserts = {}, deletions = {} } = {}) {
    const requestedTableNames = Array.from(new Set([
      ...Object.keys(replacements),
      ...Object.keys(upserts),
      ...Object.keys(deletions)
    ]));
    if (!this.db) return Promise.reject(new BrowserDBError(
      "NOT_INITIALIZED", "IndexedDB is not initialized", { operation: "apply-sync" },
    ));
    const missingStore = requestedTableNames.find(
      (name) => !this.db.objectStoreNames.contains(name),
    );
    if (missingStore) return Promise.reject(new BrowserDBError(
      "STORE_NOT_FOUND",
      `IndexedDB store does not exist: ${missingStore}`,
      { operation: "apply-sync", store: missingStore },
    ));
    const tableNames = requestedTableNames;
    if (tableNames.length === 0) return Promise.resolve();
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
        transaction.onerror = () => reject(browserDBError(transaction.error, {
          operation: "apply-sync",
        }));
        transaction.onabort = () => reject(browserDBError(transaction.error, {
          operation: "apply-sync", fallbackCode: "TRANSACTION_ABORTED",
        }));
      } catch (error) {
        reject(browserDBError(error, { operation: "apply-sync" }));
      }
    });
  }
}
