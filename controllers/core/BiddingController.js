/* ==========================================================================
   BiddingFlow - Controller (Events, Interaction & Business logic dispatching)
   ========================================================================== */

import * as Auth from '/controllers/auth/AuthController.js';
import * as Admin from '/controllers/admin/AdminUserController.js';
import * as Bidding from '/controllers/workflows/BiddingWorkflows.js';
import * as Partner from '/controllers/workflows/PartnerWorkflows.js';

import * as MainUI from '/controllers/main_controller/BiddingControllerUI.js';
import * as MainForms from '/controllers/main_controller/BiddingControllerForms.js';
import * as MainSync from '/controllers/main_controller/BiddingControllerSync.js';

export class BiddingController {
    constructor(model, view) {
        this.model = model;
        this.view = view;
        window.appController = this;

        this.tempChuyenGiaImageBase64 = '';
        this.tempChuyenGiaSignatureBase64 = '';

        this.packageWizard = {
            active: false,
            planId: null,
            totalCount: 0,
            currentCount: 0
        };

        // Standardized SPA Route Mapping Layer (Internal state -> Clean Path URL)
        this.routeMap = {
            'dashboard': 'tong-quan',
            'kehoach': 'ke-hoach',
            'goithau': 'goi-thau',
            'mothau': 'mothau',
            'danhgiahsdt': 'danh-gia-hsdt',
            'hopdong': 'hop-dong',
            'chudautu': 'chu-dau-tu',
            'nhathau': 'nha-thau',
            'chuyengia': 'chuyen-gia',
            'bieumau': 'bieu-mau',

            'superadmin-dashboard': 'tong-quan-admin',
            'superadmin': 'quan-ly-tai-khoan',
            'managernhanvien': 'nhan-su',
            'managerhosogiay': 'trang-thai-ho-so',
            'profile': 'trang-ca-nhan',
            'goithau-detail': 'goi-thau-chi-tiet',
            'kehoach-detail': 'ke-hoach-chi-tiet',
            'hopdong-detail': 'hop-dong-chi-tiet'
        };

        this.actionMap = {
            'taomoi': 'tao-moi',
            'chinhsua': 'chinh-sua'
        };

        window.toggleSortTable = (tableKey, field) => {
            const current = this.model.sortState[tableKey] || { field: '', order: 'asc' };
            if (current.field === field) {
                current.order = current.order === 'asc' ? 'desc' : 'asc';
            } else {
                current.field = field;
                current.order = 'asc';
            }
            this.model.sortState[tableKey] = current;

            if (tableKey === 'kehoach') this.view.renderKeHoachTable();
            else if (tableKey === 'goithau') this.view.renderGoiThauTable();
            else if (tableKey === 'chudautu') this.view.renderChuDauTuTable();
            else if (tableKey === 'nhathau') this.view.renderNhaThauTable();
            else if (tableKey === 'chuyengia') this.view.renderChuyenGiaTable();
            else if (tableKey === 'hopdong') this.view.renderHopDongTable();
        };
    }

