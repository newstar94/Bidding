/* IndexedDB adapter. Domain state and mutation policy stay outside this module. */
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
      const request = indexedDB.open(this.dbName, 3);
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
  close() {
    this.db?.close?.();
    this.db = null;
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
