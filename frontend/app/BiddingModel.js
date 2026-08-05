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
import { BrowserDB } from "./BrowserDB.js";
import { WorkspaceMutationOutbox } from "./WorkspaceMutationOutbox.js";
import { WorkspaceMutationOutboxStore } from "./WorkspaceMutationOutboxStore.js";
import { removeEntity, upsertEntity } from "./entityStore.js";
import {
  ScopedWorkspaceStorage,
  purgeWorkspaceLocalData,
  resolveWorkspaceScope,
  workspaceDatabaseName
} from "./workspaceState.js";
const STATE_KEY_BY_SERVER_TABLE = Object.fromEntries(
  Object.entries(CLIENT_TABLE_MAP).map(([stateKey, tableName]) => [tableName, stateKey])
);
const SYNCED_STATE_KEYS = /* @__PURE__ */ new Set([
  "chudautu",
  "kehoach",
  "goithau",
  "goithauhanghoa",
  "hanghoaduthaunhathau",
  "chuyengia",
  "nhathau",
  "hopdong",
  "assignments",
  "customcontractstatuses",
  "thongtinmothau",
  "permissionmatrix"
]);
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
    this.pageSize = 10;
    this._loadedStorageKeys = /* @__PURE__ */ new Set();
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

  beginWorkspaceTransition() {
    if (!this._workspaceWriteLocked) this._workspaceEpoch += 1;
    this._workspaceWriteLocked = true;
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
      } catch {
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
    const nextScope = resolveWorkspaceScope({
      userId: options.userId,
      organizationId: options.organizationId
    });
    const changedWorkspace = this.workspaceScope?.key !== nextScope.key;
    if (changedWorkspace) {
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
  }
  async trackDeletions(type) {
    try {
      const oldData = await this.db.getTableData(type);
      if (Array.isArray(oldData) && Array.isArray(this.state[type])) {
        const oldById = new Map(oldData.filter((record) => record?.id).map((record) => [String(record.id), record]));
        const changedRecords = this.state[type].filter((record) => {
          if (!record?.id) return false;
          const previous = oldById.get(String(record.id));
          return !previous || JSON.stringify(previous) !== JSON.stringify(record);
        });
        if (changedRecords.length > 0) await this.markRecordDirty(type, changedRecords);
        const newIds = new Set(this.state[type].map((x) => x.id).filter(Boolean));
        const deletedRecords = oldData.filter((record) => record?.id && !newIds.has(record.id));
        if (deletedRecords.length > 0) {
          await this.markDeleted(type, deletedRecords);
        }
      }
    } catch (e) {
      console.error("Error checking deletions in trackDeletions:", e);
    }
  }
  _isSyncedStateKey(type) {
    return SYNCED_STATE_KEYS.has(type);
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
        database: this.db
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
  async hydrateMutationOutbox() {
    return this._getMutationOutbox().hydrate();
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
    if (this._suspendMutationTracking > 0 || !this._isSyncedStateKey(type)) return;
    return this._getMutationOutbox().enqueue({
      kind: "upsert",
      table: type,
      records
    });
  }
  markTableDirty(type) {
    this._assertWorkspaceWritable();
    if (this._suspendMutationTracking > 0 || !this._isSyncedStateKey(type)) return;
    return this._getMutationOutbox().enqueue({
      kind: "replace-table",
      table: type,
      records: this.state[type]
    });
  }
  markDeleted(type, recordIds) {
    this._assertWorkspaceWritable();
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
    if (options.trackMutation !== false) this._assertWorkspaceWritable();
    const key = type.toUpperCase();
    if (this.STORAGE_KEYS[key]) {
      if (Array.isArray(this.state[type])) {
        this.normalizeRecords(type, this.state[type]);
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
    this._assertWorkspaceWritable();
    const normalizedRecord = upsertEntity(
      this.state,
      type,
      record,
      (value, entityType) => this.normalizeRecordKeys(value, entityType)
    );
    if (this.db.stores.includes(type)) {
      await this.db.putRecord(type, normalizedRecord);
    } else {
      this.persistData(type);
    }
    this.commitLocalMutation(type, { records: normalizedRecord });
  }
  async updateRecord(type, record) {
    this._assertWorkspaceWritable();
    const normalizedRecord = upsertEntity(
      this.state,
      type,
      record,
      (value, entityType) => this.normalizeRecordKeys(value, entityType)
    );
    if (this.db.stores.includes(type)) {
      await this.db.putRecord(type, normalizedRecord);
    } else {
      this.persistData(type);
    }
    this.commitLocalMutation(type, { records: normalizedRecord });
  }
  async deleteRecord(type, recordId) {
    this._assertWorkspaceWritable();
    const deletedRecord = (this.state[type] || []).find(
      (record) => String(record.id) === String(recordId)
    );
    removeEntity(this.state, type, recordId);
    this.commitLocalMutation(type, { deletedIds: deletedRecord || { id: recordId } });
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
  getLatestContracts() {
    const latestMap = {};
    (this.state.hopdong || []).forEach((contract) => {
      const root = contract.rootId || contract.id;
      const current = latestMap[root];
      if (!current ||
        (contract.isLatest == 1 && current.isLatest != 1) ||
        (contract.isLatest == current.isLatest && (parseInt(contract.phienBan) || 0) > (parseInt(current.phienBan) || 0))) {
        latestMap[root] = contract;
      }
    });
    return Object.values(latestMap);
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
      return candidates.reduce((best, current) => {
        const currentVer = parseInt(current.phienBan || 0);
        const bestVer = parseInt(best.phienBan || 0);
        if (currentVer !== bestVer) return currentVer > bestVer ? current : best;
        return current.isLatest == 1 && best.isLatest != 1 ? current : best;
      }, candidates[0]);
    }).filter(Boolean);
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
