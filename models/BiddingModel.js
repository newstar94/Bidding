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
        // A plan is visible to an employee if any package in it is assigned to them
        const assignedPackages = this.state.assignments
            .filter(a => String(a.empId).replace(/^(emp-|user-|sa-|mgr-)+/, '') === cleanEmpId && a.type === 'goithau')
            .map(a => String(a.targetId).replace(/^(gt-|hd-)+/, ''));

        return allPlans.filter(kh => {
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
            const str = String(dateStr).replace(/\s*-\s*/, ' ').trim();
            const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
            const dmyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);

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
                hasTime = /[T\s]\d{1,2}:\d{2}/.test(dateStr);
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
            const str = String(dateStr).replace(/\s*-\s*/, ' ').trim();
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

    formatForDatetimeLocal(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    convertDMYToYMD(dmyStr) {
        if (!dmyStr) return '';
        let cleaned = String(dmyStr).replace(/\s*-\s*/, ' ').trim();
        const partsSpace = cleaned.split(' ');
        const datePart = partsSpace[0];
        const parts = datePart.split('/');
        if (parts.length !== 3) return dmyStr;
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }

    convertDMYHMSToYMDHMS(dmyHMSStr) {
        if (!dmyHMSStr) return '';
        let cleaned = String(dmyHMSStr).replace(/\s*-\s*/, ' ').trim();
        const parts = cleaned.split(' ');
        const datePart = parts[0];
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
        return verNum === 0 ? 'V0 (Gốc)' : `V${verNum} (Điều chỉnh ${verNum})`;
    }

    getPackageBaseCode(code) {
        return code || '';
    }

    getLatestPlans() {
        const latest = (this.state.kehoach || []).filter(kh => kh.isLatest == 1);
        if (latest.length > 0) return latest;
        const latestMap = {};
        this.state.kehoach.forEach(kh => {
            const root = kh.rootId || kh.id;
            const verNum = parseInt(kh.phienBan) || 0;

            if (!latestMap[root] || verNum > latestMap[root].version) {
                latestMap[root] = {
                    plan: kh,
                    version: verNum
                };
            }
        });
        return Object.values(latestMap).map(item => item.plan);
    }

    getLatestPackages() {
        const validPackages = (this.state.goithau || []).filter(gt => {
            if (!gt.keHoachId) return true;
            const plan = (this.state.kehoach || []).find(k => k.id === gt.keHoachId);
            if (plan && (plan.isLatest === 0 || plan.is_latest === 0)) {
                return false;
            }
            return true;
        });

        const latest = validPackages.filter(gt => gt.isLatest == 1);
        if (latest.length > 0) return latest;
        const latestMap = {};
        validPackages.forEach(gt => {
            const root = gt.rootId || gt.id;
            const verNum = parseInt(gt.phienBan) || 0;

            if (!latestMap[root] || verNum > latestMap[root].version) {
                latestMap[root] = {
                    package: gt,
                    version: verNum
                };
            }
        });
        return Object.values(latestMap).map(item => item.package);
    }

    // Duplicate version label functions have been removed. Use getVersionLabel instead.

    getLatestChuDauTu() {
        const chudautuList = Array.isArray(this.state.chudautu) ? this.state.chudautu : [];
        const latest = chudautuList.filter(c => c.isLatest == 1);
        if (latest.length > 0) return latest;
        const latestMap = {};
        chudautuList.forEach(c => {
            const root = c.rootId || c.id;
            const verNum = parseInt(c.phienBan) || 0;

            if (!latestMap[root] || verNum > latestMap[root].version) {
                latestMap[root] = {
                    item: c,
                    version: verNum
                };
            }
        });
        return Object.values(latestMap).map(item => item.item);
    }

    getLatestNhaThau() {
        const nhathauList = Array.isArray(this.state.nhathau) ? this.state.nhathau : [];
        const latest = nhathauList.filter(n => n.isLatest == 1);
        if (latest.length > 0) return latest;
        const latestMap = {};
        nhathauList.forEach(n => {
            const root = n.rootId || n.id;
            const verNum = parseInt(n.phienBan) || 0;

            if (!latestMap[root] || verNum > latestMap[root].version) {
                latestMap[root] = {
                    item: n,
                    version: verNum
                };
            }
        });
        return Object.values(latestMap).map(item => item.item);
    }

    getLatestChuyenGia() {
        const chuyengiaList = Array.isArray(this.state.chuyengia) ? this.state.chuyengia : [];
        const latest = chuyengiaList.filter(c => c.isLatest == 1);
        if (latest.length > 0) return latest;
        const latestMap = {};
        chuyengiaList.forEach(c => {
            const root = c.rootId || c.id;
            const verNum = parseInt(c.phienBan) || 0;

            if (!latestMap[root] || verNum > latestMap[root].version) {
                latestMap[root] = {
                    item: c,
                    version: verNum
                };
            }
        });
        return Object.values(latestMap).map(item => item.item);
    }

    getLatestHopDong() {
        const latestPkgs = this.getLatestPackages();
        const latestPkgIds = latestPkgs.map(g => g.id);

        const allContracts = this.getFilteredHopDong();
        const validContracts = allContracts.filter(hd => {
            if (!hd.goiThauId) return true;
            return latestPkgIds.includes(hd.goiThauId);
        });

        const latest = validContracts.filter(h => h.isLatest == 1);
        if (latest.length > 0) return latest;
        const latestMap = {};
        validContracts.forEach(h => {
            const root = h.rootId || h.id;
            const verNum = parseInt(h.phienBan) || 0;

            if (!latestMap[root] || verNum > latestMap[root].version) {
                latestMap[root] = {
                    item: h,
                    version: verNum
                };
            }
        });
        return Object.values(latestMap).map(item => item.item);
    }
}