    async init() {
        // Intercept native fetch to automatically append security headers & handle auth errors globally
        const originalFetch = window.fetch;
        window.fetch = async (url, options = {}) => {
            let token = sessionStorage.getItem('bf_session_token');
            let username = sessionStorage.getItem('bf_username');
            
            if (!token && localStorage.getItem('bf_remember_me') === 'true') {
                token = localStorage.getItem('bf_session_token');
                username = localStorage.getItem('bf_username');
                const userId = localStorage.getItem('bf_user_id');
                if (token && username) {
                    sessionStorage.setItem('bf_session_token', token);
                    sessionStorage.setItem('bf_username', username);
                    if (userId) sessionStorage.setItem('bf_user_id', userId);
                }
            }

            const activeOrg = localStorage.getItem('bf_active_org');

            if (typeof url === 'string' && url.startsWith('/api/') && token && username) {
                options.headers = {
                    ...options.headers,
                    'X-Session-Token': token,
                    'X-Username': username,
                    ...(activeOrg && { 'X-Active-Org': encodeURIComponent(activeOrg) })
                };
            }

            if (typeof url === 'string' && url.includes('/api/sync') && options.method === 'POST') {
                try {
                    let bodyObj = {};
                    if (options.body) {
                        bodyObj = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
                    }
                    const localDeletions = JSON.parse(localStorage.getItem('bf_local_deletions') || '[]');
                    bodyObj.deletions = localDeletions;
                    options.body = JSON.stringify(bodyObj);
                } catch (e) {
                    console.error("Failed to inject local deletions to sync request", e);
                }
            }

            const response = await originalFetch(url, options);

            if (response.ok && typeof url === 'string' && url.includes('/api/sync') && options.method === 'POST') {
                localStorage.setItem('bf_local_deletions', '[]');
            }

            // Xử lý các lỗi quyền hạn (403 Forbidden)
            if (response.status === 403 && typeof url === 'string' && url.startsWith('/api/') && !url.includes('/api/auth/login') && !url.includes('/api/auth/check-session')) {
                let errorMsg = "Yêu cầu bị từ chối do không đủ quyền hạn hoặc vi phạm cấu hình hệ thống.";
                let isSessionError = false;
                try {
                    const clone = response.clone();
                    const data = await clone.json();
                    if (data && data.error) {
                        errorMsg = data.error;
                    }
                    if (errorMsg === "Không có quyền truy cập tổ chức này!") {
                        localStorage.removeItem('bf_active_org');
                        localStorage.setItem('bf_last_sync_timestamp', '0');
                        if (this.model.db && this.model.db.stores) {
                            this.model.db.stores.forEach(storeName => {
                                this.model.db.putTableData(storeName, []).catch(() => { });
                                if (this.model.state[storeName]) {
                                    this.model.state[storeName] = [];
                                }
                            });
                        }
                    }
                    if (
                        errorMsg === "Thiếu thông tin xác thực phiên làm việc!" ||
                        errorMsg === "Tài khoản không tồn tại!" ||
                        errorMsg === "Phiên làm việc đã hết hạn hoặc không hợp lệ!" ||
                        errorMsg === "Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại."
                    ) {
                        isSessionError = true;
                    }
                } catch (e) {
                    console.error("Lỗi phân tích phản hồi 403:", e);
                }

                if (isSessionError) {
                    const overlay = document.getElementById('auth-overlay');
                    if (overlay && overlay.style.display !== 'flex') {
                        this.model.clearSessionData();
                        overlay.style.display = 'flex';
                        document.querySelector('.app-container').style.filter = 'blur(10px)';
                        const formLogin = document.getElementById('form-auth-login');
                        const formRegister = document.getElementById('form-auth-register');
                        const formForgot = document.getElementById('form-auth-forgot');
                        if (formLogin) formLogin.style.display = 'block';
                        if (formRegister) formRegister.style.display = 'none';
                        if (formForgot) formForgot.style.display = 'none';
                    }
                    return response;
                }

                if (errorMsg === "Không có quyền truy cập tổ chức này!") {
                    await this.view.customAlert('⚠️ LỖI QUYỀN HẠN', 'Không có quyền truy cập tổ chức này!', 'log-out');
                } else {
                    await this.view.customAlert('⚠️ LỖI QUYỀN HẠN (403)', `${errorMsg}\n\nNhấn Xác nhận để tải lại hệ thống.`, 'log-out');
                }
                window.location.reload();
                return response;
            }

            // Xử lý các lỗi phiên đăng nhập hết hạn (401 Unauthorized)
            if (response.status === 401 && typeof url === 'string' && url.startsWith('/api/') && !url.includes('/api/auth/login') && !url.includes('/api/auth/check-session')) {
                // Phiên làm việc hết hạn hoặc không hợp lệ -> Chuyển về màn hình đăng nhập ngay lập tức
                const overlay = document.getElementById('auth-overlay');
                if (overlay && overlay.style.display !== 'flex') {
                    this.model.clearSessionData();
                    overlay.style.display = 'flex';
                    document.querySelector('.app-container').style.filter = 'blur(10px)';
                    const formLogin = document.getElementById('form-auth-login');
                    const formRegister = document.getElementById('form-auth-register');
                    const formForgot = document.getElementById('form-auth-forgot');
                    if (formLogin) formLogin.style.display = 'block';
                    if (formRegister) formRegister.style.display = 'none';
                    if (formForgot) formForgot.style.display = 'none';
                }
            }

            return response;
        };

        await this.model.init();

        // #region UI Setup / Offline Banner
        // Create offline banner dynamically
        const banner = document.createElement('div');
        banner.id = 'offline-indicator-banner';
        banner.className = 'offline-banner';
        banner.innerHTML = `<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.`;
        document.body.appendChild(banner);
        if (window.lucide) {
            window.lucide.createIcons({ root: banner });
        }

        const updateOnlineStatus = () => {
            if (navigator.onLine) {
                banner.classList.remove('visible');
            } else {
                banner.innerHTML = `<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.`;
                if (window.lucide) {
                    window.lucide.createIcons({ root: banner });
                }
                banner.classList.add('visible');
            }
        };

        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        updateOnlineStatus(); // initial check
        // #endregion

        if (localStorage.getItem('bf_id_prefix_cleaned_v2') !== 'true') {
            localStorage.setItem('bf_last_sync_timestamp', '0');
            if (this.model.db && this.model.db.stores) {
                this.model.db.stores.forEach(storeName => {
                    this.model.db.putTableData(storeName, []).catch(() => { });
                });
            }
            localStorage.setItem('bf_id_prefix_cleaned_v2', 'true');
        }

        this.view.initDOM();
        this.setupAuth();
        this.setupActivityTracker();

        this.registerGlobals();
        this.setupTheme();
        this.setupSidebar();
        this.setupTabs();
        this.setupActionListeners();
        this.setupConditionalUI();
        this.setupFileUploads();
        this.setupWordTemplatesEvents();
        this.setupExcelImportEvents();

        // RBAC Init
        this.view.updateActiveUserProfileDisplay();
        this.setupRBACEvents();

        // SPA Routing & History Popstate event listener for browser Back/Forward navigation
        window.addEventListener('popstate', (e) => {
            this.handlePathRouting(window.location.pathname, false);
        });

        // Initialize Tab based on URL Pathname or Role Default
        this.handlePathRouting(window.location.pathname, false, true);

        // Dùng delta sync để tối ưu hóa hiệu năng khởi động (tránh force full sync)
        this.forceSyncData();

        // Always load real users from DB into model.state.employees for assignment dropdowns
        try {
            const usersRes = await fetch('/api/auth/users');
            if (usersRes.ok) {
                const users = await usersRes.json();
                const localEmployees = JSON.parse(localStorage.getItem('bf_employees') || '[]');
                this.model.state.employees = users.map(u => {
                    const localEmp = localEmployees.find(le => le.email && le.email.trim().toLowerCase() === (u.email || '').trim().toLowerCase());
                    return {
                        id: u.id,
                        username: u.username,
                        name: localEmp ? localEmp.name : u.name,
                        email: u.email || '',
                        phone: localEmp ? localEmp.phone : '',
                        role: u.role,
                        package_id: u.package_id
                    };
                });
                this.model.persistData('employees');
                this.view.populateNhanVienPhuTrachDropdowns();
            }
        } catch (err) {
            console.error("Failed to load users for assignment dropdowns:", err);
        }

        // Load dynamic registration packages from SQLite database
        try {
            const pkgsRes = await fetch('/api/system-packages');
            if (pkgsRes.ok) {
                const pkgs = await pkgsRes.json();
                const lockedPkgs = JSON.parse(localStorage.getItem('bf_locked_system_packages') || '[]');
                pkgs.forEach(p => {
                    p.isLocked = lockedPkgs.includes(p.id);
                });
                this.model.state.systempackages = pkgs;
                this.model.persistData('systempackages');
            }
        } catch (err) {
            console.error("Failed to load system packages from SQLite:", err);
        }

        // Initialize background sync
        this.setupAutoSyncBackground();
    }

