/* ==========================================================================
   BiddingFlow - Controller (Events, Interaction & Business logic dispatching)
   ========================================================================== */

import * as Auth from '/controllers/AuthController.js?v=6.7';
import * as Admin from '/controllers/AdminUserController.js?v=6.7';
import * as Bidding from '/controllers/BiddingWorkflowController.js?v=6.7';
import * as Partner from '/controllers/PartnerWorkflowController.js?v=6.7';

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
            'goithau-detail': 'goi-thau-chi-tiet'
        };

        this.actionMap = {
            'taomoi': 'tao-moi',
            'chinhsua': 'chinh-sua'
        };
    }

    async init() {
        // Intercept native fetch to automatically append security headers & handle auth errors globally
        const originalFetch = window.fetch;
        window.fetch = async (url, options = {}) => {
            const token = sessionStorage.getItem('bf_session_token');
            const username = sessionStorage.getItem('bf_username');
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

        if (localStorage.getItem('bf_id_prefix_cleaned_v2') !== 'true') {
            localStorage.setItem('bf_last_sync_timestamp', '0');
            if (this.model.db && this.model.db.stores) {
                this.model.db.stores.forEach(storeName => {
                    this.model.db.putTableData(storeName, []).catch(() => { });
                });
            }
            localStorage.setItem('bf_id_prefix_cleaned_v2', 'true');
            console.log("Client-side IndexedDB cache reset for ID prefix removal migration.");
        }

        this.view.initDOM();
        this.setupAuth();
        this.setupActivityTracker();
        this.view.setupFlatpickr();

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
        // localStorage.setItem('bf_last_sync_timestamp', '0');
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

    setupAutoSyncBackground() {
        const checkAndSync = () => {
            const token = sessionStorage.getItem('bf_session_token');
            const username = sessionStorage.getItem('bf_username');
            if (!token || !username) return; // Only sync if logged in

            console.log("Triggering automatic background delta sync...");
            this.forceSyncData(true).catch(err => console.error("Auto sync failed:", err));
        };

        // Check every 30 seconds
        // setInterval(checkAndSync, 30000); // Tắt cơ chế polling tự động 30 giây

        // Check on window focus (user switches tab or returns to app)
        window.addEventListener('focus', checkAndSync);

        // Initialize WebSocket connection
        this.setupWebSocketConnection();
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
        window.showChuyenGiaDetails = (id) => this.view.showChuyenGiaDetails(id);

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

        window.editGoiThau = (id) => this.editGoiThau(id);
        window.deleteGoiThau = (id) => this.deleteGoiThau(id);
        window.addGiaHanRow = (data) => this.addGiaHanRow(data);
        window.validateGiaHanRealtime = () => this.validateGiaHanRealtime();
        window.moThauGoiThau = (id) => this.moThauGoiThau(id);
        window.phatHanhHsmtGoiThau = (id) => this.phatHanhHsmtGoiThau(id);
        window.enforceSingleLeader = (tbodyId, roleName) => this.enforceSingleLeader(tbodyId, roleName);

        window.editChuDauTu = (id) => this.editChuDauTu(id);
        window.deleteChuDauTu = (id) => this.deleteChuDauTu(id);

        window.editNhaThau = (id) => this.editNhaThau(id);
        window.deleteNhaThau = (id) => this.deleteNhaThau(id);

        window.editChuyenGia = (id) => this.editChuyenGia(id);
        window.deleteChuyenGia = (id) => this.deleteChuyenGia(id);

        window.editHopDong = (id) => this.editHopDong(id);
        window.deleteHopDong = (id) => this.deleteHopDong(id);

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

            // Sử dụng fetch thông thường — fetch interceptor tự động gắn headers X-Session-Token & X-Username
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
                    // Dùng customAlert thay vì alert() — styled, non-blocking
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
            this.model.savePage(tabKey);  // Lưu vào sessionStorage để F5 không mất trang

            // Re-render
            if (tabKey === 'kehoach') this.view.renderKeHoachTable();
            else if (tabKey === 'goithau') this.view.renderGoiThauTable();
            else if (tabKey === 'chudautu') this.view.renderChuDauTuTable();
            else if (tabKey === 'nhathau') this.view.renderNhaThauTable();
            else if (tabKey === 'chuyengia') this.view.renderChuyenGiaTable();
            else if (tabKey === 'hopdong') this.view.renderHopDongTable();
        };
    }

    setupTheme() {
        const isDarkMode = localStorage.getItem(this.model.STORAGE_KEYS.THEME) === 'true';
        if (isDarkMode) {
            document.body.classList.add('dark-mode');
            this.view.elements.sunIcon.style.display = 'none';
            this.view.elements.moonIcon.style.display = 'block';
        }

        this.view.elements.themeToggle.addEventListener('click', () => {
            const active = document.body.classList.toggle('dark-mode');
            localStorage.setItem(this.model.STORAGE_KEYS.THEME, active);
            if (active) {
                this.view.elements.sunIcon.style.display = 'none';
                this.view.elements.moonIcon.style.display = 'block';
            } else {
                this.view.elements.sunIcon.style.display = 'block';
                this.view.elements.moonIcon.style.display = 'none';
            }
        });
    }

    setupSidebar() {
        const appContainer = document.querySelector('.app-container');
        const sidebar = this.view.elements.sidebar;

        // Restore collapse state from localStorage
        const isCollapsed = localStorage.getItem('bf_sidebar_collapsed') === 'true';
        if (isCollapsed) appContainer.classList.add('sidebar-collapsed');

        // Toggle collapse button (inside sidebar brand)
        const btnCollapse = document.getElementById('btn-sidebar-collapse');
        if (btnCollapse) {
            btnCollapse.addEventListener('click', () => {
                appContainer.classList.toggle('sidebar-collapsed');
                const collapsed = appContainer.classList.contains('sidebar-collapsed');
                localStorage.setItem('bf_sidebar_collapsed', collapsed);
                lucide.createIcons();
            });
        }

        // Brand icon: click to EXPAND when sidebar is collapsed
        const brandIcon = document.querySelector('.brand-icon');
        if (brandIcon) {
            brandIcon.addEventListener('click', () => {
                if (appContainer.classList.contains('sidebar-collapsed')) {
                    appContainer.classList.remove('sidebar-collapsed');
                    localStorage.setItem('bf_sidebar_collapsed', 'false');
                    lucide.createIcons();
                }
            });
        }



        // Mobile toggle (existing menu-toggle-btn in header)
        this.view.elements.sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });

        this.view.elements.navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                sidebar.classList.remove('active');
            });
        });

        const options = { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' };
        this.view.elements.currentDateSpan.textContent = new Date().toLocaleDateString('vi-VN', options);

        const profileCard = document.querySelector('.profile-card');
        if (profileCard) {
            profileCard.style.cursor = 'pointer';
            profileCard.addEventListener('click', () => {
                this.switchTab('profile');
                sidebar.classList.remove('active');
            });
        }
    }


    setupTabs() {
        this.view.elements.navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');
                this.switchTab(targetTab);
            });
        });

        const viewAllPackagesBtn = document.getElementById('btn-view-all-packages');
        if (viewAllPackagesBtn) {
            viewAllPackagesBtn.addEventListener('click', () => {
                this.switchTab('goithau');
            });
        }
    }

    handlePathRouting(pathname, updateState = true, isInit = false) {
        const cleanPath = pathname.startsWith('/') ? pathname.substring(1) : pathname;
        const parts = cleanPath.split('/').filter(Boolean);

        // Dịch URL Kebab-Case sang TabName nội bộ
        const urlTab = parts[0] || '';
        let tabName = '';
        for (const [key, val] of Object.entries(this.routeMap)) {
            if (val === urlTab) {
                tabName = key;
                break;
            }
        }
        if (!tabName) {
            tabName = this.model.state.activerole === 'super_admin' ? 'superadmin-dashboard' : 'dashboard';
        }

        let action = parts[1] || null;
        let urlAction = parts[1] || null;
        if (!action && urlAction) {
            action = urlAction;
        }

        // Map package code back to internal ID if we are on package detail page
        if (tabName === 'goithau-detail' && action) {
            const gt = this.model.state.goithau.find(g =>
                (g.maGoiThau && g.maGoiThau.toLowerCase() === action.toLowerCase()) ||
                (g.id && g.id.toLowerCase() === action.toLowerCase())
            );
            if (gt) {
                action = gt.id;
            }
        }

        if (isInit) {
            const finalUrlTab = this.routeMap[tabName] || tabName;
            let finalUrlAction = action ? (this.actionMap[action] || action) : null;
            if (tabName === 'goithau-detail' && action) {
                const gt = this.model.state.goithau.find(g => g.id === action);
                if (gt && gt.maGoiThau) {
                    finalUrlAction = gt.maGoiThau;
                }
            }
            const path = '/' + finalUrlTab + (finalUrlAction ? '/' + finalUrlAction : '');
            if (window.location.pathname !== path) {
                history.replaceState({ tab: tabName, action: action }, '', path);
            }
        }

        this.switchTab(tabName, action, updateState);
    }

    switchTab(tabName, action = null, updateState = true) {
        if (updateState) {
            const urlTab = this.routeMap[tabName] || tabName;
            let urlAction = action ? (this.actionMap[action] || action) : null;
            if (tabName === 'goithau-detail' && action) {
                const gt = this.model.state.goithau.find(g => g.id === action);
                if (gt && gt.maGoiThau) {
                    urlAction = gt.maGoiThau;
                }
            }
            const path = '/' + urlTab + (urlAction ? '/' + urlAction : '');
            history.pushState({ tab: tabName, action: action }, '', path);
        }

        this.view.elements.navButtons.forEach(btn => {
            if (btn.getAttribute('data-tab') === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        this.view.elements.tabPanes.forEach(pane => {
            if (pane.id === `tab-${tabName}`) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });

        const titleMap = {
            dashboard: 'Tổng quan hệ thống',
            kehoach: 'Kế hoạch lựa chọn nhà thầu',
            goithau: 'Danh sách Gói thầu',
            chudautu: 'Danh mục Chủ đầu tư',
            nhathau: 'Danh mục Nhà thầu',
            chuyengia: 'Tổ Chuyên gia Đấu thầu',
            hopdong: 'Danh sách Hợp đồng',
            bieumau: 'Quản lý Biểu mẫu & Từ điển',
            'superadmin-dashboard': 'Bảng điều khiển Super Admin BiddingFlow',
            superadmin: 'Quản lý Đơn vị & Tài khoản Thành viên',
            managernhanvien: 'Quản lý Chuyên viên & Phân quyền Matrix',
            managerhosogiay: 'Cấu hình Danh mục Trạng thái Hồ sơ giấy',
            mothau: 'Nhập thông tin Mở thầu (E-HSDT / E-HSĐXKT)',
            danhgiahsdt: 'Đánh giá Hồ sơ dự thầu (E-HSDT)',
            'goithau-detail': 'Chi tiết Quy trình Gói thầu',
            profile: 'Thông tin tài khoản cá nhân'
        };
        this.view.elements.pageTitle.textContent = titleMap[tabName] || 'Hệ thống Quản lý';

        this.renderTabData(tabName, action);

        // Handle Clean URL modal mappings
        if (action === 'taomoi') {
            setTimeout(() => {
                if (tabName === 'kehoach') {
                    const modal = document.getElementById('modal-kehoach');
                    if (modal && !modal.classList.contains('active')) this.editKeHoach(null);
                } else if (tabName === 'goithau') {
                    const modal = document.getElementById('modal-goithau');
                    if (modal && !modal.classList.contains('active')) this.editGoiThau(null);
                } else if (tabName === 'hopdong') {
                    const modal = document.getElementById('modal-hopdong');
                    if (modal && !modal.classList.contains('active')) this.editHopDong(null);
                } else if (tabName === 'chudautu') {
                    const modal = document.getElementById('modal-chudautu');
                    if (modal && !modal.classList.contains('active')) this.editChuDauTu(null);
                } else if (tabName === 'nhathau') {
                    const modal = document.getElementById('modal-nhathau');
                    if (modal && !modal.classList.contains('active')) this.editNhaThau(null);
                } else if (tabName === 'chuyengia') {
                    const modal = document.getElementById('modal-chuyengia');
                    if (modal && !modal.classList.contains('active')) this.editChuyenGia(null);
                }
            }, 100);
        } else if (!action) {
            // Auto close modal if we navigate back to parent route
            document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
            document.body.style.overflow = '';
        }
    }

    renderTabData(tabName, action = null) {
        lucide.createIcons();
        switch (tabName) {
            case 'dashboard':
                this.view.renderDashboard();
                break;
            case 'kehoach':
                this.view.renderKeHoachTable();
                break;
            case 'goithau':
                this.view.renderGoiThauTable();
                break;
            case 'chudautu':
                this.view.renderChuDauTuTable();
                break;
            case 'nhathau':
                this.view.renderNhaThauTable();
                break;
            case 'chuyengia':
                this.view.renderChuyenGiaTable();
                break;
            case 'hopdong':
                this.view.renderHopDongTable();
                break;
            case 'bieumau':
                this.loadWordTemplates();
                this.view.renderDictionary('global');
                this.setupCopyVariableEvents();
                break;
            case 'superadmin-dashboard':
                this.view.renderSuperAdminDashboard();
                break;
            case 'superadmin':
                this.view.renderSuperAdminPanel();
                this.loadSystemUsers();
                break;
            case 'managernhanvien':
                this.reloadEmployeesFromDatabase().then(() => {
                    this.view.renderManagerNhanVienPanel();
                });
                break;
            case 'managerhosogiay':
                this.view.renderManagerHoSoGiayPanel();
                break;
            case 'profile':
                this.view.renderProfileTab(this.model.state.activeuser);
                break;
            case 'mothau':
                this.renderMoThauPanel();
                break;
            case 'danhgiahsdt':
                this.renderDanhGiaHsdtPanel();
                break;
            case 'goithau-detail':
                const activeId = action || (history.state ? history.state.action : null);
                if (activeId) {
                    this.view.showPackageDetails(activeId);
                } else {
                    this.switchTab('goithau');
                }
                break;
        }
    }

    updateNguonVonFieldState(planId) {
        const gtNguonVon = document.getElementById('gt-nguonvon');
        if (!gtNguonVon) return;

        if (planId) {
            const kh = this.model.state.kehoach.find(k => k.id === planId);
            if (kh && kh.loaiHinhMuaSam === 'Dự án') {
                if (kh.nguonVon) {
                    gtNguonVon.value = kh.nguonVon;
                }
                gtNguonVon.setAttribute('readonly', 'true');
                gtNguonVon.style.pointerEvents = 'none';
                gtNguonVon.style.background = 'var(--neutral-soft)';
                gtNguonVon.style.cursor = 'not-allowed';
                return;
            }
        }
        gtNguonVon.removeAttribute('readonly');
        gtNguonVon.style.pointerEvents = 'auto';
        gtNguonVon.style.background = '';
        gtNguonVon.style.cursor = 'auto';
    }

    setupConditionalUI() {
        const statusSelect = document.getElementById('gt-trangthai');
        const phanLoSelect = document.getElementById('gt-phanlo');

        if (statusSelect) {
            statusSelect.addEventListener('change', () => {
                this.updateAwardedContractorUI();
                this.updatePackageFieldsVisibility();
            });
        }
        if (phanLoSelect) {
            phanLoSelect.addEventListener('change', () => {
                this.updateAwardedContractorUI();
                this.updatePackageFieldsVisibility();
            });
        }
        const linhVucSelect = document.getElementById('gt-linhvuc');
        if (linhVucSelect) {
            linhVucSelect.addEventListener('change', () => {
                this.updatePackageFieldsVisibility();
            });
        }

        const khCdtSelect = document.getElementById('kh-chudautuid');
        if (khCdtSelect) {
            khCdtSelect.addEventListener('change', (e) => {
                if (e.target.value === '__NEW_INVESTOR__') {
                    this.editChuDauTu(null);
                    e.target.value = '';
                }
            });
        }

        const gtKeHoachSelect = document.getElementById('gt-kehoachid');
        if (gtKeHoachSelect) {
            gtKeHoachSelect.addEventListener('change', (e) => {
                this.updateNguonVonFieldState(e.target.value);
            });
        }

        const ntLoaiSelect = document.getElementById('nt-loai');
        if (ntLoaiSelect) {
            ntLoaiSelect.addEventListener('change', () => {
                const singleSection = document.getElementById('nt-single-details');
                const jvSection = document.getElementById('nt-joint-venture-details');
                if (ntLoaiSelect.value === 'Liên danh') {
                    singleSection.style.display = 'none';
                    jvSection.style.display = 'block';
                    const membersList = document.getElementById('nt-joint-venture-members-list');
                    if (membersList && membersList.children.length === 0) {
                        this.addJointVentureMemberCard();
                        this.addJointVentureMemberCard();
                    }
                } else {
                    singleSection.style.display = 'grid';
                    jvSection.style.display = 'none';
                }
            });
        }
    }

    setupFileUploads() {
        const handleChuyenGiaFile = (file, type) => {
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                this.view.customAlert('Tệp không hợp lệ', 'Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG, WEBP).', 'alert-triangle');
                return;
            }
            if (file.size > 3 * 1024 * 1024) {
                this.view.customAlert('Tệp quá lớn', 'Dung lượng ảnh quá lớn. Vui lòng tải lên ảnh dưới 3MB để hệ thống lưu trữ tối ưu.', 'alert-triangle');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                if (type === 'cert') {
                    this.tempChuyenGiaImageBase64 = e.target.result;
                    const previewContainer = document.getElementById('cg-preview-container');
                    const previewImg = document.getElementById('cg-anh-preview');
                    const uploadZone = document.getElementById('cg-upload-zone');

                    previewImg.src = e.target.result;
                    previewContainer.style.display = 'flex';
                    uploadZone.style.display = 'none';
                } else if (type === 'signature') {
                    this.tempChuyenGiaSignatureBase64 = e.target.result;
                    const previewContainer = document.getElementById('cg-preview-container-chuky');
                    const previewImg = document.getElementById('cg-anh-preview-chuky');
                    const uploadZone = document.getElementById('cg-upload-zone-chuky');

                    previewImg.src = e.target.result;
                    previewContainer.style.display = 'flex';
                    uploadZone.style.display = 'none';
                }
            };
            reader.readAsDataURL(file);
        };

        const uploadZone = document.getElementById('cg-upload-zone');
        const fileInput = document.getElementById('cg-anhchungchi');
        const previewContainer = document.getElementById('cg-preview-container');
        const previewImg = document.getElementById('cg-anh-preview');
        const removeBtn = document.getElementById('btn-cg-remove-file');

        if (uploadZone && fileInput) {
            uploadZone.addEventListener('click', () => fileInput.click());
            uploadZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadZone.classList.add('dragover');
            });
            uploadZone.addEventListener('dragleave', () => {
                uploadZone.classList.remove('dragover');
            });
            uploadZone.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadZone.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) {
                    handleChuyenGiaFile(e.dataTransfer.files[0], 'cert');
                }
            });
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    handleChuyenGiaFile(e.target.files[0], 'cert');
                }
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.tempChuyenGiaImageBase64 = '';
                fileInput.value = '';
                previewImg.src = '';
                previewContainer.style.display = 'none';
                uploadZone.style.display = 'flex';
            });
        }

        const uploadZoneChuky = document.getElementById('cg-upload-zone-chuky');
        const fileInputChuky = document.getElementById('cg-anhchuky');
        const previewContainerChuky = document.getElementById('cg-preview-container-chuky');
        const previewImgChuky = document.getElementById('cg-anh-preview-chuky');
        const removeBtnChuky = document.getElementById('btn-cg-remove-file-chuky');

        if (uploadZoneChuky && fileInputChuky) {
            uploadZoneChuky.addEventListener('click', () => fileInputChuky.click());
            uploadZoneChuky.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadZoneChuky.classList.add('dragover');
            });
            uploadZoneChuky.addEventListener('dragleave', () => {
                uploadZoneChuky.classList.remove('dragover');
            });
            uploadZoneChuky.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadZoneChuky.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) {
                    handleChuyenGiaFile(e.dataTransfer.files[0], 'signature');
                }
            });
            fileInputChuky.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    handleChuyenGiaFile(e.target.files[0], 'signature');
                }
            });
        }

        if (removeBtnChuky) {
            removeBtnChuky.addEventListener('click', (e) => {
                e.stopPropagation();
                this.tempChuyenGiaSignatureBase64 = '';
                fileInputChuky.value = '';
                previewImgChuky.src = '';
                previewContainerChuky.style.display = 'none';
                uploadZoneChuky.style.display = 'flex';
            });
        }
    }

    setupActionListeners() {
        // Debounce helper — tránh re-render bảng mỗi lần gõ phím, chỉ render sau 300ms dừng gõ
        const debounce = (fn, ms = 300) => {
            let timer;
            return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
        };

        document.getElementById('search-kehoach').addEventListener('input', debounce(() => {
            this.model.currentPage.kehoach = 1;
            this.view.renderKeHoachTable();
        }));
        document.getElementById('search-goithau').addEventListener('input', debounce(() => {
            this.model.currentPage.goithau = 1;
            this.view.renderGoiThauTable();
        }));
        document.getElementById('search-chudautu').addEventListener('input', debounce(() => {
            this.model.currentPage.chudautu = 1;
            this.view.renderChuDauTuTable();
        }));
        document.getElementById('search-nhathau').addEventListener('input', debounce(() => {
            this.model.currentPage.nhathau = 1;
            this.view.renderNhaThauTable();
        }));
        document.getElementById('search-chuyengia').addEventListener('input', debounce(() => {
            this.model.currentPage.chuyengia = 1;
            this.view.renderChuyenGiaTable();
        }));
        const searchHopdong = document.getElementById('search-hopdong');
        if (searchHopdong) searchHopdong.addEventListener('input', debounce(() => {
            this.model.currentPage.hopdong = 1;
            this.view.renderHopDongTable();
        }));

        document.getElementById('filter-goithau-trangthai').addEventListener('change', () => {
            this.model.currentPage.goithau = 1;
            this.view.renderGoiThauTable();
        });
        document.getElementById('filter-goithau-hinhthuc').addEventListener('change', () => {
            this.model.currentPage.goithau = 1;
            this.view.renderGoiThauTable();
        });

        const syncBtn = document.getElementById('btn-force-sync');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.forceSyncData());
        }

        document.getElementById('btn-add-kehoach').addEventListener('click', () => this.editKeHoach(null));
        document.getElementById('btn-add-goithau').addEventListener('click', () => this.editGoiThau(null));
        document.getElementById('btn-add-chudautu').addEventListener('click', () => this.editChuDauTu(null));
        document.getElementById('btn-add-nhathau').addEventListener('click', () => this.editNhaThau(null));
        document.getElementById('btn-add-chuyengia').addEventListener('click', () => this.editChuyenGia(null));

        const btnAddHopdong = document.getElementById('btn-add-hopdong');
        if (btnAddHopdong) btnAddHopdong.addEventListener('click', () => this.editHopDong(null));

        const setupNumberAutoFormat = (inputId) => {
            const el = document.getElementById(inputId);
            if (!el) return;
            el.addEventListener('input', (e) => {
                const cursorPosition = e.target.selectionStart;
                const originalLength = e.target.value.length;

                const formatted = this.model.formatVND(e.target.value);
                e.target.value = formatted;

                const newLength = formatted.length;
                const newPosition = cursorPosition + (newLength - originalLength);
                e.target.setSelectionRange(newPosition, newPosition);
            });
        };

        setupNumberAutoFormat('kh-tongmuc');
        setupNumberAutoFormat('gt-gia');
        setupNumberAutoFormat('gt-giatrungthau');
        setupNumberAutoFormat('gt-giatribaomothau');
        setupNumberAutoFormat('hd-giatri');
        setupNumberAutoFormat('edit-pkg-price');

        const hsdthInput = document.getElementById('gt-hieuluchsdt');
        if (hsdthInput) {
            hsdthInput.addEventListener('input', () => {
                const hsdthVal = parseInt(hsdthInput.value) || 0;
                const bdmInput = document.getElementById('gt-hieuluchbaomothau');
                if (bdmInput) {
                    bdmInput.value = hsdthVal > 0 ? (hsdthVal + 30) : '';
                }
            });
        }

        const gtThoiGianDongThau = document.getElementById('gt-thoigiandongthau');
        if (gtThoiGianDongThau) {
            gtThoiGianDongThau.addEventListener('change', () => this.validateGiaHanRealtime());
            gtThoiGianDongThau.addEventListener('input', () => this.validateGiaHanRealtime());
        }

        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.getAttribute('data-close');
                this.closeModal(modalId);
            });
        });

        // Set up forms submits
        document.getElementById('form-kehoach').addEventListener('submit', (e) => this.handleKeHoachSubmit(e));
        document.getElementById('form-goithau').addEventListener('submit', (e) => this.handleGoiThauSubmit(e));
        const formPhathanh = document.getElementById('form-phathanh-hsmt');
        if (formPhathanh) {
            formPhathanh.addEventListener('submit', (e) => this.handlePhatHanhHsmtSubmit(e));
        }

        const phathanhGiatribaomothau = document.getElementById('phathanh-giatribaomothau');
        if (phathanhGiatribaomothau) {
            phathanhGiatribaomothau.addEventListener('input', (e) => {
                const cursorPosition = e.target.selectionStart;
                const originalLength = e.target.value.length;
                e.target.value = this.model.formatVND(e.target.value);
                const newLength = e.target.value.length;
                e.target.setSelectionRange(cursorPosition + (newLength - originalLength), cursorPosition + (newLength - originalLength));
            });
        }

        const gtHinhThucSelect = document.getElementById('gt-hinhthuc');
        const gtPhuongThucSelect = document.getElementById('gt-phuongthuc');
        const gtPhuongThucContainer = document.getElementById('gt-phuongthuc-container');
        const gtLinhVucSelect = document.getElementById('gt-linhvuc');

        if (gtHinhThucSelect && gtPhuongThucSelect && gtPhuongThucContainer) {
            const handleHinhThucChange = () => {
                const val = gtHinhThucSelect.value;
                const linhVucVal = gtLinhVucSelect ? gtLinhVucSelect.value : '';

                if (!val) {
                    gtPhuongThucContainer.style.display = 'none';
                    gtPhuongThucSelect.removeAttribute('required');
                } else {
                    gtPhuongThucContainer.style.display = 'flex';
                    gtPhuongThucSelect.setAttribute('required', 'true');

                    if (linhVucVal === 'Tư vấn') {
                        if (val === 'Chỉ định thầu rút gọn') {
                            gtPhuongThucSelect.value = 'Không có';
                            gtPhuongThucSelect.disabled = true;
                        } else {
                            gtPhuongThucSelect.value = 'Một giai đoạn hai túi hồ sơ';
                            gtPhuongThucSelect.disabled = true;
                        }
                    } else {
                        if (val === 'Chào hàng cạnh tranh') {
                            gtPhuongThucSelect.value = 'Một giai đoạn một túi hồ sơ';
                            gtPhuongThucSelect.disabled = true;
                        } else if (val === 'Chỉ định thầu rút gọn') {
                            gtPhuongThucSelect.value = 'Không có';
                            gtPhuongThucSelect.disabled = true;
                        } else {
                            gtPhuongThucSelect.disabled = false;
                        }
                    }
                }

                // Toggle Tổ chuyên gia và Tổ thẩm định theo Hình thức
                const toChuyenGiaSection = document.getElementById('to-chuyengia-section');
                const toThamDinhSection = document.getElementById('to-thamdinh-section');
                if (toChuyenGiaSection && toThamDinhSection) {
                    if (val === 'Chào hàng cạnh tranh') {
                        toChuyenGiaSection.style.display = 'flex';
                        toThamDinhSection.style.display = 'none';
                    } else if (val === 'Đấu thầu rộng rãi' || val === 'Đấu thầu hạn chế' || val === 'Chỉ định thầu') {
                        toChuyenGiaSection.style.display = 'flex';
                        toThamDinhSection.style.display = 'flex';
                    } else if (val === 'Chỉ định thầu rút gọn' || val === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                        toChuyenGiaSection.style.display = 'none';
                        toThamDinhSection.style.display = 'none';
                    } else {
                        toChuyenGiaSection.style.display = 'flex';
                        toThamDinhSection.style.display = 'none';
                    }
                }
            };
            gtHinhThucSelect.addEventListener('change', handleHinhThucChange);
            this.handleHinhThucChange = handleHinhThucChange;
        }

        const gtTuyChonContainer = document.getElementById('gt-tuychonmuathem-container');
        const gtPhanLoContainer = document.getElementById('gt-phanlo-container');
        const gtPhanLoTableContainer = document.getElementById('gt-phanlo-table-container');

        if (gtLinhVucSelect && gtHinhThucSelect && gtPhuongThucSelect && gtPhuongThucContainer) {
            const handleLinhVucChange = () => {
                const val = gtLinhVucSelect.value;
                const options = gtHinhThucSelect.querySelectorAll('option');
                if (val === 'Tư vấn') {
                    options.forEach(opt => {
                        const optVal = opt.value;
                        if (optVal === 'Đấu thầu rộng rãi' || optVal === 'Chỉ định thầu rút gọn' || optVal === '' || optVal === 'Tất cả hình thức') {
                            opt.style.display = '';
                        } else {
                            opt.style.display = 'none';
                        }
                    });

                    if (gtHinhThucSelect.value !== 'Đấu thầu rộng rãi' && gtHinhThucSelect.value !== 'Chỉ định thầu rút gọn') {
                        gtHinhThucSelect.value = 'Đấu thầu rộng rãi';
                    }
                    gtHinhThucSelect.disabled = false;
                } else {
                    options.forEach(opt => opt.style.display = '');
                    gtHinhThucSelect.disabled = false;
                }

                if (this.handleHinhThucChange) {
                    this.handleHinhThucChange();
                }

                if (gtTuyChonContainer) {
                    gtTuyChonContainer.style.display = 'flex';
                    if (this.handleTuyChonMuaThemChange) this.handleTuyChonMuaThemChange();
                }
                if (gtPhanLoContainer) {
                    gtPhanLoContainer.style.display = 'flex';
                    if (this.handlePhanLoChange) this.handlePhanLoChange();
                }
            };
            gtLinhVucSelect.addEventListener('change', handleLinhVucChange);
            this.handleLinhVucChange = handleLinhVucChange;
        }

        const gtTuyChonMuaThemSelect = document.getElementById('gt-tuychonmuathem');
        const gtTuyChonMuaThemTableContainer = document.getElementById('gt-tuychonmuathem-table-container');
        if (gtTuyChonMuaThemSelect && gtTuyChonMuaThemTableContainer) {
            const handleTuyChonMuaThemChange = () => {
                if (gtTuyChonMuaThemSelect.value === 'Có') {
                    gtTuyChonMuaThemTableContainer.style.display = 'block';
                    const tbody = document.getElementById('tuychonmuathem-tbody');
                    if (tbody && tbody.children.length === 0) {
                        this.addTuyChonMuaThemRow();
                    }
                } else {
                    gtTuyChonMuaThemTableContainer.style.display = 'none';
                }
            };
            gtTuyChonMuaThemSelect.addEventListener('change', handleTuyChonMuaThemChange);
            this.handleTuyChonMuaThemChange = handleTuyChonMuaThemChange;
        }

        const btnThemTuyChon = document.getElementById('btn-them-tuychonmuathem');
        if (btnThemTuyChon) {
            btnThemTuyChon.addEventListener('click', () => this.addTuyChonMuaThemRow());
        }

        const gtPhanLoSelect = document.getElementById('gt-phanlo');
        if (gtPhanLoSelect && gtPhanLoTableContainer) {
            const handlePhanLoChange = () => {
                if (gtPhanLoSelect.value === 'Có') {
                    gtPhanLoTableContainer.style.display = 'block';
                    const tbody = document.getElementById('phanlo-tbody');
                    if (tbody && tbody.children.length === 0) {
                        this.addPhanLoRow();
                    }
                } else {
                    gtPhanLoTableContainer.style.display = 'none';
                }
            };
            gtPhanLoSelect.addEventListener('change', handlePhanLoChange);
            this.handlePhanLoChange = handlePhanLoChange;
        }

        const btnThemPhanLo = document.getElementById('btn-them-phanlo');
        if (btnThemPhanLo) {
            btnThemPhanLo.addEventListener('click', () => this.addPhanLoRow());
        }

        const btnThemGiaHan = document.getElementById('btn-them-giahan');
        if (btnThemGiaHan) {
            btnThemGiaHan.addEventListener('click', () => this.addGiaHanRow());
        }

        const btnThemYeuCau = document.getElementById('btn-them-yeucaulamro');
        if (btnThemYeuCau) {
            btnThemYeuCau.addEventListener('click', () => this.addYeuCauLamRoRow());
        }

        const btnThemTraLoi = document.getElementById('btn-them-traloilamro');
        if (btnThemTraLoi) {
            btnThemTraLoi.addEventListener('click', () => this.addTraLoiLamRoRow());
        }

        const btnTemplatePhanLo = document.getElementById('btn-template-phanlo');
        const btnImportPhanLo = document.getElementById('btn-import-excel-phanlo');
        const inputImportPhanLo = document.getElementById('excel-file-input-phanlo');

        const downloadInlineTemplate = (type, btn) => {
            if (!type || !btn) return;
            btn.disabled = true;
            const originalText = btn.innerHTML;
            btn.innerHTML = 'Đang tải...';

            fetch(`/api/export-excel-template/${type}`, {
                headers: {
                    'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                    'X-Username': sessionStorage.getItem('bf_username') || ''
                }
            })
                .then(res => {
                    if (!res.ok) throw new Error('Không thể tải tệp mẫu');
                    return res.blob();
                })
                .then(blob => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Mau_nhap_lieu_${type}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                })
                .catch(err => this.view.customAlert('Lỗi tải mẫu', 'Lỗi tải Excel mẫu: ' + err.message, 'x-circle'))
                .finally(() => {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                });
        };

        if (btnTemplatePhanLo) {
            btnTemplatePhanLo.addEventListener('click', () => downloadInlineTemplate('phanlo', btnTemplatePhanLo));
        }

        if (btnImportPhanLo && inputImportPhanLo) {
            btnImportPhanLo.addEventListener('click', () => inputImportPhanLo.click());
            inputImportPhanLo.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.handleInlineExcelUpload(e.target.files[0], 'phanlo');
                    inputImportPhanLo.value = '';
                }
            });
        }

        const btnTemplateTuyChon = document.getElementById('btn-template-tuychonmuathem');
        const btnImportTuyChon = document.getElementById('btn-import-excel-tuychonmuathem');
        const inputImportTuyChon = document.getElementById('excel-file-input-tuychonmuathem');

        if (btnTemplateTuyChon) {
            btnTemplateTuyChon.addEventListener('click', () => downloadInlineTemplate('tuychonmuathem', btnTemplateTuyChon));
        }

        if (btnImportTuyChon && inputImportTuyChon) {
            btnImportTuyChon.addEventListener('click', () => inputImportTuyChon.click());
            inputImportTuyChon.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.handleInlineExcelUpload(e.target.files[0], 'tuychonmuathem');
                    inputImportTuyChon.value = '';
                }
            });
        }

        const gtQuaMangSelect = document.getElementById('gt-quatmang');
        const gtTrongNuocSelect = document.getElementById('gt-trongnuocquocte');
        if (gtQuaMangSelect && gtTrongNuocSelect) {
            const handleQuaMangChange = () => {
                if (gtQuaMangSelect.value === 'Qua mạng') {
                    gtTrongNuocSelect.value = 'Trong nước';
                    gtTrongNuocSelect.disabled = true;
                } else {
                    gtTrongNuocSelect.disabled = false;
                }
            };
            gtQuaMangSelect.addEventListener('change', handleQuaMangChange);
            this.handleQuaMangChange = handleQuaMangChange;
        }

        document.getElementById('form-chudautu').addEventListener('submit', (e) => this.handleChuDauTuSubmit(e));
        document.getElementById('form-nhathau').addEventListener('submit', (e) => this.handleNhaThauSubmit(e));
        document.getElementById('form-chuyengia').addEventListener('submit', (e) => this.handleChuyenGiaSubmit(e));

        const formHopDong = document.getElementById('form-hopdong');
        if (formHopDong) {
            formHopDong.addEventListener('submit', (e) => this.handleHopDongSubmit(e));
        }

        document.querySelectorAll('.btn-import-excel').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.getAttribute('data-type');
                this.openExcelImportModal(type);
            });
        });
    }

    async closeModal(modalId) {
        if (modalId === 'modal-goithau' && this.packageWizard.active) {
            const confirmed = await this.view.customConfirm(
                'Xác nhận hủy',
                'Hệ thống đang trong quá trình thiết lập các gói thầu cho kế hoạch mới. Bạn có chắc chắn muốn hủy bỏ? Các gói thầu đã nhập trước đó vẫn được lưu lại.'
            );
            if (!confirmed) {
                return;
            }
            this.packageWizard.active = false;
            const planSelect = document.getElementById('gt-kehoachid');
            if (planSelect) planSelect.disabled = false;
        }

        if (modalId === 'modal-plan-breakdown') {
            // Rollback changes because they closed/cancelled the breakdown modal without saving
            if (this.backupKeHoachState) {
                this.model.state.kehoach = this.backupKeHoachState;
                this.backupKeHoachState = null;
            }
            if (this.backupGoiThauState) {
                this.model.state.goithau = this.backupGoiThauState;
                this.backupGoiThauState = null;
            }
            this.tempPlanData = null;
            this.tempPlanAction = null;

            this.model.persistData('kehoach');
            this.model.persistData('goithau');

            this.view.renderKeHoachTable();
            this.view.renderGoiThauTable();
            this.autoSync();
        }

        this.view.closeModal(modalId);

        // Sync URL when modal closes
        if (modalId === 'modal-kehoach') {
            this.switchTab('kehoach', null, true);
        } else if (modalId === 'modal-goithau') {
            this.switchTab('goithau', null, true);
        } else if (modalId === 'modal-chudautu') {
            this.switchTab('chudautu', null, true);
        } else if (modalId === 'modal-nhathau') {
            this.switchTab('nhathau', null, true);
        } else if (modalId === 'modal-chuyengia') {
            this.switchTab('chuyengia', null, true);
        } else if (modalId === 'modal-hopdong') {
            this.switchTab('hopdong', null, true);
        }
    }

    autoSync() {
        return fetch('/api/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                'X-Username': sessionStorage.getItem('bf_username') || '',
                'X-Active-Org': encodeURIComponent(localStorage.getItem('bf_active_org') || '')
            },
            body: JSON.stringify(this.model.state)
        })
            .then(res => {
                if (res.ok) {
                    return res.json();
                }
                throw new Error("Sync failed");
            })
            .then(data => {
                if (data.timestamp) {
                    localStorage.setItem('bf_last_sync_timestamp', data.timestamp);
                }
                // Xóa các record mồ côi (parent đã bị xóa trên server) khỏi local state
                if (Array.isArray(data.orphanedIds) && data.orphanedIds.length > 0) {
                    let stateChanged = false;
                    for (const orphan of data.orphanedIds) {
                        const { table, id } = orphan;
                        // Map table_name -> state key
                        const tableToStateKey = {
                            'thong_tin_mo_thau': 'thongtinmothau',
                            'phan_cong_nhan_su': 'assignments',
                            'hop_dong_goi_thau': null, // junction table, no direct state key
                        };
                        const stateKey = tableToStateKey.hasOwnProperty(table) ? tableToStateKey[table] : table;
                        if (stateKey && Array.isArray(this.model.state[stateKey])) {
                            const before = this.model.state[stateKey].length;
                            this.model.state[stateKey] = this.model.state[stateKey].filter(item => String(item.id) !== String(id));
                            if (this.model.state[stateKey].length < before) {
                                this.model.persistData(stateKey);
                                stateChanged = true;
                            }
                        }
                    }
                    if (stateChanged) {
                        console.info(`[Sync] Đã xóa ${data.orphanedIds.length} record mồ côi khỏi IndexedDB:`, data.orphanedIds);
                    }
                }
            })
            .catch(err => console.error("Error auto sync:", err));
    }


    handleInlineExcelUpload(file, type) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('type', type);

        const tbody = document.getElementById(`${type}-tbody`);
        const originalHTML = tbody.innerHTML;
        tbody.innerHTML = `<tr><td colspan="${type === 'phanlo' ? 5 : 6}" style="text-align: center; padding: 20px; font-weight: bold; color: var(--primary);">
            Đang tải dữ liệu và phân tích file Excel...
        </td></tr>`;

        fetch('/api/import-excel', {
            method: 'POST',
            body: fd
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    tbody.innerHTML = '';
                    const validRows = data.rows.filter(r => r._valid);
                    if (validRows.length === 0) {
                        this.view.customAlert('Không có dữ liệu', 'Không tìm thấy dòng dữ liệu hợp lệ nào trong tệp Excel!', 'alert-triangle');
                        tbody.innerHTML = originalHTML;
                        return;
                    }

                    validRows.forEach(row => {
                        delete row._valid;
                        delete row._comment;
                        if (type === 'phanlo') {
                            this.addPhanLoRow(row);
                        } else if (type === 'tuychonmuathem') {
                            this.addTuyChonMuaThemRow(row);
                        }
                    });
                    this.view.customAlert('Nhập thành công', `Đã nhập thành công ${validRows.length} dòng dữ liệu từ Excel vào bảng!`, 'check-circle');
                } else {
                    this.view.customAlert('Lỗi phân tích', 'Lỗi phân tích Excel: ' + (data.error || 'Không rõ nguyên nhân'), 'x-circle');
                    tbody.innerHTML = originalHTML;
                }
            })
            .catch(err => {
                this.view.customAlert('Lỗi kết nối', 'Lỗi kết nối: ' + err.message, 'x-circle');
                tbody.innerHTML = originalHTML;
            });
    }

    updatePackageFieldsVisibility() {
        const trangThai = document.getElementById('gt-trangthai')?.value;
        const formGoiThau = document.getElementById('form-goithau');
        const originalStatus = formGoiThau?.getAttribute('data-original-status') || '';

        const statusOrder = ['Chuẩn bị', 'Đang mời thầu', 'Đã mở thầu', 'Đang chấm thầu', 'Đã có kết quả', 'Hủy thầu'];
        const currentIdx = statusOrder.indexOf(trangThai);
        const originalIdx = statusOrder.indexOf(originalStatus);

        // Disable status options earlier than originalStatus to enforce unidirectional progression
        // When adding new (originalIdx < 0), always reset all options to enabled
        const statusSelect = document.getElementById('gt-trangthai');
        if (statusSelect) {
            statusSelect.querySelectorAll('option').forEach(opt => {
                const optVal = opt.value;
                const optIdx = statusOrder.indexOf(optVal);
                if (originalIdx >= 0 && optIdx >= 0 && optIdx < originalIdx) {
                    // Edit mode: disable options that are earlier than current status
                    opt.disabled = true;
                } else {
                    // New mode (originalIdx < 0): enable all options
                    // Edit mode: enable options at or after current status
                    opt.disabled = false;
                }
            });
        }

        // The 15 core fields that cannot be edited and are hidden/disabled in Đang mời thầu and later statuses
        const lockedFields = [
            'gt-kehoachid',
            'gt-ten',
            'gt-gia',
            'gt-thoigian',
            'gt-linhvuc',
            'gt-hinhthuc',
            'gt-phuongthuc',
            'gt-quatmang',
            'gt-trongnuocquocte',
            'gt-tuychonmuathem',
            'gt-phanlo',
            'gt-nguonvon',
            'gt-loaihopdong',
            'gt-thoigiantochuc',
            'gt-thoigianbatdautochuc'
        ];

        const isLocked = originalIdx >= 1; // Transitioned to Đang mời thầu or later
        lockedFields.forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            const formGroup = input.closest('.form-group');
            if (isLocked) {
                if (formGroup) formGroup.style.display = 'none';
                input.disabled = true;
            } else {
                input.disabled = false;
                // Re-enforce disabled rules for gt-phuongthuc if needed
                if (id === 'gt-phuongthuc') {
                    const lv = document.getElementById('gt-linhvuc')?.value;
                    const ht = document.getElementById('gt-hinhthuc')?.value;
                    if (lv === 'Tư vấn' || ht === 'Chào hàng cạnh tranh' || ht === 'Chỉ định thầu rút gọn') {
                        input.disabled = true;
                    }
                }
                // Restore visibility for non-conditional fields if unlocked
                const nonConditional = [
                    'gt-kehoachid', 'gt-ten', 'gt-gia', 'gt-thoigian', 'gt-linhvuc', 'gt-hinhthuc',
                    'gt-quatmang', 'gt-trongnuocquocte', 'gt-nguonvon', 'gt-loaihopdong', 'gt-thoigiantochuc', 'gt-thoigianbatdautochuc',
                    'gt-tuychonmuathem', 'gt-phanlo'
                ];
                if (nonConditional.includes(id) && formGroup) {
                    formGroup.style.display = 'flex';
                }
            }
        });

        // Hide table containers if locked
        const tuyChonTable = document.getElementById('gt-tuychonmuathem-table-container');
        const phanLoTable = document.getElementById('gt-phanlo-table-container');
        if (isLocked) {
            if (tuyChonTable) tuyChonTable.style.display = 'none';
            if (phanLoTable) phanLoTable.style.display = 'none';
        }

        const fields = [
            { id: 'gt-soquyetdinh', required: true, label: 'Số QĐ phê duyệt' },
            { id: 'gt-ngayquyetdinh', required: true, label: 'Ngày QĐ phê duyệt' },
            { id: 'gt-thoigiandangtai', required: true, label: 'Thời gian đăng tải thông báo' },
            { id: 'gt-thoigiandongthau', required: true, label: 'Thời gian đóng thầu' },
            { id: 'gt-thoigianmothau', required: (trangThai === 'Đã mở thầu' || trangThai === 'Đang chấm thầu' || trangThai === 'Đã có kết quả' || trangThai === 'Hủy thầu'), label: 'Thời gian mở thầu' }
        ];

        fields.forEach(f => {
            const input = document.getElementById(f.id);
            if (!input) return;
            const formGroup = input.closest('.form-group');
            if (!formGroup) return;

            const label = formGroup.querySelector('label');

            if (trangThai === 'Chuẩn bị') {
                formGroup.style.display = 'none';
                input.removeAttribute('required');
                if (label) {
                    label.innerHTML = f.label;
                }
            } else if (trangThai === 'Đang mời thầu' && f.id === 'gt-thoigianmothau') {
                formGroup.style.display = 'none';
                input.removeAttribute('required');
            } else {
                formGroup.style.display = 'flex';
                if (f.required) {
                    input.setAttribute('required', 'true');
                    if (label && !label.querySelector('.required')) {
                        label.innerHTML = `${f.label} <span class="required">*</span>`;
                    }
                } else {
                    input.removeAttribute('required');
                    if (label) {
                        label.innerHTML = f.label;
                    }
                }
            }
        });

        const maInput = document.getElementById('gt-ma');
        if (maInput) {
            const formGroup = maInput.closest('.form-group');
            const label = formGroup?.querySelector('label');
            if (trangThai === 'Chuẩn bị') {
                maInput.removeAttribute('required');
                if (label) label.innerHTML = 'Mã thông báo mời thầu';
            } else {
                maInput.setAttribute('required', 'true');
                if (label && !label.querySelector('.required')) {
                    label.innerHTML = 'Mã thông báo mời thầu <span class="required">*</span>';
                }
            }
        }

        const giaHanContainer = document.getElementById('gt-giahan-container');
        if (giaHanContainer) {
            giaHanContainer.style.display = trangThai === 'Đang mời thầu' ? 'flex' : 'none';
        }

        const yeuCauLamRoContainer = document.getElementById('gt-yeucaulamro-container');
        const traLoiLamRoContainer = document.getElementById('gt-traloilamro-container');
        const showClarifications = trangThai !== 'Chuẩn bị';

        if (yeuCauLamRoContainer) {
            yeuCauLamRoContainer.style.display = showClarifications ? 'flex' : 'none';
        }
        if (traLoiLamRoContainer) {
            traLoiLamRoContainer.style.display = showClarifications ? 'flex' : 'none';
        }

        // Logic ẩn/hiện và thuộc tính required/readonly cho 3 trường mới
        const linhVuc = document.getElementById('gt-linhvuc')?.value || '';
        const phanLo = document.getElementById('gt-phanlo')?.value || '';
        const mainBaoDamInput = document.getElementById('gt-giatribaomothau');
        const hieulucHsdtInput = document.getElementById('gt-hieuluchsdt');
        const hieulucBaoDamInput = document.getElementById('gt-hieuluchbaomothau');

        const containerBaoDam = document.getElementById('gt-giatribaomothau-container');
        const containerHsdt = document.getElementById('gt-hieuluchsdt-container');
        const containerHlBaoDam = document.getElementById('gt-hieuluchbaomothau-container');

        const thBaoDam = document.getElementById('th-baodam-phanlo');

        if (trangThai === 'Chuẩn bị') {
            if (containerBaoDam) containerBaoDam.style.display = 'none';
            if (containerHsdt) containerHsdt.style.display = 'none';
            if (containerHlBaoDam) containerHlBaoDam.style.display = 'none';

            if (mainBaoDamInput) mainBaoDamInput.removeAttribute('required');
            if (hieulucHsdtInput) hieulucHsdtInput.removeAttribute('required');

            if (thBaoDam) thBaoDam.style.display = 'none';
            document.querySelectorAll('.col-baodam-phanlo-cell').forEach(cell => {
                cell.style.display = 'none';
                const input = cell.querySelector('input');
                if (input) input.removeAttribute('required');
            });
        } else {
            // Đang mời thầu hoặc muộn hơn
            if (containerHsdt) containerHsdt.style.display = 'flex';
            if (hieulucHsdtInput) hieulucHsdtInput.setAttribute('required', 'true');

            if (linhVuc === 'Tư vấn') {
                if (containerBaoDam) containerBaoDam.style.display = 'none';
                if (containerHlBaoDam) containerHlBaoDam.style.display = 'none';

                if (mainBaoDamInput) mainBaoDamInput.removeAttribute('required');

                if (thBaoDam) thBaoDam.style.display = 'none';
                document.querySelectorAll('.col-baodam-phanlo-cell').forEach(cell => {
                    cell.style.display = 'none';
                    const input = cell.querySelector('input');
                    if (input) input.removeAttribute('required');
                });
            } else {
                if (containerBaoDam) containerBaoDam.style.display = 'flex';
                if (containerHlBaoDam) containerHlBaoDam.style.display = 'flex';

                if (mainBaoDamInput) mainBaoDamInput.setAttribute('required', 'true');

                if (phanLo === 'Có') {
                    if (mainBaoDamInput) {
                        mainBaoDamInput.setAttribute('readonly', 'true');
                        mainBaoDamInput.style.background = 'var(--neutral-soft)';
                        mainBaoDamInput.style.cursor = 'not-allowed';
                    }

                    if (thBaoDam) thBaoDam.style.display = '';
                    document.querySelectorAll('.col-baodam-phanlo-cell').forEach(cell => {
                        cell.style.display = '';
                        const input = cell.querySelector('input');
                        if (input) input.setAttribute('required', 'true');
                    });
                    this.recalculateTotalLotSecurities();
                } else {
                    if (mainBaoDamInput) {
                        mainBaoDamInput.removeAttribute('readonly');
                        mainBaoDamInput.style.background = '';
                        mainBaoDamInput.style.cursor = 'auto';
                    }

                    if (thBaoDam) thBaoDam.style.display = 'none';
                    document.querySelectorAll('.col-baodam-phanlo-cell').forEach(cell => {
                        cell.style.display = 'none';
                        const input = cell.querySelector('input');
                        if (input) input.removeAttribute('required');
                    });
                }
            }
        }
    }

    recalculateTotalLotSecurities() {
        const phanLo = document.getElementById('gt-phanlo')?.value;
        const trangThai = document.getElementById('gt-trangthai')?.value;
        const linhVuc = document.getElementById('gt-linhvuc')?.value;
        if (phanLo === 'Có' && linhVuc !== 'Tư vấn' && trangThai !== 'Chuẩn bị') {
            let sum = 0;
            document.querySelectorAll('#phanlo-tbody tr').forEach(tr => {
                const baodamInput = tr.querySelector('.pl-baodam-input');
                if (baodamInput) {
                    sum += this.model.parseVND(baodamInput.value);
                }
            });
            const mainBaoDamInput = document.getElementById('gt-giatribaomothau');
            if (mainBaoDamInput) {
                mainBaoDamInput.value = this.model.formatVND(sum);
            }
        }
    }

    updateAwardedContractorUI(defaultDataList = null) {
        const trangThai = document.getElementById('gt-trangthai')?.value;
        const phanLo = document.getElementById('gt-phanlo')?.value;
        const condBlock = document.getElementById('conditional-awarded-contractor');
        const singleContainer = document.getElementById('awarded-single-container');
        const multiContainer = document.getElementById('awarded-multi-container');

        if (!condBlock) return;

        if (trangThai !== 'Đã có kết quả') {
            condBlock.style.display = 'none';
            document.getElementById('gt-nhathautrungthauid')?.removeAttribute('required');
            document.getElementById('gt-giatrungthau')?.removeAttribute('required');
            document.getElementById('gt-thoigian-goithau')?.removeAttribute('required');
            document.getElementById('gt-thoigian-hopdong')?.removeAttribute('required');
            return;
        }

        condBlock.style.display = 'block';

        if (phanLo === 'Có') {
            singleContainer.style.display = 'none';
            multiContainer.style.display = 'block';

            document.getElementById('gt-nhathautrungthauid')?.removeAttribute('required');
            document.getElementById('gt-giatrungthau')?.removeAttribute('required');
            document.getElementById('gt-thoigian-goithau')?.removeAttribute('required');
            document.getElementById('gt-thoigian-hopdong')?.removeAttribute('required');

            const tbody = document.getElementById('awarded-phanlo-tbody');
            if (tbody) {
                const phanLoList = this._collectPhanLoRows();
                const currentInputsMap = {};
                tbody.querySelectorAll('tr').forEach(tr => {
                    const ten = tr.cells[0]?.textContent;
                    if (ten) {
                        currentInputsMap[ten] = {
                            nhaThauTrungThauId: tr.querySelector('.awarded-pl-nhathau')?.value || '',
                            giaTrungThau: this.model.parseVND(tr.querySelector('.awarded-pl-gia')?.value || ''),
                            thoiGianGoiThau: tr.querySelector('.awarded-pl-tggoithau')?.value || '',
                            thoiGianHopDong: tr.querySelector('.awarded-pl-tghopdong')?.value || ''
                        };
                    }
                });

                tbody.innerHTML = '';

                if (phanLoList.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 16px; color: var(--text-muted); font-weight: 600;">Vui lòng thêm danh sách phần lô ở trên trước.</td></tr>`;
                    return;
                }

                const nhathauOptions = this.model.state.nhathau.map(n => `<option value="${n.id}">${n.tenNhaThau}</option>`).join('');

                phanLoList.forEach((pl) => {
                    const row = document.createElement('tr');
                    let matchedData = null;
                    if (defaultDataList && defaultDataList.length > 0) {
                        matchedData = defaultDataList.find(d => d.tenPhanLo === pl.tenPhanLo);
                    }
                    if (!matchedData && currentInputsMap[pl.tenPhanLo]) {
                        matchedData = currentInputsMap[pl.tenPhanLo];
                    }

                    const selectedNt = matchedData?.nhaThauTrungThauId || '';
                    const giaTri = matchedData?.giaTrungThau ? this.model.formatVND(matchedData.giaTrungThau) : '';
                    const tgGoiThau = matchedData?.thoiGianGoiThau || '';
                    const tgHopDong = matchedData?.thoiGianHopDong || '';

                    row.innerHTML = `
                        <td style="font-weight: 600; font-size: 0.84rem; color: var(--text-main);">${pl.tenPhanLo}</td>
                        <td>
                            <select class="awarded-pl-nhathau" required style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-weight: 600;">
                                <option value="">-- Chọn Nhà thầu --</option>
                                ${nhathauOptions}
                            </select>
                        </td>
                        <td>
                            <input type="text" class="awarded-pl-gia input-gia" required value="${giaTri}" placeholder="Nhập giá trúng" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-weight: 600;">
                        </td>
                        <td>
                            <input type="text" class="awarded-pl-tggoithau" required value="${tgGoiThau}" placeholder="Ví dụ: 90 ngày" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-weight: 600;">
                        </td>
                        <td>
                            <input type="text" class="awarded-pl-tghopdong" required value="${tgHopDong}" placeholder="Ví dụ: 90 ngày" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-weight: 600;">
                        </td>
                    `;

                    const sel = row.querySelector('.awarded-pl-nhathau');
                    if (sel) sel.value = selectedNt;

                    const giaInput = row.querySelector('.awarded-pl-gia');
                    if (giaInput) {
                        giaInput.addEventListener('input', (e) => {
                            const cursorPosition = e.target.selectionStart;
                            const originalLength = e.target.value.length;
                            e.target.value = this.model.formatVND(e.target.value);
                            const newLength = e.target.value.length;
                            e.target.setSelectionRange(cursorPosition + (newLength - originalLength), cursorPosition + (newLength - originalLength));
                        });
                    }

                    tbody.appendChild(row);
                });
            }
        } else {
            singleContainer.style.display = 'block';
            multiContainer.style.display = 'none';

            document.getElementById('gt-nhathautrungthauid')?.setAttribute('required', 'true');
            document.getElementById('gt-giatrungthau')?.setAttribute('required', 'true');
            document.getElementById('gt-thoigian-goithau')?.setAttribute('required', 'true');
            document.getElementById('gt-thoigian-hopdong')?.setAttribute('required', 'true');
        }
    }

    _collectAwardedPhanLoRows() {
        const phanLo = document.getElementById('gt-phanlo')?.value;
        const trangThai = document.getElementById('gt-trangthai')?.value;
        if (phanLo !== 'Có' || trangThai !== 'Đã có kết quả') return [];

        const tbody = document.getElementById('awarded-phanlo-tbody');
        if (!tbody) return [];

        const rows = [];
        tbody.querySelectorAll('tr').forEach(tr => {
            const cells = tr.querySelectorAll('td');
            if (cells.length < 2) return;

            const tenPhanLo = cells[0].textContent;
            const nhaThauTrungThauId = tr.querySelector('.awarded-pl-nhathau')?.value || '';
            const giaTrungThau = this.model.parseVND(tr.querySelector('.awarded-pl-gia')?.value || '');
            const thoiGianGoiThau = tr.querySelector('.awarded-pl-tggoithau')?.value.trim() || '';
            const thoiGianHopDong = tr.querySelector('.awarded-pl-tghopdong')?.value.trim() || '';

            if (nhaThauTrungThauId || giaTrungThau > 0 || thoiGianGoiThau || thoiGianHopDong) {
                rows.push({
                    tenPhanLo,
                    nhaThauTrungThauId,
                    giaTrungThau,
                    thoiGianGoiThau,
                    thoiGianHopDong
                });
            }
        });
        return rows;
    }

    async forceSyncData(isBackground = false) {
        const syncBtn = document.getElementById('btn-force-sync');
        const syncIcon = document.getElementById('sync-icon');
        const syncStatusText = document.getElementById('sync-status-text');

        if (syncIcon) syncIcon.classList.add('anim-spin');
        if (syncStatusText) syncStatusText.textContent = 'Đang đồng bộ...';

        try {
            const since = localStorage.getItem('bf_last_sync_timestamp') || '0';
            const response = await fetch('/api/get-all-data?since=' + since, {
                headers: {
                    'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                    'X-Username': sessionStorage.getItem('bf_username') || '',
                    'X-Active-Org': encodeURIComponent(localStorage.getItem('bf_active_org') || '')
                }
            });
            if (response.ok) {
                const dbData = await response.json();

                this.model.useServerSidePagination = !!dbData.useServerSidePagination;

                if (since === '0' || dbData.useServerSidePagination) {
                    Object.keys(dbData).forEach(key => {
                        if (key !== 'deletions' && key !== 'useServerSidePagination' && key !== 'timestamp') {
                            this.model.state[key] = dbData[key];
                            this.model.persistData(key);
                        }
                    });
                } else {
                    Object.keys(dbData).forEach(key => {
                        if (key !== 'deletions' && key !== 'useServerSidePagination' && key !== 'timestamp' && Array.isArray(dbData[key])) {
                            const incoming = dbData[key];
                            incoming.forEach(item => {
                                const idx = this.model.state[key].findIndex(x => x.id === item.id);
                                if (idx !== -1) {
                                    this.model.state[key][idx] = item;
                                } else {
                                    this.model.state[key].push(item);
                                }
                            });
                            if (incoming.length > 0) {
                                this.model.db.putRecords(key, incoming).catch(e => console.error("Error storing records", e));
                            }
                        }
                    });

                    const deletions = dbData.deletions || [];
                    const deletionsByTable = {};
                    deletions.forEach(del => {
                        const key = del.table;
                        const id = del.id;
                        if (this.model.state[key]) {
                            this.model.state[key] = this.model.state[key].filter(x => x.id !== id);
                            if (!deletionsByTable[key]) {
                                deletionsByTable[key] = [];
                            }
                            deletionsByTable[key].push(id);
                        }
                    });
                    Object.keys(deletionsByTable).forEach(key => {
                        if (deletionsByTable[key].length > 0) {
                            this.model.db.deleteRecords(key, deletionsByTable[key]).catch(e => console.error("Error deleting records", e));
                        }
                    });
                }

                if (dbData.timestamp) {
                    localStorage.setItem('bf_last_sync_timestamp', dbData.timestamp.toString());
                }
                localStorage.setItem('bf_last_fetch_time', Date.now().toString());

                if (!isBackground) {
                    // Trigger immediate UI updates
                    this.view.renderDashboard();
                    this.view.renderKeHoachTable();
                    this.view.renderGoiThauTable();
                    this.view.renderChuDauTuTable();
                    this.view.renderNhaThauTable();
                    this.view.renderChuyenGiaTable();
                    this.view.renderHopDongTable();
                }

                this.updateSyncStatusDisplay(Date.now());

                if (!isBackground) {
                    // Re-evaluate URL mapping to replace raw ID with maGoiThau now that database data has loaded
                    const cleanPath = window.location.pathname.startsWith('/') ? window.location.pathname.substring(1) : window.location.pathname;
                    const parts = cleanPath.split('/').filter(Boolean);
                    const urlTab = parts[0] || '';
                    if (this.routeMap['goithau-detail'] === urlTab && parts[1]) {
                        this.handlePathRouting(window.location.pathname, false, true);
                    }
                }
            }
        } catch (err) {
            console.error("Failed to sync data from SQLite:", err);
            if (syncStatusText) syncStatusText.textContent = 'Lỗi đồng bộ';

            const banner = document.getElementById('offline-indicator-banner');
            if (banner) {
                banner.innerHTML = `<i data-lucide="alert-triangle"></i> Lỗi đồng bộ. Máy chủ không phản hồi.`;
                if (window.lucide) {
                    window.lucide.createIcons({ root: banner });
                }
                banner.classList.add('visible');
                setTimeout(() => {
                    if (navigator.onLine) {
                        banner.classList.remove('visible');
                    } else {
                        banner.innerHTML = `<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.`;
                        if (window.lucide) {
                            window.lucide.createIcons({ root: banner });
                        }
                    }
                }, 5000);
            }
        } finally {
            if (syncIcon) syncIcon.classList.remove('anim-spin');
        }
    }

    updateSyncStatusDisplay(timestamp) {
        const syncStatusText = document.getElementById('sync-status-text');
        if (!syncStatusText) return;
        const timeStr = new Date(timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        syncStatusText.textContent = `Đồng bộ (${timeStr})`;
    }

    setupWebSocketConnection() {
        const token = sessionStorage.getItem('bf_session_token');
        const username = sessionStorage.getItem('bf_username');
        if (!token || !username) return;

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/sync`;

        console.log("Connecting to WebSocket sync server:", wsUrl);
        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        ws.onopen = () => {
            console.log("WebSocket connection established. Sending auth...");
            ws.send(JSON.stringify({
                action: "auth",
                token: token,
                username: username
            }));
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.event === "db_changed") {
                    if (msg.sender_session === token) {
                        return;
                    }
                    console.log("Database changed event received from WebSocket. Triggering Delta Sync...");
                    this.forceSyncData(true).catch(err => console.error("Real-time sync failed:", err));
                }
            } catch (e) {
                console.error("Error handling WebSocket message:", e);
            }
        };

        ws.onclose = () => {
            console.log("WebSocket connection closed. Reconnecting in 5 seconds...");
            setTimeout(() => this.setupWebSocketConnection(), 5000);
        };

        ws.onerror = (err) => {
            console.error("WebSocket error:", err);
            ws.close();
        };
    }
}

// Blend split controllers onto BiddingController prototype
Object.assign(BiddingController.prototype, {
    ...Auth,
    ...Admin,
    ...Bidding,
    ...Partner
});
