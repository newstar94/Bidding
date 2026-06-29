/* ==========================================================================
   BiddingFlow - Model (State, Storage & Utilities)
   ========================================================================== */

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

export class BiddingModel {
    constructor() {
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
    }

    /** Lưu trang hiện tại vào sessionStorage để F5 không mất trang */
    savePage(table) {
        try {
            const pages = JSON.parse(sessionStorage.getItem('bf_current_pages') || '{}');
            pages[table] = this.currentPage[table] || 1;
            sessionStorage.setItem('bf_current_pages', JSON.stringify(pages));
        } catch (e) {}
    }

    async init() {
        const userId = sessionStorage.getItem('bf_user_id');
        if (userId) {
            const cleanUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
            this.db = new BrowserDB(`BiddingFlowDB_${cleanUserId}`);
        } else {
            this.db = new BrowserDB();
        }
        await this.db.init();

        // 1. One-time clear / migration of legacy LocalStorage keys to IndexedDB
        let clearedV5 = false;
        try {
            clearedV5 = localStorage.getItem('bf_migrated_v5_clean') === 'true';
        } catch (e) {}

        if (!clearedV5) {
            // Read all existing localStorage keys, save them to IndexedDB
            for (const key of Object.keys(this.STORAGE_KEYS)) {
                if (key === 'THEME') continue;
                try {
                    const stored = localStorage.getItem(this.STORAGE_KEYS[key]);
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        await this.db.set(this.STORAGE_KEYS[key], parsed);
                    }
                } catch (e) {
                    console.error("Failed to migrate key during startup:", key, e);
                }
            }
            try {
                localStorage.setItem('bf_migrated_v5_clean', 'true');
            } catch (e) {}
        }

