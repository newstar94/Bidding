import * as formatters from "../shared/formatters.js";
import { normalizeOrganizationName } from "./domUtils.js";
import {
  CLIENT_TABLE_MAP,
  COMMON_FIELD_NAME_OVERRIDES,
  FIELD_MAP_BY_TABLE,
  resolveSchemaTable
} from "../documents/schemaRuntime.js";
import { generateUUID as createUUID } from "../shared/idUtils.js";
import { serializeEvaluationMetadata } from "../packages/evaluationMetadata.js";
import { serializeOutboundRecord } from "./outboundSerializer.js";
import { isSyncedStateKey } from "../shared/persistencePolicy.js";
import { TABLE_PAGE_SIZE } from "../shared/TablePagination.js";
import { BrowserDB, BrowserDBError } from "./BrowserDB.js";
import { WorkspaceMutationOutbox } from "./WorkspaceMutationOutbox.js";
import { WorkspaceMutationOutboxStore } from "./WorkspaceMutationOutboxStore.js";
import { removeEntity, upsertEntity } from "./entityStore.js";
import { EntityIndexes } from "./EntityIndexes.js";
import {
  abortWorkspaceRequestMap,
  abortWorkspaceRequests,
} from "./workspaceLease.js";
import {
  ScopedWorkspaceStorage,
  purgeWorkspaceLocalData,
  resolveWorkspaceScope,
  workspaceDatabaseName
} from "./workspaceState.js";
import { clearWorkspaceRenderCaches } from "../shared/workspaceRenderCache.js";
import {
  packageVersionResolutionOptions,
  selectLatestVersion,
  selectLatestVersionsByRoot,
  versionRootId,
} from "../shared/versionResolver.js";
const STATE_KEY_BY_SERVER_TABLE = Object.fromEntries(
  Object.entries(CLIENT_TABLE_MAP).map(([stateKey, tableName]) => [tableName, stateKey])
);
const LEGACY_FIELD_ALIASES_BY_TYPE = Object.freeze({
  kehoach: Object.freeze({
    diadiemQuymo: "diaDiemQuyMo",
    thongtinKhac: "thongTinKhac",
  }),
});
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
      GOITHAUHANGHOA: "bf_goithau_hang_hoa",
      HANGHOADUTHAUNHATHAU: "bf_hang_hoa_du_thau_nha_thau",
      HOPDONG: "bf_hopdong",
      THEME: "bf_dark_mode",
      // New RBAC Storage Keys
      ACTIVEROLE: "bf_active_role",
      ACTIVEUSER: "bf_active_user",
      ORGANIZATIONS: "bf_organizations",
      EMPLOYEES: "bf_employees",
      PERMISSIONMATRIX: "bf_permission_matrix",
      CUSTOMCONTRACTSTATUSES: "bf_custom_contract_statuses",
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
      goithauhanghoa: [],
      hanghoaduthaunhathau: [],
      hopdong: [],
      systempackages: [],
      selectedPlanVersion: {},
      selectedPackageVersion: {},
      // Explicitly define RBAC and dynamic keys to ensure proper serialization and sync
      organizations: [],
      employees: [],
      permissionmatrix: [],
      customcontractstatuses: [],
      assignments: [],
      thongtinmothau: []
    };
    this.entityIndexes = new EntityIndexes((table) => this.state[table]);
    this.sortState = {
      kehoach: { field: "maKeHoach", order: "asc" },
      goithau: { field: "maGoiThau", order: "asc" },
      chudautu: { field: "tenChuDauTu", order: "asc" },
      nhathau: { field: "tenNhaThau", order: "asc" },
      chuyengia: { field: "hoTen", order: "asc" },
      hopdong: { field: "tenHopDong", order: "asc" }
    };
    this.currentPage = {
      kehoach: 1,
      goithau: 1,
      chudautu: 1,
      nhathau: 1,
      chuyengia: 1,
      hopdong: 1
    };
    this.pageSize = TABLE_PAGE_SIZE;
    this._loadedStorageKeys = /* @__PURE__ */ new Set();
    this._storageLoadPromises = /* @__PURE__ */ new Map();
    this._storageReadFailures = /* @__PURE__ */ new Map();
    this._storageHydrationListeners = /* @__PURE__ */ new Set();
    this._allDataLoadPromise = null;
    this._hasPersistedWorkspaceData = false;
    this._suspendMutationTracking = 0;
    this._workspaceWriteLocked = false;
    this.onMutationBatchChanged = null;
    this._mutationOutbox = null;
    this._mutationOutboxStoreRef = null;
    this._mutationOutboxStore = null;
    this._mutationOutboxStoreStorage = null;
    this._mutationOutboxStoreDatabase = null;
    this._workspaceEpoch = 0;
    this._workspaceRequestControllers = new Set();
    this._workspaceMutations = new Set();
    this.workspaceScope = null;
    this.workspaceStorage = null;
    this.workspaceSessionStorage = null;
  }
  normalizeRecordKeys(record, type = null) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return record;
    }
    const normalized = {};
    Object.entries(record).forEach(([key, value]) => {
      const canonicalKey = LEGACY_FIELD_ALIASES_BY_TYPE[type]?.[key] || snakeToCamel(key, type);
      const isCanonicalInput = key === canonicalKey;
      if (isCanonicalInput || !(canonicalKey in normalized) || normalized[canonicalKey] === void 0 || normalized[canonicalKey] === null || normalized[canonicalKey] === "") {
        normalized[canonicalKey] = value;
      }
    });
    if (type === "chudautu" && normalized.tenChuDauTu) {
      normalized.tenChuDauTu = normalizeOrganizationName(normalized.tenChuDauTu);
    } else if (type === "nhathau" && normalized.tenNhaThau) {
      normalized.tenNhaThau = normalizeOrganizationName(normalized.tenNhaThau);
    }
    if (type === "goithau" && normalized.danhGiaHsdtMetadata != null) {
      normalized.danhGiaHsdtMetadata = serializeEvaluationMetadata(normalized.danhGiaHsdtMetadata);
    }
    return normalized;
  }
  normalizeRecords(type, records) {
    if (!Array.isArray(records)) return records;
    const normalized = records.map((record) => this.normalizeRecordKeys(record, type));
    this.state[type] = normalized;
    return normalized;
  }
  replaceTableState(type, records) {
    this.assertStorageTablesWritable(type);
    this.state[type] = Array.isArray(records) ? records : [];
    this.entityIndexes.invalidate(type);
    return this.state[type];
  }
  /** Lưu trang hiện tại vào sessionStorage để F5 không mất trang */
  savePage(table) {
    try {
      const pages = this.workspaceSessionStorage?.readJson("bf_current_pages", {}) || {};
      pages[table] = this.currentPage[table] || 1;
      this.workspaceSessionStorage?.writeJson("bf_current_pages", pages);
    } catch {
    }
  }

  getWorkspaceToken() {
    return this.workspaceScope ? `${this.workspaceScope.key}@${this._workspaceEpoch}` : "";
  }

  isWorkspaceCurrent(token) {
    return !!token && token === this.getWorkspaceToken();
  }

  beginWorkspaceMutation() {
    this._assertWorkspaceWritable();
    let resolveCompletion;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    const mutation = {
      token: this.getWorkspaceToken(),
      scope: this.workspaceScope,
      state: this.state,
      db: this.db,
      storage: this.workspaceStorage,
      outbox: this._getMutationOutbox(),
      completion,
      done: false,
      resolveCompletion,
    };
    this._workspaceMutations.add(mutation);
    return mutation;
  }

  assertWorkspaceMutation(mutation) {
    if (!mutation || mutation.done || !this._workspaceMutations.has(mutation)) {
      const error = new Error("Workspace mutation capability is no longer active");
      error.code = "WORKSPACE_MUTATION_INACTIVE";
      throw error;
    }
    return mutation;
  }

  workspaceMutationUsesCurrentResources(mutation) {
    return Boolean(
      mutation
      && !mutation.done
      && mutation.state === this.state
      && mutation.db === this.db
      && mutation.storage === this.workspaceStorage,
    );
  }

  finishWorkspaceMutation(mutation) {
    if (!mutation || mutation.done) return;
    mutation.done = true;
    this._workspaceMutations.delete(mutation);
    mutation.resolveCompletion?.();
  }

  async waitForWorkspaceMutations() {
    while (this._workspaceMutations.size > 0) {
      await Promise.allSettled(
        [...this._workspaceMutations].map((mutation) => mutation.completion),
      );
    }
  }

  commitWorkspaceMutation(mutation, type, options = {}) {
    const captured = this.assertWorkspaceMutation(mutation);
    this.entityIndexes.invalidate(type);
    if (this._suspendMutationTracking > 0 || !this._isSyncedStateKey(type)) return;
    if (options.deletedIds !== void 0) {
      const values = Array.isArray(options.deletedIds)
        ? options.deletedIds
        : [options.deletedIds];
      const records = values.filter(Boolean).map((value) => (
        typeof value === "object"
          ? value
          : (captured.state[type] || []).find(
            (record) => String(record.id) === String(value),
          ) || { id: value }
      ));
      captured.outbox.enqueue({ kind: "delete", table: type, records });
      return;
    }
    if (options.fullTable) {
      captured.outbox.enqueue({
        kind: "replace-table",
        table: type,
        records: captured.state[type],
      });
      return;
    }
    captured.outbox.enqueue({
      kind: "upsert",
      table: type,
      records: options.records || [],
    });
  }

  beginWorkspaceTransition() {
    if (!this._workspaceWriteLocked) this._workspaceEpoch += 1;
    this._workspaceWriteLocked = true;
    abortWorkspaceRequests(this._workspaceRequestControllers);
  }

  endWorkspaceTransition() {
    this._workspaceWriteLocked = false;
  }

  _assertWorkspaceWritable() {
    if (this._workspaceWriteLocked) {
      throw new Error("Workspace is changing; local writes are temporarily locked");
    }
    if (!this.workspaceScope || !this.workspaceStorage) {
      throw new Error("Workspace state is not initialized");
    }
  }

  _resetWorkspaceMemory() {
    clearWorkspaceRenderCaches(this);
    abortWorkspaceRequests(this._workspaceRequestControllers);
    abortWorkspaceRequestMap(this._paginationRequests);
    abortWorkspaceRequestMap(this._planPackageHydrationRequests);
    this._paginationRequests = new Map();
    this._planPackageHydrationRequests = new Map();
    Object.keys(this.STORAGE_KEYS).forEach((key) => {
      if (["THEME", "ACTIVEROLE", "ACTIVEUSER"].includes(key)) return;
      const stateKey = key.toLowerCase();
      if (Array.isArray(this.state[stateKey])) this.state[stateKey] = [];
    });
    this.dashboardSummary = null;
    this.state.selectedPlanVersion = {};
    this.state.selectedPackageVersion = {};
    this.useServerSidePagination = false;
    this._hasPersistedWorkspaceData = false;
    this._loadedStorageKeys = /* @__PURE__ */ new Set();
    this._storageLoadPromises = /* @__PURE__ */ new Map();
    this._storageReadFailures = /* @__PURE__ */ new Map();
    this._allDataLoadPromise = null;
    this._remainingHydrationScheduled = false;
    this._mutationOutbox = null;
    this._mutationOutboxStoreRef = null;
    this._mutationOutboxStore = null;
    this._mutationOutboxStoreStorage = null;
    this._mutationOutboxStoreDatabase = null;
  }

  async deactivateWorkspace() {
    this.beginWorkspaceTransition();
    await this.waitForWorkspaceMutations();
    this.db?.close?.();
    this._resetWorkspaceMemory();
    this.workspaceScope = null;
    this.workspaceStorage = null;
    this.workspaceSessionStorage = null;
    this._workspaceEpoch += 1;
    this.endWorkspaceTransition();
  }
  async purgeWorkspaceData() {
    const scope = this.workspaceScope;
    if (!scope) return false;
    this.beginWorkspaceTransition();
    await this.waitForWorkspaceMutations();
    this.db?.close?.();
    try {
      await purgeWorkspaceLocalData(scope);
    } finally {
      this._resetWorkspaceMemory();
      this.workspaceScope = null;
      this.workspaceStorage = null;
      this.workspaceSessionStorage = null;
      this._workspaceEpoch += 1;
      this.endWorkspaceTransition();
    }
    return true;
  }
  async loadStorageKeys(keysToLoad) {
    const requested = new Set(keysToLoad || Object.keys(this.STORAGE_KEYS));
    const loadPromises = Object.keys(this.STORAGE_KEYS).map((key) => {
      if (!requested.has(key) || this._loadedStorageKeys.has(key)) return;
      if (key === "THEME" || key === "ACTIVEROLE" || key === "ACTIVEUSER") return;
      const inFlight = this._storageLoadPromises.get(key);
      if (inFlight) return inFlight;
      const workspaceEpoch = this._workspaceEpoch;
      let loadPromise;
      loadPromise = (async () => {
        const lowKey = key.toLowerCase();
        try {
          let stored;
          if (this.db.stores.includes(lowKey)) {
            stored = await this.db.getTableData(lowKey);
          } else {
            stored = await this.db.get(this.STORAGE_KEYS[key]);
          }
          if (this._workspaceEpoch !== workspaceEpoch) return;
          this.state[lowKey] = stored == null
            ? []
            : Array.isArray(stored)
              ? this.normalizeRecords(lowKey, stored)
              : stored;
          const recovered = this._storageReadFailures.delete(lowKey);
          this._loadedStorageKeys.add(key);
          this._notifyStorageHydration({
            code: null,
            recovered,
            state: "ready",
            table: lowKey,
          });
        } catch (error) {
          if (this._workspaceEpoch !== workspaceEpoch) return;
          const failure = this._recordStorageReadFailure(lowKey, error);
          console.error("Failed to read local workspace table", {
            code: failure.code,
            operation: "read",
            table: lowKey,
          });
        }
      })().finally(() => {
        if (this._storageLoadPromises.get(key) === loadPromise) {
          this._storageLoadPromises.delete(key);
        }
      });
      this._storageLoadPromises.set(key, loadPromise);
      return loadPromise;
    });
    await Promise.all(loadPromises);
  }
  _recordStorageReadFailure(table, error) {
    const code = String(error?.code || "OPERATION_FAILED");
    const failure = error instanceof BrowserDBError
      ? error
      : new BrowserDBError(code, `IndexedDB read failed for ${table}`, {
          cause: error instanceof Error ? error : null,
          operation: "read",
          store: table,
        });
    const storageKey = Object.keys(this.STORAGE_KEYS).find(
      (key) => key.toLowerCase() === String(table || "").toLowerCase(),
    );
    if (storageKey) this._loadedStorageKeys.delete(storageKey);
    this._allDataLoadPromise = null;
    this._storageReadFailures.set(table, failure);
    this._notifyStorageHydration({ code, recovered: false, state: "failed", table });
    return failure;
  }
  _notifyStorageHydration(event) {
    this._storageHydrationListeners.forEach((listener) => {
      try {
        listener({ ...event });
      } catch (error) {
        console.error("Storage hydration listener failed", error);
      }
    });
  }
  addStorageHydrationListener(listener) {
    if (typeof listener !== "function") return () => {};
    this._storageHydrationListeners.add(listener);
    return () => this._storageHydrationListeners.delete(listener);
  }
  getStorageHydrationStatus(type) {
    const table = String(type || "").toLowerCase();
    if (table === "mutation_outbox") {
      const status = this.getMutationOutboxStatus();
      return {
        code: status.code,
        recoverable: status.state === "degraded",
        state: status.state === "degraded" ? "failed" : status.state,
        table,
      };
    }
    const failure = this._storageReadFailures.get(table);
    if (failure) {
      return { code: failure.code || "OPERATION_FAILED", recoverable: true, state: "failed", table };
    }
    const storageKey = Object.keys(this.STORAGE_KEYS).find(
      (key) => key.toLowerCase() === table,
    );
    return {
      code: null,
      recoverable: false,
      state: storageKey && this._loadedStorageKeys.has(storageKey) ? "ready" : "pending",
      table,
    };
  }
  getStorageReadFailures() {
    return Array.from(this._storageReadFailures.entries()).map(([table, error]) => ({
      code: error?.code || "OPERATION_FAILED",
      recoverable: true,
      state: "failed",
      table,
    }));
  }
  hasStorageReadFailures() {
    return this._storageReadFailures.size > 0 || this.hasMutationOutboxDurabilityFailure();
  }
  assertStorageTablesWritable(types) {
    const requestedTypes = Array.isArray(types) ? types : [types];
    if (
      requestedTypes.some((type) => this._isSyncedStateKey(String(type || "").toLowerCase()))
      && this.hasMutationOutboxDurabilityFailure()
    ) {
      throw this.getMutationOutboxFailure();
    }
    for (const type of requestedTypes) {
      const table = String(type || "").toLowerCase();
      const failure = this._storageReadFailures.get(table);
      if (failure) throw failure;
    }
  }
  markStorageTablesRecovered(types) {
    for (const type of types || []) {
      const table = String(type || "").toLowerCase();
      if (!this._storageReadFailures.delete(table)) continue;
      const storageKey = Object.keys(this.STORAGE_KEYS).find(
        (key) => key.toLowerCase() === table,
      );
      if (storageKey) this._loadedStorageKeys.add(storageKey);
      this._notifyStorageHydration({ code: null, recovered: true, state: "ready", table });
    }
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
    const nextScope = resolveWorkspaceScope({
      userId: options.userId,
      organizationId: options.organizationId
    });
    const changedWorkspace = this.workspaceScope?.key !== nextScope.key;
    const ownsWorkspaceTransition = changedWorkspace && !this._workspaceWriteLocked;
    if (ownsWorkspaceTransition) this.beginWorkspaceTransition();
    try {
    if (changedWorkspace) {
      await this.waitForWorkspaceMutations();
      this.db?.close?.();
      this._resetWorkspaceMemory();
      this.workspaceScope = nextScope;
      this.workspaceStorage = new ScopedWorkspaceStorage(nextScope, localStorage);
      this.workspaceSessionStorage = new ScopedWorkspaceStorage(nextScope, sessionStorage);
      this.db = new BrowserDB(workspaceDatabaseName(nextScope));
      this._workspaceEpoch += 1;
    }
    await this.db.init();
    await this.hydrateMutationOutbox();
    const savedPages = this.workspaceSessionStorage.readJson("bf_current_pages", {});
    Object.keys(this.currentPage).forEach((key) => {
      this.currentPage[key] = savedPages[key] || 1;
    });
    const persistedDataPromise = this.db.hasAnyTableData([
      "kehoach",
      "goithau",
      "goithauhanghoa",
      "hanghoaduthaunhathau",
      "chudautu",
      "nhathau",
      "chuyengia",
      "hopdong",
      "thongtinmothau",
      "assignments"
    ]).catch((error) => {
      console.error("Failed to inspect local workspace availability", {
        code: error?.code || "OPERATION_FAILED",
        operation: error?.operation || "count",
      });
      return null;
    });
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
      } catch {
      }
    }
    try {
      this.state.activerole = BiddingModel.resolveAllowedActiveRole(storedUser, storedRole);
    } catch {
      this.state.activerole = "employee";
    }
    try {
      this.state.activeuser = storedUser || { name: "Khách", title: "Chuyên viên", id: "" };
      this.state.activeuser.title = BiddingModel.getRoleTitle(this.state.activerole);
    } catch {
      this.state.activeuser = { name: "Khách", title: "Chuyên viên", id: "" };
    }
    } finally {
      if (ownsWorkspaceTransition) this.endWorkspaceTransition();
    }
  }
  async trackDeletions(type, workspaceMutation = null) {
    const canCoordinate = typeof this.beginWorkspaceMutation === "function";
    const ownsMutation = !workspaceMutation && canCoordinate;
    const mutation = workspaceMutation
      || (canCoordinate ? this.beginWorkspaceMutation() : null);
    if (mutation) this.assertWorkspaceMutation(mutation);
    const database = mutation?.db || this.db;
    const state = mutation?.state || this.state;
    try {
    this.assertStorageTablesWritable?.(type);
    let oldData;
    try {
      oldData = await database.getTableData(type);
    } catch (error) {
      const failure = this._recordStorageReadFailure(type, error);
      console.error("Failed to read local workspace table before persistence", {
        code: failure.code,
        operation: "read",
        table: type,
      });
      throw failure;
    }
    if (Array.isArray(oldData) && Array.isArray(state[type])) {
      const oldById = new Map(oldData.filter((record) => record?.id).map((record) => [String(record.id), record]));
      const changedRecords = state[type].filter((record) => {
        if (!record?.id) return false;
        const previous = oldById.get(String(record.id));
        return !previous || JSON.stringify(previous) !== JSON.stringify(record);
      });
      if (changedRecords.length > 0) {
        if (mutation) {
          this.commitWorkspaceMutation(mutation, type, { records: changedRecords });
        } else {
          await this.markRecordDirty(type, changedRecords);
        }
      }
      const newIds = new Set(state[type].map((x) => x.id).filter(Boolean));
      const deletedRecords = oldData.filter((record) => record?.id && !newIds.has(record.id));
      if (deletedRecords.length > 0) {
        if (mutation) {
          this.commitWorkspaceMutation(mutation, type, { deletedIds: deletedRecords });
        } else {
          await this.markDeleted(type, deletedRecords);
        }
      }
    }
    } finally {
      if (ownsMutation) this.finishWorkspaceMutation(mutation);
    }
  }
  _isSyncedStateKey(type) {
    return isSyncedStateKey(type);
  }
  getMutationQueue() {
    return this._getMutationOutbox().snapshot();
  }
  _getMutationOutboxStore() {
    if (
      !this._mutationOutboxStore
      || this._mutationOutboxStoreStorage !== this.workspaceStorage
      || this._mutationOutboxStoreDatabase !== this.db
    ) {
      this._mutationOutboxStore = new WorkspaceMutationOutboxStore({
        storage: this.workspaceStorage,
        database: this.db,
        onStatusChange: (status) => this._applyMutationOutboxStatus(status),
      });
      this._mutationOutboxStoreStorage = this.workspaceStorage;
      this._mutationOutboxStoreDatabase = this.db;
      this._mutationOutbox = null;
      this._mutationOutboxStoreRef = null;
    }
    return this._mutationOutboxStore;
  }
  _getMutationOutbox() {
    const store = this._getMutationOutboxStore();
    if (!this._mutationOutbox || this._mutationOutboxStoreRef !== store) {
      this._mutationOutbox = new WorkspaceMutationOutbox({
        store,
        getBaseSyncVersion: () => this.workspaceStorage?.getItem("bf_last_sync_version") || "0",
        createId: createUUID,
        isSyncedType: (type) => this._isSyncedStateKey(type),
        normalizeRecord: (record, type) => this.normalizeRecordKeys(record, type),
        serializeRecord: (record, type) => serializeOutboundRecord(
          record,
          type,
          (value, recordType) => this.normalizeRecordKeys(value, recordType)
        ),
        resolveServerTable: (table) => STATE_KEY_BY_SERVER_TABLE[table] || table,
        onChange: (summary) => this.onMutationBatchChanged?.(summary)
      });
      this._mutationOutboxStoreRef = store;
    }
    return this._mutationOutbox;
  }
  async flushMutationOutbox() {
    await this._getMutationOutbox().flush();
  }
  async hydrateMutationOutbox(options = {}) {
    const snapshot = await this._getMutationOutbox().hydrate(options);
    this._applyMutationOutboxStatus(this._getMutationOutboxStore().getStatus());
    return snapshot;
  }
  async recoverMutationOutbox() {
    await this.hydrateMutationOutbox({ repairCorrupt: true });
    return !this.hasMutationOutboxDurabilityFailure();
  }
  getMutationOutboxStatus() {
    return this._getMutationOutboxStore().getStatus();
  }
  hasMutationOutboxDurabilityFailure() {
    return this.getMutationOutboxStatus().state === "degraded";
  }
  getMutationOutboxFailure() {
    const existing = this._storageReadFailures.get("mutation_outbox");
    if (existing) return existing;
    const error = new Error("Mutation outbox durability is degraded");
    error.code = "OUTBOX_DURABILITY_DEGRADED";
    error.recoverable = true;
    error.status = this.getMutationOutboxStatus();
    return error;
  }
  _applyMutationOutboxStatus(status) {
    if (!status || status.state === "pending") return;
    const table = "mutation_outbox";
    if (status.state === "degraded") {
      const previous = this._storageReadFailures.get(table);
      const error = new Error("Mutation outbox durability is degraded");
      error.code = status.code || "OUTBOX_DURABILITY_DEGRADED";
      error.recoverable = true;
      error.status = { ...status };
      this._storageReadFailures.set(table, error);
      if (!previous || JSON.stringify(previous.status) !== JSON.stringify(error.status)) {
        this._notifyStorageHydration({
          code: error.code,
          recovered: false,
          state: "failed",
          table,
        });
      }
      return;
    }
    const recovered = this._storageReadFailures.delete(table);
    if (recovered) {
      this._notifyStorageHydration({
        code: null,
        recovered: true,
        state: "ready",
        table,
      });
    }
  }
  captureMutationCheckpoint() {
    return this._getMutationOutbox().checkpoint();
  }
  async restoreMutationCheckpoint(checkpoint) {
    const restored = this._getMutationOutbox().restore(checkpoint);
    if (restored) await this._getMutationOutbox().flush();
    return restored;
  }
  discardRejectedMutations(errors, snapshot = null) {
    return this._getMutationOutbox().reject(snapshot, errors);
  }
  acknowledgeServerDeletions(deletionsByTable = {}) {
    return this._getMutationOutbox().enqueue({
      kind: "ack-server-deletions",
      deletionsByTable
    });
  }
  rebaseMutationBatch(syncVersion) {
    return this._getMutationOutbox().enqueue({ kind: "rebase", syncVersion });
  }
  markRecordDirty(type, records) {
    this._assertWorkspaceWritable();
    this.assertStorageTablesWritable(type);
    if (this._suspendMutationTracking > 0 || !this._isSyncedStateKey(type)) return;
    return this._getMutationOutbox().enqueue({
      kind: "upsert",
      table: type,
      records
    });
  }
  markTableDirty(type) {
    this._assertWorkspaceWritable();
    this.assertStorageTablesWritable(type);
    if (this._suspendMutationTracking > 0 || !this._isSyncedStateKey(type)) return;
    return this._getMutationOutbox().enqueue({
      kind: "replace-table",
      table: type,
      records: this.state[type]
    });
  }
  markDeleted(type, recordIds) {
    this._assertWorkspaceWritable();
    this.assertStorageTablesWritable(type);
    if (this._suspendMutationTracking > 0 || !this._isSyncedStateKey(type)) return;
    const values = Array.isArray(recordIds) ? recordIds : [recordIds];
    const records = values.filter(Boolean).map((value) => {
      if (typeof value === "object") return value;
      return (this.state[type] || []).find((record) => String(record.id) === String(value)) || { id: value };
    });
    return this._getMutationOutbox().enqueue({
      kind: "delete",
      table: type,
      records
    });
  }
  commitLocalMutation(type, options = {}) {
    this._assertWorkspaceWritable();
    this.assertStorageTablesWritable(type);
    this.entityIndexes.invalidate(type);
    if (options.deletedIds !== void 0) {
      this.markDeleted(type, options.deletedIds);
      return;
    }
    if (options.fullTable) {
      this.markTableDirty(type);
      return;
    }
    this.markRecordDirty(type, options.records || []);
  }
  buildMutationSyncPayload() {
    return this._getMutationOutbox().snapshotForSync(this.state);
  }
  repairPendingDuplicatePlanVersions() {
    const outbox = this._getMutationOutbox();
    const checkpoint = outbox.checkpoint();
    const stateBefore = {
      kehoach: structuredClone(this.state.kehoach || []),
      goithau: structuredClone(this.state.goithau || []),
      hopdong: structuredClone(this.state.hopdong || []),
      assignments: structuredClone(this.state.assignments || []),
    };
    const repair = outbox.repairDuplicatePlanVersions(this.state);
    if (!repair) return null;

    const upserts = {
      kehoach: repair.authoritativePlans,
      ...repair.repointedRecords,
    };
    const persist = this.db && typeof this.db.applySyncChanges === "function"
      ? this.db.applySyncChanges({
        upserts,
        deletions: { kehoach: repair.duplicatePlanIds },
      })
      : Promise.all(
        [...new Set(["kehoach", ...Object.keys(repair.repointedRecords)])]
          .map((table) => this.persistData(table, { trackMutation: false })),
      );
    return Promise.resolve(persist).catch(async (error) => {
      Object.entries(stateBefore).forEach(([table, records]) => {
        this.state[table] = records;
      });
      outbox.restore(checkpoint);
      try {
        await outbox.flush();
      } catch {
        // Preserve the original persistence error; the outbox store reports
        // its own degraded state separately.
      }
      throw error;
    }).then(async () => {
      await outbox.flush();
      Object.keys(upserts).forEach((table) => this.entityIndexes?.invalidate?.(table));
      return repair;
    });
  }
  async applyCommittedRowVersions(entries = []) {
    const writes = [];
    entries.forEach((entry) => {
      const type = entry?.table;
      const id = String(entry?.id || "");
      const rowVersion = entry?.rowVersion;
      if (!type || !id || !Number.isInteger(rowVersion)) return;
      const record = (this.state[type] || []).find((item) => String(item.id) === id);
      if (record) {
        record.rowVersion = rowVersion;
        if (this.db.stores.includes(type)) writes.push(this.db.putRecord(type, record));
      }
    });
    this._getMutationOutbox().enqueue({ kind: "server-row-version", entries });
    await Promise.all(writes);
  }
  clearCommittedMutationBatch(snapshot) {
    return this._getMutationOutbox().ack(snapshot);
  }
  discardMutationBatch() {
    return this._getMutationOutbox().discard();
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
    const ownsMutation = !options.workspaceMutation;
    const mutation = options.workspaceMutation || this.beginWorkspaceMutation();
    this.assertWorkspaceMutation(mutation);
    try {
    if (options.trackMutation !== false) {
      this.assertStorageTablesWritable(type);
    }
    this.entityIndexes.invalidate(type);
    const key = type.toUpperCase();
    if (this.STORAGE_KEYS[key]) {
      if (Array.isArray(mutation.state[type])) {
        const normalized = mutation.state[type].map(
          (record) => this.normalizeRecordKeys(record, type),
        );
        mutation.state[type] = normalized;
      }
      if (options.trackMutation !== false && this._isSyncedStateKey(type)) {
        await this.trackDeletions(type, mutation);
      }
      if (mutation.db.stores.includes(type)) {
        try {
          await mutation.db.putTableData(type, mutation.state[type]);
        } catch (err) {
          console.error("Failed to persist data for type:", type, err);
          if (options.throwOnError) throw err;
        }
      } else {
        try {
          await mutation.db.set(this.STORAGE_KEYS[key], mutation.state[type]);
        } catch (err) {
          console.error("Failed to persist data for type:", type, err);
          if (options.throwOnError) throw err;
        }
      }
    }
    } finally {
      if (ownsMutation) this.finishWorkspaceMutation(mutation);
    }
  }
  async persistChanges(type, { upserts = [], deletions = [] } = {}, options = {}) {
    const ownsMutation = !options.workspaceMutation;
    const mutation = options.workspaceMutation || this.beginWorkspaceMutation();
    this.assertWorkspaceMutation(mutation);
    try {
    if (options.trackMutation !== false) {
      this.assertStorageTablesWritable(type);
    }
    const records = (Array.isArray(upserts) ? upserts : [upserts])
      .filter((record) => record?.id !== undefined && record?.id !== null)
      .map((record) => this.normalizeRecordKeys(record, type));
    const ids = (Array.isArray(deletions) ? deletions : [deletions])
      .map((value) => value && typeof value === "object" ? value.id : value)
      .filter((value) => value !== undefined && value !== null && String(value) !== "");
    if (!mutation.db.stores.includes(type)) {
      return await this.persistData(type, {
        ...options,
        trackMutation: false,
        workspaceMutation: mutation,
      });
    }
    try {
      if (records.length > 0) await mutation.db.putRecords(type, records);
      if (ids.length > 0) await mutation.db.deleteRecords(type, ids);
    } catch (err) {
      console.error("Failed to persist changes for type:", type, err);
      if (options.throwOnError) throw err;
    }
    } finally {
      if (ownsMutation) this.finishWorkspaceMutation(mutation);
    }
  }
  async _rollbackLegacyRecordMutation({
    mutation,
    type,
    recordId,
    stateSnapshot,
    outboxCheckpoint,
    durableWriteCompleted,
  }, error) {
    const normalizedId = String(recordId);
    const currentRecords = Array.isArray(mutation.state[type])
      ? mutation.state[type]
      : [];
    const previousIndex = stateSnapshot.findIndex(
      (item) => String(item.id) === normalizedId,
    );
    const restoredRecords = currentRecords.filter(
      (item) => String(item.id) !== normalizedId,
    );
    if (previousIndex >= 0) {
      restoredRecords.splice(
        Math.min(previousIndex, restoredRecords.length),
        0,
        stateSnapshot[previousIndex],
      );
    }
    mutation.state[type] = restoredRecords;
    this.entityIndexes.invalidate(type);
    const rollbackErrors = [];
    if (durableWriteCompleted) {
      try {
        const previousRecord = stateSnapshot.find(
          (item) => String(item.id) === String(recordId),
        );
        if (mutation.db.stores.includes(type)) {
          if (previousRecord) await mutation.db.putRecord(type, previousRecord);
          else await mutation.db.deleteRecord(type, recordId);
        } else {
          await this.persistData(type, {
            trackMutation: false,
            throwOnError: true,
            workspaceMutation: mutation,
          });
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      mutation.outbox.restore(outboxCheckpoint);
      await mutation.outbox.flush();
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors;
  }
  async addRecord(type, record) {
    const mutation = this.beginWorkspaceMutation();
    const stateSnapshot = structuredClone(mutation.state[type] || []);
    const outboxCheckpoint = mutation.outbox.checkpoint();
    let durableWriteCompleted = false;
    try {
      this.assertStorageTablesWritable(type);
      const normalizedRecord = upsertEntity(
        mutation.state,
        type,
        record,
        (value, entityType) => this.normalizeRecordKeys(value, entityType)
      );
      if (mutation.db.stores.includes(type)) {
        await mutation.db.putRecord(type, normalizedRecord);
        durableWriteCompleted = true;
      } else {
        await this.persistData(type, {
          trackMutation: false,
          throwOnError: true,
          workspaceMutation: mutation,
        });
        durableWriteCompleted = true;
      }
      this.commitWorkspaceMutation(mutation, type, { records: normalizedRecord });
      await mutation.outbox.flush();
    } catch (error) {
      await this._rollbackLegacyRecordMutation({
        mutation,
        type,
        recordId: record?.id,
        stateSnapshot,
        outboxCheckpoint,
        durableWriteCompleted,
      }, error);
      throw error;
    } finally {
      this.finishWorkspaceMutation(mutation);
    }
  }
  async updateRecord(type, record) {
    const mutation = this.beginWorkspaceMutation();
    const stateSnapshot = structuredClone(mutation.state[type] || []);
    const outboxCheckpoint = mutation.outbox.checkpoint();
    let durableWriteCompleted = false;
    try {
      this.assertStorageTablesWritable(type);
      const normalizedRecord = upsertEntity(
        mutation.state,
        type,
        record,
        (value, entityType) => this.normalizeRecordKeys(value, entityType)
      );
      if (mutation.db.stores.includes(type)) {
        await mutation.db.putRecord(type, normalizedRecord);
        durableWriteCompleted = true;
      } else {
        await this.persistData(type, {
          trackMutation: false,
          throwOnError: true,
          workspaceMutation: mutation,
        });
        durableWriteCompleted = true;
      }
      this.commitWorkspaceMutation(mutation, type, { records: normalizedRecord });
      await mutation.outbox.flush();
    } catch (error) {
      await this._rollbackLegacyRecordMutation({
        mutation,
        type,
        recordId: record?.id,
        stateSnapshot,
        outboxCheckpoint,
        durableWriteCompleted,
      }, error);
      throw error;
    } finally {
      this.finishWorkspaceMutation(mutation);
    }
  }
  async deleteRecord(type, recordId) {
    const mutation = this.beginWorkspaceMutation();
    const stateSnapshot = structuredClone(mutation.state[type] || []);
    const outboxCheckpoint = mutation.outbox.checkpoint();
    let durableWriteCompleted = false;
    try {
      this.assertStorageTablesWritable(type);
      const deletedRecord = (mutation.state[type] || []).find(
        (record) => String(record.id) === String(recordId)
      );
      removeEntity(mutation.state, type, recordId);
      if (mutation.db.stores.includes(type)) {
        await mutation.db.deleteRecord(type, recordId);
        durableWriteCompleted = true;
      } else {
        await this.persistData(type, {
          trackMutation: false,
          throwOnError: true,
          workspaceMutation: mutation,
        });
        durableWriteCompleted = true;
      }
      this.commitWorkspaceMutation(mutation, type, {
        deletedIds: deletedRecord || { id: recordId },
      });
      await mutation.outbox.flush();
    } catch (error) {
      await this._rollbackLegacyRecordMutation({
        mutation,
        type,
        recordId,
        stateSnapshot,
        outboxCheckpoint,
        durableWriteCompleted,
      }, error);
      throw error;
    } finally {
      this.finishWorkspaceMutation(mutation);
    }
  }
  switchActiveRole(role, userName, userId) {
    const allowedRole = BiddingModel.resolveAllowedActiveRole(this.state.activeuser, role);
    this.state.activerole = allowedRole;
    const title = BiddingModel.getRoleTitle(allowedRole);
    this.state.activeuser = {
      ...this.state.activeuser || {},
      name: userName || this.state.activeuser?.name || this.state.activeuser?.username || "Người dùng",
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
    sessionStorage.removeItem("bf_username");
    sessionStorage.removeItem("bf_user_id");
    localStorage.removeItem("bf_remember_me");
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
    super_admin: ["super_admin", "owner", "manager", "employee"],
    owner: ["owner", "manager", "employee"],
    manager: ["manager", "employee"],
    employee: ["employee"]
  };
  static getRoleTitle(role) {
    if (role === "super_admin") return "Super Admin";
    if (role === "owner" || role === "manager") return "Quản lý";
    return "Chuyên viên";
  }
  static resolveAllowedActiveRole(user, requestedRole = null) {
    const rolesFromServer = Array.isArray(user?.dbRoles) ? user.dbRoles : [];
    const roleSource = rolesFromServer.length > 0 ? rolesFromServer.join(",") : user?.dbRole || user?.role || "";
    if (!roleSource) return "employee";
    const allowedRoles = new Set(BiddingModel.getEffectiveRoles(roleSource));
    let switchableRoles;
    if (allowedRoles.has("super_admin")) {
      switchableRoles = ["super_admin", "manager", "employee"];
    } else if (allowedRoles.has("owner") || allowedRoles.has("manager")) {
      switchableRoles = ["manager", "employee"];
    } else if (allowedRoles.has("employee")) {
      switchableRoles = ["employee"];
    } else switchableRoles = ["employee"];
    return requestedRole && switchableRoles.includes(requestedRole)
      ? requestedRole
      : switchableRoles[0];
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
  isActivePersonalWorkspace() {
    const activeUser = this.state.activeuser;
    const activeOrganizationId = String(activeUser?.activeOrganizationId || "").trim();
    if (activeOrganizationId.startsWith("personal:")) {
      return true;
    }
    const organizations = Array.isArray(activeUser?.organizations)
      ? activeUser.organizations
      : [];
    return organizations.some((organization) => (
      String(organization?.id || "").trim() === activeOrganizationId
      && String(organization?.scope_type || "").trim().toLowerCase() === "personal"
    ));
  }
  hasInheritedSpecialistAccess() {
    if (this.state.activerole !== "employee") return false;
    const activeUser = this.state.activeuser || {};
    const sourceRoles = Array.isArray(activeUser.dbRoles) && activeUser.dbRoles.length > 0
      ? activeUser.dbRoles
      : [activeUser.dbRole || activeUser.platformRole || activeUser.role].filter(Boolean);
    return sourceRoles.some((role) => BiddingModel.getEffectiveRoles(role).has("manager"));
  }
  hasPermission(empId, moduleName, permissionType) {
    if (this.isActivePersonalWorkspace() || this.hasActiveEffectiveRole("manager") || this.hasInheritedSpecialistAccess()) {
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
    if (this.isActivePersonalWorkspace() || this.hasActiveEffectiveRole("manager")) {
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
    if (this.isActivePersonalWorkspace() || this.hasActiveEffectiveRole("manager")) {
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
    if (this.isActivePersonalWorkspace() || this.hasActiveEffectiveRole("manager")) {
      return allPackages;
    }
    const empId = this.state.activeuser?.id;
    if (!empId) {
      return [];
    }
    return allPackages.filter((gt) => this.isAssigned(empId, gt.id, "goithau"));
  }
  getFilteredHopDong() {
    const allContracts = this.getLatestContracts();
    if (this.isActivePersonalWorkspace() || this.hasActiveEffectiveRole("manager")) {
      return allContracts;
    }
    const empId = this.state.activeuser?.id;
    if (!empId) {
      return [];
    }
    return allContracts.filter((hd) => this.isAssigned(empId, hd.id, "hopdong"));
  }
  // --- Format Utilities imported from ../shared/formatters.js ---
  getLatestPlans() {
    return selectLatestVersionsByRoot(this.state.kehoach);
  }
  getLatestPackages() {
    return selectLatestVersionsByRoot(
      this.state.goithau,
      packageVersionResolutionOptions(this.state.kehoach),
    );
  }
  getLatestContracts() {
    return selectLatestVersionsByRoot(this.state.hopdong);
  }
  getLatestPackagesForPlan(planId) {
    if (!planId) return [];
    return selectLatestVersionsByRoot(
      (this.state.goithau || []).filter(
        (pkg) => String(pkg.keHoachId) === String(planId),
      ),
    );
  }
  getLatestChuDauTu() {
    return selectLatestVersionsByRoot(this.state.chudautu);
  }
  getLatestNhaThau() {
    return selectLatestVersionsByRoot(this.state.nhathau);
  }
  getLatestChuyenGia() {
    return selectLatestVersionsByRoot(this.state.chuyengia);
  }
  getLatestHopDong() {
    const latestPkgs = this.getLatestPackages();
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
          } catch {
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
    return selectLatestVersionsByRoot(validContracts);
  }
  getLatestPlan(planId) {
    if (!planId) return null;
    const planIndex = this.entityIndexes.byId("kehoach");
    const rootIndex = this.entityIndexes.byRootId("kehoach");
    const plan = planIndex.get(String(planId));
    const family = rootIndex.get(plan ? versionRootId(plan) : String(planId)) || [];
    if (!plan && family.length === 0) return null;
    return selectLatestVersion(family) || plan;
  }
  getLatestPackage(packageId) {
    if (!packageId) return null;
    const packageIndex = this.entityIndexes.byId("goithau");
    const rootIndex = this.entityIndexes.byRootId("goithau");
    const pkg = packageIndex.get(String(packageId));
    const family = rootIndex.get(pkg ? versionRootId(pkg) : String(packageId)) || [];
    if (!pkg && family.length === 0) return null;
    return selectLatestVersion(
      family,
      packageVersionResolutionOptions(this.state.kehoach),
    ) || pkg;
  }
  getLatestContract(contractId) {
    if (!contractId) return null;
    const contractIndex = this.entityIndexes.byId("hopdong");
    const rootIndex = this.entityIndexes.byRootId("hopdong");
    const hd = contractIndex.get(String(contractId));
    const family = rootIndex.get(hd ? versionRootId(hd) : String(contractId)) || [];
    if (!hd && family.length === 0) return null;
    return selectLatestVersion(family) || hd;
  }
}
