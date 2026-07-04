/* ==========================================================================
   BiddingFlow - Model (State, Storage & Utilities)
   ========================================================================== */

import * as formatters from '/views/utils/formatters.js';

window.generateUUID = function() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

window.escapeHTML = function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

class BrowserDB {
    constructor(dbName = "BiddingFlowDB") {
        this.dbName = dbName;
        this.db = null;
        this.stores = [
            'chudautu',
            'nhathau',
            'chuyengia',
            'kehoach',
            'goithau',
            'hopdong',
            'systempackages',
            'organizations',
            'employees',
            'permissionmatrix',
            'custompaperstatuses',
            'assignments',
            'thongtinmothau',
            'kv_store'
        ];
    }

    init() {
        return new Promise((resolve, reject) => {
            // Upgrade version to 2 to ensure onupgradeneeded triggers and creates all stores
            const request = indexedDB.open(this.dbName, 2);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                this.stores.forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName, storeName === 'kv_store' ? {} : { keyPath: 'id' });
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
                const transaction = this.db.transaction('kv_store', "readonly");
                const store = transaction.objectStore('kv_store');
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
                const transaction = this.db.transaction('kv_store', "readwrite");
                const store = transaction.objectStore('kv_store');
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

    putTableData(tableName, dataArray) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.db.objectStoreNames.contains(tableName)) return resolve();
            try {
                const transaction = this.db.transaction(tableName, "readwrite");
                const store = transaction.objectStore(tableName);
                
                const getKeysRequest = store.getAllKeys();
                getKeysRequest.onsuccess = () => {
                    const existingKeys = new Set(getKeysRequest.result || []);
                    const incomingKeys = new Set((dataArray || []).map(item => item.id));
                    
                    existingKeys.forEach(key => {
                        if (!incomingKeys.has(key)) {
                            store.delete(key);
                        }
                    });
                    
                    (dataArray || []).forEach(item => {
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
                (dataArray || []).forEach(item => {
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
                (idsArray || []).forEach(id => {
                    store.delete(id);
                });
                transaction.oncomplete = () => resolve();
                transaction.onerror = (e) => reject(e.target.error);
            } catch (e) {
                reject(e);
            }
        });
    }
}

const FIELD_NAME_OVERRIDES = {
    id_goc: 'rootId',
    root_id: 'rootId',
    so_cccd: 'soCCCD',
    ma_qhns: 'maQHNS',
    thoi_gian_dang_tai: 'thoiGianDangTai',
    thoi_gian_dang_ma: 'thoiGianDangMa',
    thoi_gian_mo_ehsdxtc: 'thoiGianMoEhsdxtc',
    hieu_luc_hsdt: 'hieuLucHsdt',
    hieu_luc_hsdxt: 'hieuLucHsdxt',
    ty_le_bao_dam_hop_dong: 'tyLeBaoDamHopDong',
    yeu_cau_tham_dinh_hsmt: 'yeuCauThamDinhHsmt',
    so_bao_cao_tham_dinh_hsmt: 'soBaoCaoThamDinhHsmt',
    ngay_bao_cao_tham_dinh_hsmt: 'ngayBaoCaoThamDinhHsmt',
    so_to_trinh_hsmt: 'soToTrinhHsmt',
    ngay_trinh_hsmt: 'ngayTrinhHsmt',
    emp_id: 'empId'
};

const snakeToCamel = (key) => {
    if (!key || !key.includes('_')) return key;
    if (FIELD_NAME_OVERRIDES[key]) return FIELD_NAME_OVERRIDES[key];
    return key.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
};

export class BiddingModel {
    constructor() {
        Object.assign(this, formatters);
        this.db = new BrowserDB();
        this.STORAGE_KEYS = {
            CHUDAUTU: 'bf_chudautu',
            NHATHAU: 'bf_nhathau',
            CHUYENGIA: 'bf_chuyengia',
            KEHOACH: 'bf_kehoach',
            GOITHAU: 'bf_goithau',
            HOPDONG: 'bf_hopdong',
            THEME: 'bf_dark_mode',
            USERID: 'bf_user_id',

            // New RBAC Storage Keys
            ACTIVEROLE: 'bf_active_role',
            ACTIVEUSER: 'bf_active_user',
            ORGANIZATIONS: 'bf_organizations',
            EMPLOYEES: 'bf_employees',
            PERMISSIONMATRIX: 'bf_permission_matrix',
            CUSTOMPAPERSTATUSES: 'bf_custom_paper_statuses',
            ASSIGNMENTS: 'bf_assignments',
            SYSTEMPACKAGES: 'bf_system_packages',
            THONGTINMOTHAU: 'bf_thong_tin_mo_thau'
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
            thongtinmothau: [],
        };

        this.sortState = {
            kehoach:   { field: 'maKeHoach',    order: 'asc' },
            goithau:   { field: 'maGoiThau',    order: 'asc' },
            chudautu:  { field: 'tenChuDauTu',  order: 'asc' },
            nhathau:   { field: 'tenNhaThau',   order: 'asc' },
            chuyengia: { field: 'hoTen',        order: 'asc' },
            hopdong:   { field: 'tenHopDong',   order: 'asc' }
        };

        // Khôi phục trang hiện tại từ sessionStorage (persist qua F5 nhưng xóa khi đóng tab)
        const savedPages = (() => {
            try { return JSON.parse(sessionStorage.getItem('bf_current_pages') || '{}'); } catch { return {}; }
        })();
        this.currentPage = {
            kehoach:   savedPages.kehoach   || 1,
            goithau:   savedPages.goithau   || 1,
            chudautu:  savedPages.chudautu  || 1,
            nhathau:   savedPages.nhathau   || 1,
            chuyengia: savedPages.chuyengia || 1,
            hopdong:   savedPages.hopdong   || 1
        };
        this.pageSize = 10;
        this._loadedStorageKeys = new Set();
        this._allDataLoadPromise = null;
    }

    normalizeRecordKeys(record) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            return record;
        }

        const normalized = {};
        Object.entries(record).forEach(([key, value]) => {
            const canonicalKey = snakeToCamel(key);
            if (!(canonicalKey in normalized) || normalized[canonicalKey] === undefined || normalized[canonicalKey] === null || normalized[canonicalKey] === '') {
                normalized[canonicalKey] = value;
            }
        });
        return normalized;
    }

    normalizeRecords(type, records) {
        if (!Array.isArray(records)) return records;
        const normalized = records.map(record => this.normalizeRecordKeys(record));
        this.state[type] = normalized;
        return normalized;
    }

    /** Lưu trang hiện tại vào sessionStorage để F5 không mất trang */
    savePage(table) {
        try {
            const pages = JSON.parse(sessionStorage.getItem('bf_current_pages') || '{}');
            pages[table] = this.currentPage[table] || 1;
            sessionStorage.setItem('bf_current_pages', JSON.stringify(pages));
        } catch (e) {}
    }


    async loadStorageKeys(keysToLoad) {
        const requested = new Set(keysToLoad || Object.keys(this.STORAGE_KEYS));
        const loadPromises = Object.keys(this.STORAGE_KEYS).map(async (key) => {
            if (!requested.has(key) || this._loadedStorageKeys.has(key)) return;
            if (key === 'THEME' || key === 'ACTIVEROLE' || key === 'ACTIVEUSER') return;
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

    async init(options = {}) {
        const userId = sessionStorage.getItem('bf_user_id');
        if (userId) {
            const cleanUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
            this.db = new BrowserDB(`BiddingFlowDB_${cleanUserId}`);
        } else {
            this.db = new BrowserDB();
        }
        this._loadedStorageKeys = new Set();
        this._allDataLoadPromise = null;
        await this.db.init();

        await this.loadStorageKeys(options.priorityKeys || Object.keys(this.STORAGE_KEYS));

        // Setup premium commercial packages
        if (!this.state.systempackages) {
            this.state.systempackages = [];
        }

        // Initialize Active Role & User
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
            } catch (e) {}
        }

        try {
            this.state.activerole = storedRole || 'super_admin';
        } catch (e) {
            this.state.activerole = 'super_admin';
        }

        try {
            this.state.activeuser = storedUser || { name: 'Admin', title: 'Hệ thống', id: 'sa-1' };
        } catch (e) {
            this.state.activeuser = { name: 'Admin', title: 'Hệ thống', id: 'sa-1' };
        }

    }



    async trackDeletions(type) {
        try {
            const oldData = await this.db.getTableData(type);
            if (Array.isArray(oldData) && Array.isArray(this.state[type])) {
                const newIds = new Set(this.state[type].map(x => x.id).filter(Boolean));
                const deletedIds = oldData.map(x => x.id).filter(id => id && !newIds.has(id));
                if (deletedIds.length > 0) {
                    let localDeletions = [];
                    try {
                        localDeletions = JSON.parse(localStorage.getItem('bf_local_deletions') || '[]');
                    } catch (e) {
                        localDeletions = [];
                    }
                    deletedIds.forEach(id => {
                        if (!localDeletions.some(d => d.id === id && d.table === type)) {
                            localDeletions.push({ table: type, id: id });
                        }
                    });
                    localStorage.setItem('bf_local_deletions', JSON.stringify(localDeletions));
                }
            }
        } catch (e) {
            console.error("Error checking deletions in trackDeletions:", e);
        }
    }

    markDeleted(type, recordIds) {
        const ids = Array.isArray(recordIds) ? recordIds : [recordIds];
        let localDeletions = [];
        try {
            localDeletions = JSON.parse(localStorage.getItem('bf_local_deletions') || '[]');
        } catch (e) {
            localDeletions = [];
        }
        ids.filter(Boolean).forEach(id => {
            if (!localDeletions.some(d => d.id === id && d.table === type)) {
                localDeletions.push({ table: type, id });
            }
        });
        localStorage.setItem('bf_local_deletions', JSON.stringify(localDeletions));
    }

    async persistData(type) {
        const key = type.toUpperCase();
        if (this.STORAGE_KEYS[key]) {
            if (Array.isArray(this.state[type])) {
                this.normalizeRecords(type, this.state[type]);
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
        const normalizedRecord = this.normalizeRecordKeys(record);
        this.state[type].push(normalizedRecord);
        if (this.db.stores.includes(type)) {
            await this.db.putRecord(type, normalizedRecord);
        } else {
            this.persistData(type);
        }
    }

    async updateRecord(type, record) {
        if (!this.state[type]) {
            this.state[type] = [];
        }
        const normalizedRecord = this.normalizeRecordKeys(record);
        const index = this.state[type].findIndex(x => x.id === normalizedRecord.id);
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
    }

    async deleteRecord(type, recordId) {
        if (this.state[type]) {
            this.state[type] = this.state[type].filter(x => x.id !== recordId);
        }
        
        this.markDeleted(type, recordId);

        if (this.db.stores.includes(type)) {
            await this.db.deleteRecord(type, recordId);
        } else {
            this.persistData(type);
        }
    }

    switchActiveRole(role, userName, userId) {
        this.state.activerole = role;
        let title = 'Chuyên viên';
        if (role === 'super_admin') title = 'Super Admin';
        else if (role === 'manager') title = 'Quản lý';

        this.state.activeuser = {
            ...(this.state.activeuser || {}),
            name: userName,
            title: title,
            id: userId
        };

        sessionStorage.setItem(this.STORAGE_KEYS.ACTIVEROLE, JSON.stringify(this.state.activerole));
        sessionStorage.setItem(this.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.state.activeuser));
        // Không ghi vào IndexedDB cho session data — localStorage đủ và nhanh hơn
    }

    clearSessionData() {
        Object.keys(this.STORAGE_KEYS).forEach(key => {
            if (key !== 'THEME') {
                localStorage.removeItem(this.STORAGE_KEYS[key]);
            }
        });
        sessionStorage.removeItem('bf_session_token');
        sessionStorage.removeItem('bf_username');
        sessionStorage.removeItem('bf_user_id');
        localStorage.removeItem('bf_remember_me');
        localStorage.removeItem('bf_session_token');
        localStorage.removeItem('bf_username');
        localStorage.removeItem('bf_user_id');
        // Reset model state
        Object.keys(this.state).forEach(key => {
            if (Array.isArray(this.state[key])) {
                this.state[key] = [];
            } else if (typeof this.state[key] === 'object' && this.state[key] !== null) {
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
        super_admin: ['super_admin', 'manager', 'employee'],
        manager: ['manager', 'employee'],
        employee: ['employee'],
    };

    /**
     * Kiểm tra xem user (dựa vào cỗt role) có role yêu cầu hay không (kể cả kế thừa).
     * @param {Object|string} userOrRoleStr - Object user có thuộc tính .role, hoặc chuỗi role trực tiếp
     * @param {string} requiredRole - Role cần kiểm tra
     */
    hasEffectiveRole(userOrRoleStr, requiredRole) {
        const roleStr = (typeof userOrRoleStr === 'string')
            ? userOrRoleStr
            : (userOrRoleStr && userOrRoleStr.role ? userOrRoleStr.role : '');
        const roles = roleStr.split(',').map(r => r.trim()).filter(Boolean);
        const effective = new Set(
            roles.flatMap(r => BiddingModel.ROLE_HIERARCHY[r] || [r])
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
        const roles = (roleStr || '').split(',').map(r => r.trim()).filter(Boolean);
        const effective = new Set(
            roles.flatMap(r => BiddingModel.ROLE_HIERARCHY[r] || [r])
        );
        return effective;
    }

    hasPermission(empId, moduleName, permissionType) {
        // super_admin và manager (kể cả kế thừa) có toàn quyền
        if (this.hasActiveEffectiveRole('manager')) {
            return true;
        }

        const matrix = this.state.permissionmatrix.find(m => m.empId === empId);
        if (!matrix) return false;

        const perm = matrix[moduleName];
        if (!perm) return false;

        if (permissionType === 'edit') {
            return perm === 'edit';
        }
        return perm === 'view' || perm === 'edit';
    }

    isAssigned(empId, targetId, type) {
        // super_admin và manager (kế thừa) thấy hết
        if (this.hasActiveEffectiveRole('manager')) {
            return true;
        }

        // Strip string prefixes for matching (e.g. gt-1 vs 1, emp-1 vs user-1, sa-1, mgr-1)
        const cleanEmpId = String(empId).replace(/^(emp-|user-|sa-|mgr-)+/, '');
        const cleanTargetId = String(targetId).replace(/^(gt-|hd-)+/, '');

        return this.state.assignments.some(a =>
            String(a.empId).replace(/^(emp-|user-|sa-|mgr-)+/, '') === cleanEmpId &&
            String(a.targetId).replace(/^(gt-|hd-)+/, '') === cleanTargetId &&
            a.type === type
        );
    }

    // Filter plans, packages, contracts for the active employee
    getFilteredKeHoach() {
        const allPlans = this.getLatestPlans();
        if (this.hasActiveEffectiveRole('manager')) {
            return allPlans;
        }

        const empId = this.state.activeuser?.id;
        if (!empId) {
            return [];
        }
        const cleanEmpId = String(empId).replace(/^(emp-|user-|sa-|mgr-)+/, '');
        
        // A plan is visible to an employee if:
        // 1. The plan itself is assigned to them (type === 'kehoach')
        // 2. Or any package in it is assigned to them (type === 'goithau')
        const assignedPlanIds = this.state.assignments
            .filter(a => String(a.empId).replace(/^(emp-|user-|sa-|mgr-)+/, '') === cleanEmpId && a.type === 'kehoach')
            .map(a => String(a.targetId).replace(/^(gt-|hd-)+/, ''));

        const assignedPackages = this.state.assignments
            .filter(a => String(a.empId).replace(/^(emp-|user-|sa-|mgr-)+/, '') === cleanEmpId && a.type === 'goithau')
            .map(a => String(a.targetId).replace(/^(gt-|hd-)+/, ''));

        return allPlans.filter(kh => {
            const isPlanAssigned = assignedPlanIds.includes(String(kh.id).replace(/^(gt-|hd-)+/, ''));
            if (isPlanAssigned) return true;
            
            const planPackages = this.state.goithau.filter(gt => gt.keHoachId === kh.id);
            return planPackages.some(gt => assignedPackages.includes(String(gt.id).replace(/^(gt-|hd-)+/, '')));
        });
    }

    getFilteredGoiThau() {
        const allPackages = this.getLatestPackages();
        if (this.hasActiveEffectiveRole('manager')) {
            return allPackages;
        }

        const empId = this.state.activeuser?.id;
        if (!empId) {
            return [];
        }
        return allPackages.filter(gt => this.isAssigned(empId, gt.id, 'goithau'));
    }

    getFilteredHopDong() {
        const allContracts = this.state.hopdong || [];
        if (this.hasActiveEffectiveRole('manager')) {
            return allContracts;
        }

        const empId = this.state.activeuser?.id;
        if (!empId) {
            return [];
        }
        return allContracts.filter(hd => this.isAssigned(empId, hd.id, 'hopdong'));
    }

    // --- Format Utilities imported from /views/utils/formatters.js ---

    getLatestPlans() {
        const latestMap = {};
        (this.state.kehoach || []).forEach(kh => {
            const root = kh.rootId || kh.id;
            const verNum = parseInt(kh.phienBan) || 0;
            // [DC-4] Backend đã nhất quán trả isLatest (camelCase) — bỏ fallback is_latest snake_case
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
        // Group ALL packages by rootId regardless of plan version
        const rootMap = {};
        (this.state.goithau || []).forEach(gt => {
            const root = gt.rootId || gt.id;
            if (!rootMap[root]) rootMap[root] = [];
            rootMap[root].push(gt);
        });

        const result = [];
        Object.values(rootMap).forEach(candidates => {
            // Find the highest package version number
            const maxVer = Math.max(...candidates.map(g => parseInt(g.phienBan) || 0));
            const topVersionCandidates = candidates.filter(g => (parseInt(g.phienBan) || 0) === maxVer);

            // Among same-version candidates, prefer the one linked to the latest plan version
            let best = topVersionCandidates[0];
            if (topVersionCandidates.length > 1) {
                let maxPlanVer = -1;
                topVersionCandidates.forEach(c => {
                    const plan = (this.state.kehoach || []).find(k => k.id === c.keHoachId);
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
        (this.state.goithau || [])
            .filter(gt => String(gt.keHoachId) === String(planId))
            .forEach(gt => {
                const root = gt.rootId || gt.id;
                if (!rootMap[root]) rootMap[root] = [];
                rootMap[root].push(gt);
            });

        return Object.values(rootMap).map(candidates => {
            const explicitLatest = candidates.find(g => g.isLatest == 1);
            if (explicitLatest) return explicitLatest;
            return candidates.reduce((best, current) => {
                const currentVer = parseInt(current.phienBan || 0);
                const bestVer = parseInt(best.phienBan || 0);
                return currentVer > bestVer ? current : best;
            }, candidates[0]);
        }).filter(Boolean);
    }

    formatCurrency(value) {
        if (value === null || value === undefined || value === '') return '--';
        const num = Number(value);
        if (isNaN(num)) return value;
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
    }

    getLatestChuDauTu() {
        const chudautuList = Array.isArray(this.state.chudautu) ? this.state.chudautu : [];
        const latestMap = {};
        chudautuList.forEach(c => {
            const root = c.rootId || c.id;
            const verNum = parseInt(c.phienBan) || 0;
            // [DC-4] Bỏ fallback is_latest và root_id snake_case
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
        nhathauList.forEach(n => {
            const root = n.rootId || n.id;
            const verNum = parseInt(n.phienBan) || 0;
            // [DC-4] Bỏ fallback is_latest và root_id snake_case
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
        chuyengiaList.forEach(c => {
            const root = c.rootId || c.id;
            const verNum = parseInt(c.phienBan) || 0;
            // [DC-4] Bỏ fallback is_latest và root_id snake_case
            const isLatest = c.isLatest == 1;

            if (!latestMap[root]) {
                latestMap[root] = c;
            } else {
                const existingVer = parseInt(latestMap[root].phienBan) || 0;
                const existingLatest = latestMap[root].isLatest == 1;  // [DC-4]

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
        const latestPkgIds = latestPkgs.map(g => g.id);

        const allContracts = this.getFilteredHopDong();
        const validContracts = allContracts.filter(hd => {
            let linkedIds = [];
            if (hd.goiThauId) {
                linkedIds.push(hd.goiThauId);
            }
            if (hd.goiThauIds) {
                if (Array.isArray(hd.goiThauIds)) {
                    linkedIds.push(...hd.goiThauIds);
                } else if (typeof hd.goiThauIds === 'string') {
                    try {
                        const parsed = JSON.parse(hd.goiThauIds);
                        if (Array.isArray(parsed)) {
                            linkedIds.push(...parsed);
                        } else {
                            linkedIds.push(hd.goiThauIds);
                        }
                    } catch (e) {
                        linkedIds.push(...hd.goiThauIds.split(',').map(s => s.trim()));
                    }
                }
            }
            linkedIds = linkedIds.filter(Boolean);
            if (linkedIds.length === 0) return true;

            return linkedIds.some(id => {
                const pkg = (this.state.goithau || []).find(g => g.id === id);
                if (!pkg) return false;
                const root = pkg.rootId || pkg.id;
                return latestPkgs.some(g => (g.rootId === root || g.id === root));
            });
        });

        const latestMap = {};
        validContracts.forEach(h => {
            const root = h.rootId || h.id;
            const verNum = parseInt(h.phienBan) || 0;
            // [DC-4] Bỏ fallback is_latest và root_id snake_case
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
        const plan = (this.state.kehoach || []).find(k => k.id === planId);
        if (!plan) return null;
        const root = plan.rootId || plan.id;
        // [DC-4] Bỏ fallback root_id và is_latest snake_case
        const latest = (this.state.kehoach || []).find(k => (k.rootId === root || k.id === root) && k.isLatest == 1);
        return latest || plan;
    }

    getLatestPackage(packageId) {
        if (!packageId) return null;
        const pkg = (this.state.goithau || []).find(g => g.id === packageId);
        if (!pkg) return null;
        const root = pkg.rootId || pkg.id;

        // Get ALL packages sharing this rootId
        const all = (this.state.goithau || []).filter(g => (g.rootId === root || g.id === root));
        if (all.length === 0) return pkg;
        if (all.length === 1) return all[0];

        // Find the highest package version number
        const maxVer = Math.max(...all.map(g => parseInt(g.phienBan) || 0));
        const topVersionCandidates = all.filter(g => (parseInt(g.phienBan) || 0) === maxVer);
        if (topVersionCandidates.length === 1) return topVersionCandidates[0];

        // Among same-version candidates, pick the one linked to the highest plan version
        let best = topVersionCandidates[0];
        let maxPlanVer = -1;
        topVersionCandidates.forEach(c => {
            const plan = (this.state.kehoach || []).find(k => k.id === c.keHoachId);
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
        const hd = (this.state.hopdong || []).find(h => h.id === contractId);
        if (!hd) return null;
        const root = hd.rootId || hd.id;
        // [DC-4] Bỏ fallback root_id và is_latest snake_case
        const latest = (this.state.hopdong || []).find(h => (h.rootId === root || h.id === root) && h.isLatest == 1);
        return latest || hd;
    }
}