    registerGlobals() {
        window.changePlanRowVersion = (root, selectedId) => {
            if (!this.model.state.selectedPlanVersion) {
                this.model.state.selectedPlanVersion = {};
            }
            this.model.state.selectedPlanVersion[root] = selectedId;
            this.view.renderKeHoachTable();
        };

        window.changePackageRowVersion = (root, selectedId) => {
            if (!this.model.state.selectedPackageVersion) {
                this.model.state.selectedPackageVersion = {};
            }
            this.model.state.selectedPackageVersion[root] = selectedId;
            this.view.renderGoiThauTable();
        };

        window.changeChuDauTuRowVersion = (root, selectedId) => {
            if (!this.model.state.selectedChuDauTuVersion) {
                this.model.state.selectedChuDauTuVersion = {};
            }
            this.model.state.selectedChuDauTuVersion[root] = selectedId;
            this.view.renderChuDauTuTable();
        };

        window.changeNhaThauRowVersion = (root, selectedId) => {
            if (!this.model.state.selectedNhaThauVersion) {
                this.model.state.selectedNhaThauVersion = {};
            }
            this.model.state.selectedNhaThauVersion[root] = selectedId;
            this.view.renderNhaThauTable();
        };

        window.changeChuyenGiaRowVersion = (root, selectedId) => {
            if (!this.model.state.selectedChuyenGiaVersion) {
                this.model.state.selectedChuyenGiaVersion = {};
            }
            this.model.state.selectedChuyenGiaVersion[root] = selectedId;
            this.view.renderChuyenGiaTable();
        };

        window.changeHopDongRowVersion = (root, selectedId) => {
            if (!this.model.state.selectedHopDongVersion) {
                this.model.state.selectedHopDongVersion = {};
            }
            this.model.state.selectedHopDongVersion[root] = selectedId;
            this.view.renderHopDongTable();
        };

        window.showPackageDetails = (id) => this.view.showPackageDetails(id);
        window.showKeHoachDetails = (id) => this.view.showKeHoachDetails(id);
        window.showHopDongDetails = (id) => this.view.showHopDongDetails(id);
        window.showChuyenGiaDetails = (id) => this.view.showChuyenGiaDetails(id);
        window.showChuDauTuDetails = (id) => this.view.showChuDauTuDetails(id);
        window.showNhaThauDetails = (id) => this.view.showNhaThauDetails(id);

        window.zoomCertificateImage = (id) => {
            const cg = this.model.state.chuyengia.find(c => c.id === id);
            if (!cg || !cg.anhChungChi) return;

            const lightbox = document.createElement('div');
            lightbox.className = 'certificate-lightbox';
            lightbox.innerHTML = `<img src="${cg.anhChungChi}" alt="Chứng chỉ Zoom">`;
            lightbox.onclick = () => lightbox.remove();
            document.body.appendChild(lightbox);
        };

        window.zoomSignatureImage = (id) => {
            const cg = this.model.state.chuyengia.find(c => c.id === id);
            if (!cg || !cg.anhChuKy) return;

            const lightbox = document.createElement('div');
            lightbox.className = 'certificate-lightbox';
            lightbox.innerHTML = `<img src="${cg.anhChuKy}" alt="Chữ ký Zoom" style="max-height:60vh; background:#fff; padding:24px; border-radius:12px;">`;
            lightbox.onclick = () => lightbox.remove();
            document.body.appendChild(lightbox);
        };

        window.editKeHoach = (id) => this.editKeHoach(id);
        window.deleteKeHoach = (id) => this.deleteKeHoach(id);
        window.addBreakdownRow = (type) => this.addBreakdownRow(type);
        window.removeBreakdownRow = (btn, type) => this.removeBreakdownRow(btn, type);

        window.editGoiThau = (id, isReadOnly = false) => this.editGoiThau(id, isReadOnly);
        window.deleteGoiThau = (id) => this.deleteGoiThau(id);
        window.restoreCanceledPackage = (id) => this.restoreCanceledPackage(id);
        window.addGiaHanRow = (data) => this.addGiaHanRow(data);
        window.validateGiaHanRealtime = () => this.validateGiaHanRealtime();
        window.moThauGoiThau = (id) => this.moThauGoiThau(id);
        window.phatHanhHsmtGoiThau = (id) => this.phatHanhHsmtGoiThau(id);
        window.enforceSingleLeader = (tbodyId, roleName) => this.enforceSingleLeader(tbodyId, roleName);

        window.editChuDauTu = (id) => this.editChuDauTu(id);
        window.deleteChuDauTu = (id) => this.deleteChuDauTu(id);

        window.editNhaThau = (id, isReadOnly = false) => this.editNhaThau(id, isReadOnly);
        window.deleteNhaThau = (id) => this.deleteNhaThau(id);

        window.editChuyenGia = (id) => this.editChuyenGia(id);
        window.deleteChuyenGia = (id) => this.deleteChuyenGia(id);

        window.editHopDong = (id) => this.editHopDong(id);
        window.deleteHopDong = (id) => this.deleteHopDong(id);

        window.saveKetQuaChiDinhThau = (gtId) => Bidding.saveKetQuaChiDinhThau.call(this, gtId);

        window.exportContractFromHopDong = (pkgId, soHopDong) => {
            const dbId = pkgId;

            // Show dynamic loading indicator if available
            const btn = document.querySelector(`button[onclick*="${pkgId}"][onclick*="${soHopDong}"]`);
            const origHTML = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:14px;height:14px;"></i>';
                lucide.createIcons({ root: btn });
            }

            fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goithau: this.model.state.goithau,
                    hopdong: this.model.state.hopdong
                })
            })
                .then(s => {
                    if (!s.ok) throw new Error('Không thể đồng bộ dữ liệu');
                    return fetch(`/api/export-report/${dbId}?type=contract`);
                })
                .then(r => {
                    if (!r.ok) throw new Error('Không thể xuất hợp đồng');
                    return r.blob();
                })
                .then(b => {
                    const url = window.URL.createObjectURL(b);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Hop_dong_${soHopDong || 'LCNT'}.docx`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                })
                .catch(err => {
                    this.view.customAlert('Lỗi xuất hợp đồng', err.message, 'x-circle');
                })
                .finally(() => {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = origHTML;
                        lucide.createIcons({ root: btn });
                    }
                });
        };

        window.addJointVentureMemberCard = (data) => this.addJointVentureMemberCard(data);
        window.removeJointVentureMemberCard = (id) => this.removeJointVentureMemberCard(id);
        window.switchTab = (tab, action = null, updateState = true) => this.switchTab(tab, action, updateState);

        window.toggleOrgLock = (id) => this.toggleOrgLock(id);
        window.renewOrgSubscription = (id) => this.renewOrgSubscription(id);
        window.editPackageQuota = (pkgId, defaultQuota) => this.editPackageQuota(pkgId, defaultQuota);
        window.editSystemPackage = (pkgId) => this.editSystemPackage(pkgId);
        window.togglePackageLock = (id) => this.togglePackageLock(id);
        window.editEmployee = (id) => this.editEmployee(id);
        window.deleteEmployee = (id) => this.deleteEmployee(id);
        window.editHoSoGiayStatus = (id) => this.editHoSoGiayStatus(id);
        window.deleteHoSoGiayStatus = (id) => this.deleteHoSoGiayStatus(id);
        window.triggerUpgradePrompt = () => this.triggerUpgradePrompt();
        window.deleteSystemUser = (id, username) => this.deleteSystemUser(id, username);
        window.changeUserRole = (id, newRole) => this.changeUserRole(id, newRole);
        window.changeUserPackage = (id, newPackage) => this.changeUserPackage(id, newPackage);
        window.toggleUserPackage = (id, packageId, isChecked) => this.toggleUserPackage(id, packageId, isChecked);
        window.updateUserMetadata = (id, field, value) => this.updateUserMetadata(id, field, value);
        window.showSystemUserDetail = (id) => this.showSystemUserDetail(id);

        window.renderTablePagination = (containerId, totalItems, currentPage, pageSize) => {
            const container = document.getElementById(containerId);
            if (!container) return;

            const totalPages = Math.ceil(totalItems / pageSize) || 1;
            if (currentPage > totalPages) currentPage = totalPages;

            const startIdx = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
            const endIdx = Math.min(currentPage * pageSize, totalItems);

            let html = `
                <div class="pagination-info">
                    Hiển thị <strong>${startIdx}-${endIdx}</strong> trên tổng số <strong>${totalItems}</strong> bản ghi
                </div>
                <div class="pagination-buttons">
                    <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="window.handlePageChange('${containerId}', 1)" title="Trang đầu">
                        <i data-lucide="chevrons-left" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="window.handlePageChange('${containerId}', ${currentPage - 1})" title="Trang trước">
                        <i data-lucide="chevron-left" style="width:14px; height:14px;"></i>
                    </button>
            `;

            const maxVisiblePages = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
            let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

            if (endPage - startPage + 1 < maxVisiblePages) {
                startPage = Math.max(1, endPage - maxVisiblePages + 1);
            }

            for (let i = startPage; i <= endPage; i++) {
                html += `
                    <button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="window.handlePageChange('${containerId}', ${i})">
                        ${i}
                    </button>
                `;
            }

            html += `
                    <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="window.handlePageChange('${containerId}', ${currentPage + 1})" title="Trang sau">
                        <i data-lucide="chevron-right" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="window.handlePageChange('${containerId}', ${totalPages})" title="Trang cuối">
                        <i data-lucide="chevrons-right" style="width:14px; height:14px;"></i>
                    </button>
                </div>
            `;

            container.innerHTML = html;
            lucide.createIcons({ root: container });
        };

        window.handlePageChange = (containerId, pageNum) => {
            const tabKey = containerId.split('-')[0];
            this.model.currentPage[tabKey] = pageNum;
            this.model.savePage(tabKey);

            if (tabKey === 'kehoach') this.view.renderKeHoachTable();
            else if (tabKey === 'goithau') this.view.renderGoiThauTable();
            else if (tabKey === 'chudautu') this.view.renderChuDauTuTable();
            else if (tabKey === 'nhathau') this.view.renderNhaThauTable();
            else if (tabKey === 'chuyengia') this.view.renderChuyenGiaTable();
            else if (tabKey === 'hopdong') this.view.renderHopDongTable();
        };
    }
}