        // Initialize standard keys from IndexedDB / Native Tables
        for (const key of Object.keys(this.STORAGE_KEYS)) {
            if (key === 'THEME' || key === 'ACTIVEROLE' || key === 'ACTIVEUSER') continue;
            const lowKey = key.toLowerCase();
            try {
                let stored;
                if (this.db.stores.includes(lowKey)) {
                    stored = await this.db.getTableData(lowKey);
                    // Nếu bảng IndexedDB trống, thử đọc từ kv_store cũ để di trú
                    if (!stored || stored.length === 0) {
                        const legacyData = await this.db.get(this.STORAGE_KEYS[key]);
                        if (legacyData && legacyData.length > 0) {
                            stored = legacyData;
                            await this.db.putTableData(lowKey, stored);
                        }
                    }
                } else {
                    stored = await this.db.get(this.STORAGE_KEYS[key]);
                }

                if (stored) {
                    this.state[lowKey] = stored;
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
            }
        }

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
            console.error("Lỗi đọc active role/user từ localStorage:", e);
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

        // Session state (ACTIVEROLE, ACTIVEUSER) chỉ lưu trong localStorage (nhanh hơn và không cần offline persistence)
        // IDB fallback vẫn được giữ phía trên để tương thích ngược với user cũ
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

    async persistData(type) {
        const key = type.toUpperCase();
        if (this.STORAGE_KEYS[key]) {
            if (this.db.stores.includes(type)) {
                await this.trackDeletions(type);
                
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
        this.state[type].push(record);
        if (this.db.stores.includes(type)) {
            await this.db.putRecord(type, record);
        } else {
            this.persistData(type);
        }
    }

    async updateRecord(type, record) {
        if (!this.state[type]) {
            this.state[type] = [];
        }
        const index = this.state[type].findIndex(x => x.id === record.id);
        if (index !== -1) {
            this.state[type][index] = record;
        } else {
            this.state[type].push(record);
        }
        if (this.db.stores.includes(type)) {
            await this.db.putRecord(type, record);
        } else {
            this.persistData(type);
        }
    }

    async deleteRecord(type, recordId) {
        if (this.state[type]) {
            this.state[type] = this.state[type].filter(x => x.id !== recordId);
        }
        
        let localDeletions = [];
        try {
            localDeletions = JSON.parse(localStorage.getItem('bf_local_deletions') || '[]');
        } catch (e) {
            localDeletions = [];
        }
        if (!localDeletions.some(d => d.id === recordId && d.table === type)) {
            localDeletions.push({ table: type, id: recordId });
            localStorage.setItem('bf_local_deletions', JSON.stringify(localDeletions));
        }

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

        const empId = this.state.activeuser.id;
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

        const empId = this.state.activeuser.id;
        return allPackages.filter(gt => this.isAssigned(empId, gt.id, 'goithau'));
    }

    getFilteredHopDong() {
        const allContracts = this.state.hopdong || [];
        if (this.hasActiveEffectiveRole('manager')) {
            return allContracts;
        }

        const empId = this.state.activeuser.id;
        return allContracts.filter(hd => this.isAssigned(empId, hd.id, 'hopdong'));
    }

    // --- Format Utilities ---
    formatCurrency(value) {
        if (value === null || value === undefined || value === '' || isNaN(value)) return '--';
        const hasFraction = value % 1 !== 0;
        const fixedValue = hasFraction ? value.toFixed(2) : value.toFixed(0);
        const parts = fixedValue.split('.');
        const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        const decimalPart = parts[1] ? ',' + parts[1] : '';
        return integerPart + decimalPart + ' VND';
    }

    formatVND(value) {
        if (value === null || value === undefined) return '';
        
        let str = value.toString().trim();
        if (!str) return '';

        // If value is a raw number type, replace decimal dot with comma
        if (typeof value === 'number') {
            str = value.toString().replace('.', ',');
        }

        const parts = str.split(',');
        let integerPart = parts[0];
        let decimalPart = parts.length > 1 ? parts[1] : null;

        // Clean integer part: keep only digits
        integerPart = integerPart.replace(/\D/g, '');
        if (!integerPart && decimalPart === null) return '';
        if (!integerPart) integerPart = '0';

        // Format integer part using dots as thousands separators
        const formattedInteger = parseInt(integerPart, 10).toLocaleString('vi-VN');

        if (decimalPart !== null) {
            // Keep only digits in the decimal part
            decimalPart = decimalPart.replace(/\D/g, '');
            return formattedInteger + ',' + decimalPart;
        }

        return formattedInteger;
    }

    parseVND(value) {
        if (value === null || value === undefined) return null;
        let str = value.toString().trim();
        if (!str) return null;
        // Strip dots (thousands separator in vi-VN)
        str = str.replace(/\./g, '');
        // Replace comma with dot (decimal separator in vi-VN)
        str = str.replace(/,/g, '.');
        const parsed = parseFloat(str);
        return isNaN(parsed) ? null : parsed;
    }

    formatDate(dateStr) {
        if (!dateStr) return '--';
        
        let year = null, month = null, day = null, hours = '00', minutes = '00';
        let hasTime = false;

        if (dateStr instanceof Date) {
            const d = dateStr;
            day = String(d.getDate()).padStart(2, '0');
            month = String(d.getMonth() + 1).padStart(2, '0');
            year = d.getFullYear();
            hours = String(d.getHours()).padStart(2, '0');
            minutes = String(d.getMinutes()).padStart(2, '0');
            hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
        } else {
            const str = String(dateStr).trim();
            const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
            let dmyMatch = null;
            if (!ymdMatch) {
                const resolvedDmy = str.replace(/\s*-\s*/, ' ').trim();
                dmyMatch = resolvedDmy.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);
            }


            if (ymdMatch) {
                year = ymdMatch[1];
                month = ymdMatch[2];
                day = ymdMatch[3];
                if (ymdMatch[4] !== undefined) {
                    hours = ymdMatch[4];
                    minutes = ymdMatch[5];
                    hasTime = true;
                }
            } else if (dmyMatch) {
                day = dmyMatch[1];
                month = dmyMatch[2];
                year = dmyMatch[3];
                if (dmyMatch[4] !== undefined) {
                    hours = dmyMatch[4];
                    minutes = dmyMatch[5];
                    hasTime = true;
                }
            } else {
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return dateStr;
                day = String(d.getDate()).padStart(2, '0');
                month = String(d.getMonth() + 1).padStart(2, '0');
                year = d.getFullYear();
                hours = String(d.getHours()).padStart(2, '0');
                minutes = String(d.getMinutes()).padStart(2, '0');
                hasTime = /[T\s]\d{1,2}:\d{2}/.test(String(dateStr));
            }
        }

        if (hasTime) {
            return `${day}/${month}/${year} ${hours}:${minutes}`;
        }
        return `${day}/${month}/${year}`;
    }

    formatDateWithTime(dateStr) {
        if (!dateStr) return '--';
        
        let year = null, month = null, day = null, hours = '00', minutes = '00';

        if (dateStr instanceof Date) {
            const d = dateStr;
            day = String(d.getDate()).padStart(2, '0');
            month = String(d.getMonth() + 1).padStart(2, '0');
            year = d.getFullYear();
            hours = String(d.getHours()).padStart(2, '0');
            minutes = String(d.getMinutes()).padStart(2, '0');
        } else {
            const str = String(dateStr).trim();
            const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
            let dmyMatch = null;
            if (!ymdMatch) {
                const resolvedDmy = str.replace(/\s*-\s*/, ' ').trim();
                dmyMatch = resolvedDmy.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);
            }


            if (ymdMatch) {
                year = ymdMatch[1];
                month = ymdMatch[2];
                day = ymdMatch[3];
                if (ymdMatch[4] !== undefined) {
                    hours = ymdMatch[4];
                    minutes = ymdMatch[5];
                }
            } else if (dmyMatch) {
                day = dmyMatch[1];
                month = dmyMatch[2];
                year = dmyMatch[3];
                if (dmyMatch[4] !== undefined) {
                    hours = dmyMatch[4];
                    minutes = dmyMatch[5];
                }
            } else {
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return dateStr;
                day = String(d.getDate()).padStart(2, '0');
                month = String(d.getMonth() + 1).padStart(2, '0');
                year = d.getFullYear();
                hours = String(d.getHours()).padStart(2, '0');
                minutes = String(d.getMinutes()).padStart(2, '0');
            }
        }

        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    formatForDateInput(dateStr) {
        if (!dateStr) return '';
        let year = null, month = null, day = null;
        if (dateStr instanceof Date) {
            const d = dateStr;
            day = String(d.getDate()).padStart(2, '0');
            month = String(d.getMonth() + 1).padStart(2, '0');
            year = d.getFullYear();
        } else {
            const str = String(dateStr).trim();
            const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
            const dmyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
            if (ymdMatch) {
                year = ymdMatch[1];
                month = ymdMatch[2];
                day = ymdMatch[3];
            } else if (dmyMatch) {
                day = dmyMatch[1];
                month = dmyMatch[2];
                year = dmyMatch[3];
            } else {
                const cleanedStr = str.replace(/\s*-\s*/, ' ');
                const dmyMatch2 = cleanedStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (dmyMatch2) {
                    day = dmyMatch2[1];
                    month = dmyMatch2[2];
                    year = dmyMatch2[3];
                } else {
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) return '';
                    day = String(d.getDate()).padStart(2, '0');
                    month = String(d.getMonth() + 1).padStart(2, '0');
                    year = d.getFullYear();
                }
            }
        }
        return `${year}-${month}-${day}`;
    }

    formatForDatetimeLocal(dateStr) {
        if (!dateStr) return '';
        let year = null, month = null, day = null, hours = '00', minutes = '00';
        if (dateStr instanceof Date) {
            const d = dateStr;
            day = String(d.getDate()).padStart(2, '0');
            month = String(d.getMonth() + 1).padStart(2, '0');
            year = d.getFullYear();
            hours = String(d.getHours()).padStart(2, '0');
            minutes = String(d.getMinutes()).padStart(2, '0');
        } else {
            const str = String(dateStr).trim();
            const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
            const dmyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);
            if (ymdMatch) {
                year = ymdMatch[1];
                month = ymdMatch[2];
                day = ymdMatch[3];
                if (ymdMatch[4] !== undefined) {
                    hours = ymdMatch[4];
                    minutes = ymdMatch[5];
                }
            } else if (dmyMatch) {
                day = dmyMatch[1];
                month = dmyMatch[2];
                year = dmyMatch[3];
                if (dmyMatch[4] !== undefined) {
                    hours = dmyMatch[4];
                    minutes = dmyMatch[5];
                }
            } else {
                const cleanedStr = str.replace(/\s*-\s*/, ' ');
                const dmyMatch2 = cleanedStr.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);
                if (dmyMatch2) {
                    day = dmyMatch2[1];
                    month = dmyMatch2[2];
                    year = dmyMatch2[3];
                    if (dmyMatch2[4] !== undefined) {
                        hours = dmyMatch2[4];
                        minutes = dmyMatch2[5];
                    }
                } else {
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) return '';
                    day = String(d.getDate()).padStart(2, '0');
                    month = String(d.getMonth() + 1).padStart(2, '0');
                    year = d.getFullYear();
                    hours = String(d.getHours()).padStart(2, '0');
                    minutes = String(d.getMinutes()).padStart(2, '0');
                }
            }
        }
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    convertDMYToYMD(dmyStr) {
        if (!dmyStr) return '';
        let cleaned = String(dmyStr).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
            return cleaned;
        }
        
        // Normalize separators: replace -HH:mm with space HH:mm
        cleaned = cleaned.replace(/-(\d{2}:\d{2})/, ' $1');
        cleaned = cleaned.replace(/\s*-\s*/, ' ').trim();
        
        const partsSpace = cleaned.split(' ');
        let datePart = partsSpace[0];
        // Replace dashes in date part with slashes
        datePart = datePart.replace(/-/g, '/');
        
        const parts = datePart.split('/');
        if (parts.length !== 3) return dmyStr;
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }

    convertDMYHMSToYMDHMS(dmyHMSStr) {
        if (!dmyHMSStr) return '';
        let cleaned = String(dmyHMSStr).trim();
        
        // Nếu là định dạng ISO YYYY-MM-DDTHH:mm hoặc YYYY-MM-DD HH:mm
        if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(cleaned)) {
            let normalized = cleaned.replace('T', ' ');
            const parts = normalized.split(' ');
            let timePart = parts[1].split('+')[0];
            if (timePart.split(':').length === 2) {
                timePart += ':00';
            }
            return `${parts[0]} ${timePart}`;
        }

        // Thay thế dấu nối giữa ngày và giờ (nếu có dạng -HH:mm hoặc -HH:mm:ss) bằng khoảng trắng
        cleaned = cleaned.replace(/-(\d{2}:\d{2})/, ' $1');
        // Support old format "HH:mm ngày dd/MM/yyyy"
        const oldFormatMatch = cleaned.match(/^(\d{2}):(\d{2})\s+ngày\s+(\d{2})\/(\d{2})\/(\d{4})/i);
        if (oldFormatMatch) {
            const hh = oldFormatMatch[1];
            const mm = oldFormatMatch[2];
            const d = oldFormatMatch[3];
            const m = oldFormatMatch[4];
            const y = oldFormatMatch[5];
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} ${hh}:${mm}:00`;
        }

        cleaned = cleaned.replace(/\s*-\s*/, ' ').trim();

        const parts = cleaned.split(' ');
        let datePart = parts[0];
        datePart = datePart.replace(/-/g, '/');

        let timePart = parts[1] || '00:00:00';
        if (timePart.split(':').length === 2) {
            timePart += ':00';
        }
        const ymd = this.convertDMYToYMD(datePart);
        return `${ymd} ${timePart}`;
    }

    getFileExtensionFromBase64(base64Str) {
        if (!base64Str) return 'png';
        if (base64Str.startsWith('data:image/jpeg') || base64Str.startsWith('data:image/jpg')) return 'jpg';
        if (base64Str.startsWith('data:image/webp')) return 'webp';
        if (base64Str.startsWith('data:image/gif')) return 'gif';
        if (base64Str.includes('.')) {
            return base64Str.split('.').pop();
        }
        return 'png';
    }

    getPlanBaseCode(code) {
        return code || '';
    }

    getVersionLabel(phienBan) {
        const verNum = parseInt(phienBan) || 0;
        return String(verNum).padStart(2, '0');
    }

    getCurrentDateTimeString() {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    getPackageBaseCode(code) {
        return code || '';
    }

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
                const root = pkg.rootId || pkg.root_id || pkg.id;
                return latestPkgs.some(g => (g.rootId === root || g.root_id === root || g.id === root));
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
        const root = pkg.rootId || pkg.root_id || pkg.id;

        // Get ALL packages sharing this rootId
        const all = (this.state.goithau || []).filter(g => (g.rootId === root || g.root_id === root || g.id === root));
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
