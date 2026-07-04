/* ==========================================================================
   BiddingFlow - Controller (Events, Interaction & Business logic dispatching)
   ========================================================================== */



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
            'hopdong-detail': 'hop-dong-chi-tiet',
            'chudautu-detail': 'chu-dau-tu-chi-tiet',
            'nhathau-detail': 'nha-thau-chi-tiet'
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

    hasLocalWorkspaceData() {
        const keys = ['kehoach', 'goithau', 'chudautu', 'nhathau', 'chuyengia', 'hopdong', 'thongtinmothau'];
        return keys.some(key => Array.isArray(this.model.state[key]) && this.model.state[key].length > 0);
    }

    hasLocalDataForRoute(pathname = window.location.pathname) {
        const cleanPath = pathname.startsWith('/') ? pathname.substring(1) : pathname;
        const parts = cleanPath.split('/').filter(Boolean);
        const urlTab = parts[0] || '';
        const action = parts[1] ? decodeURIComponent(parts[1]) : '';

        const detailRouteToState = {
            [this.routeMap['goithau-detail']]: {
                key: 'goithau',
                match: item => (
                    String(item.id || '').toLowerCase() === action.toLowerCase() ||
                    String(item.maGoiThau || '').toLowerCase() === action.toLowerCase()
                )
            },
            [this.routeMap['kehoach-detail']]: {
                key: 'kehoach',
                match: item => (
                    String(item.id || '').toLowerCase() === action.toLowerCase() ||
                    encodeURIComponent(String(item.maKeHoach || '')).toLowerCase() === action.toLowerCase()
                )
            },
            [this.routeMap['hopdong-detail']]: {
                key: 'hopdong',
                match: item => {
                    const cleanAction = action.toLowerCase().replace(/[\/-]/g, '');
                    const cleanNumber = String(item.soHopDong || '').toLowerCase().replace(/[\/-]/g, '');
                    return String(item.id || '').toLowerCase() === action.toLowerCase() || cleanNumber === cleanAction;
                }
            },
            [this.routeMap['chudautu-detail']]: {
                key: 'chudautu',
                match: item => (
                    String(item.id || '').toLowerCase() === action.toLowerCase() ||
                    String(item.maChuDauTu || '').toLowerCase() === action.toLowerCase()
                )
            },
            [this.routeMap['nhathau-detail']]: {
                key: 'nhathau',
                match: item => (
                    String(item.id || '').toLowerCase() === action.toLowerCase() ||
                    String(item.maNhaThau || '').toLowerCase() === action.toLowerCase()
                )
            }
        };

        const detailRoute = detailRouteToState[urlTab];
        if (!detailRoute || !action) {
            return this.hasLocalWorkspaceData();
        }

        const list = this.model.state[detailRoute.key] || [];
        const actionSuffix = action.includes('_') ? action.split('_').pop().toLowerCase() : '';
        return list.some(item => {
            const id = String(item.id || '').toLowerCase();
            return detailRoute.match(item) || (actionSuffix && id.startsWith(actionSuffix));
        });
    }

    async init() {
        // Intercept native fetch to automatically append security headers & handle auth errors globally
        const originalFetch = window.fetch;
        window.fetch = async (url, options = {}) => {
            const activeOrg = localStorage.getItem('bf_active_org');

            if (typeof url === 'string' && url.startsWith('/api/')) {
                const headers = new Headers(options.headers || {});
                headers.delete('X-Session-Token');
                headers.delete('X-Username');
                if (activeOrg) {
                    headers.set('X-Active-Org', encodeURIComponent(activeOrg));
                }
                options.headers = headers;
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

        sessionStorage.removeItem('bf_session_token');
        localStorage.removeItem('bf_session_token');
        const rememberedUserId = localStorage.getItem('bf_user_id');
        const rememberedUsername = localStorage.getItem('bf_username');
        if (rememberedUserId && !sessionStorage.getItem('bf_user_id')) {
            sessionStorage.setItem('bf_user_id', rememberedUserId);
        }
        if (rememberedUsername && !sessionStorage.getItem('bf_username')) {
            sessionStorage.setItem('bf_username', rememberedUsername);
        }

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
            if (!this.hasLocalWorkspaceData()) {
                localStorage.setItem('bf_last_sync_timestamp', '0');
                if (this.model.db && this.model.db.stores) {
                    this.model.db.stores.forEach(storeName => {
                        this.model.db.putTableData(storeName, []).catch(() => { });
                    });
                }
            }
            localStorage.setItem('bf_id_prefix_cleaned_v2', 'true');
        }

        if (localStorage.getItem('bf_clear_inferred_deletions_v1') !== 'true') {
            localStorage.removeItem('bf_local_deletions');
            localStorage.setItem('bf_clear_inferred_deletions_v1', 'true');
        }

        const hasLocalWorkspaceSnapshot = this.hasLocalWorkspaceData();
        const hasCompletedVersionResync = localStorage.getItem('bf_force_full_resync_versions_v3') === 'true';
        const hasPendingVersionResync = localStorage.getItem('bf_pending_full_resync_versions_v3') === 'true';

        if (!hasCompletedVersionResync && !hasPendingVersionResync && !hasLocalWorkspaceSnapshot) {
            localStorage.setItem('bf_last_sync_timestamp', '0');
            localStorage.removeItem('bf_last_fetch_time');
            localStorage.setItem('bf_pending_full_resync_versions_v3', 'true');
        } else if (hasLocalWorkspaceSnapshot) {
            localStorage.removeItem('bf_pending_full_resync_versions_v3');
            localStorage.setItem('bf_force_full_resync_versions_v3', 'true');
        }

        this.view.initDOM();
        this.setupAuth();
        this.setupActivityTracker();

        this.registerGlobals();
        this.setupTheme();
        if (!window._vietnameseHolidays) {
            fetch('/api/holidays')
                .then(res => res.json())
                .then(data => {
                    window._vietnameseHolidays = data || {};
                })
                .catch(e => {
                    console.error('Failed to load holidays:', e);
                    window._vietnameseHolidays = {};
                });
        }
        this.setupSidebar();
        this.setupTabs();
        this.setupActionListeners();
        this.setupDelegatedActions();
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

        const hasUsableLocalData = this.hasLocalDataForRoute(window.location.pathname);
        const shouldWaitForVersionResync = localStorage.getItem('bf_pending_full_resync_versions_v3') === 'true' && !hasUsableLocalData;
        const initialPath = window.location.pathname;
        const initialParts = initialPath.startsWith('/') ? initialPath.substring(1).split('/').filter(Boolean) : [];
        const detailRoutePaths = [
            this.routeMap['goithau-detail'],
            this.routeMap['kehoach-detail'],
            this.routeMap['hopdong-detail'],
            this.routeMap['chudautu-detail'],
            this.routeMap['nhathau-detail']
        ].filter(Boolean);
        const shouldWaitForDetailData = detailRoutePaths.includes(initialParts[0]) && !!initialParts[1] && !hasUsableLocalData;

        if ((shouldWaitForVersionResync || shouldWaitForDetailData) && !this._initialSyncStarted) {
            this._initialSyncStarted = true;
            await this.forceSyncData(false, true);
        }

        // Initialize Tab based on URL Pathname or Role Default
        this.handlePathRouting(window.location.pathname, false, true);

        // Ẩn màn hình loading ngay sau khi giao diện đã được render xong từ dữ liệu cục bộ IndexedDB
        if (typeof window.hideInitLoader === 'function') {
            window.hideInitLoader();
        }


        // Dùng delta sync để tối ưu hóa hiệu năng khởi động (tránh force full sync)
        if (!this._initialSyncStarted) {
            this._initialSyncStarted = true;
            this.forceSyncData(true);
        }

        // Song song hóa: tải users + system-packages cùng lúc thay vì tuần tự
        try {
            const [usersRes, pkgsRes] = await Promise.all([
                fetch('/api/auth/users'),
                fetch('/api/system-packages')
            ]);

            // Xử lý danh sách nhân viên cho dropdown phân công
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

            // Xử lý gói dịch vụ hệ thống
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
            console.error("Failed to load init data (users/packages):", err);
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

        window.saveKetQuaChiDinhThau = (gtId) => this.saveKetQuaChiDinhThau(gtId);

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
                    <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} data-bf-action="page" data-container-id="${containerId}" data-page="1" title="Trang đầu">
                        <i data-lucide="chevrons-left" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} data-bf-action="page" data-container-id="${containerId}" data-page="${currentPage - 1}" title="Trang trước">
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
                    <button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-bf-action="page" data-container-id="${containerId}" data-page="${i}">
                        ${i}
                    </button>
                `;
            }

            html += `
                    <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} data-bf-action="page" data-container-id="${containerId}" data-page="${currentPage + 1}" title="Trang sau">
                        <i data-lucide="chevron-right" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} data-bf-action="page" data-container-id="${containerId}" data-page="${totalPages}" title="Trang cuối">
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

    setupDelegatedActions() {
        if (this._delegatedActionsReady) return;
        this._delegatedActionsReady = true;

        document.addEventListener('click', (event) => {
            if (event.target.closest('[data-bf-stop]') && !event.target.closest('[data-bf-stop] [data-bf-action]')) {
                return;
            }
            const target = event.target.closest('[data-bf-action]');
            if (!target) return;

            const action = target.dataset.bfAction;
            const id = target.dataset.id;
            const root = target.dataset.root;
            const value = target.dataset.value;

            const call = (fn, ...args) => {
                if (typeof window[fn] === 'function') {
                    event.preventDefault();
                    window[fn](...args);
                }
            };

            switch (action) {
                case 'call': {
                    const fn = target.dataset.fn;
                    if (fn && typeof window[fn] === 'function') {
                        event.preventDefault();
                        let args = [];
                        try {
                            args = JSON.parse(target.dataset.args || '[]');
                        } catch (e) {
                            args = [];
                        }
                        args = args.map(arg => arg === null ? target : arg);
                        window[fn](...args);
                    }
                    return;
                }
                case 'remove-closest': {
                    const selector = target.dataset.selector;
                    if (selector) {
                        event.preventDefault();
                        const node = target.closest(selector);
                        if (node) node.remove();
                    }
                    return;
                }
                case 'page':
                    if (typeof window.handlePageChange === 'function') {
                        event.preventDefault();
                        window.handlePageChange(target.dataset.containerId, parseInt(target.dataset.page, 10));
                    }
                    return;
                case 'switch-tab':
                    return call('switchTab', target.dataset.tab);
                case 'close-modal':
                    if (target.dataset.modalId) {
                        event.preventDefault();
                        const modal = document.getElementById(target.dataset.modalId);
                        if (modal) modal.classList.remove('active');
                    }
                    return;
                case 'show-package':
                    return call('showPackageDetails', id);
                case 'edit-package':
                    return call('editGoiThau', id);
                case 'view-package':
                    return call('editGoiThau', id, true);
                case 'delete-package':
                    return call('deleteGoiThau', id);
                case 'restore-package':
                    return call('restoreCanceledPackage', id);
                case 'show-plan':
                    return call('showKeHoachDetails', id);
                case 'edit-plan':
                    return call('editKeHoach', id);
                case 'delete-plan':
                    return call('deleteKeHoach', id);
                case 'show-investor':
                    return call('showChuDauTuDetails', id);
                case 'edit-investor':
                    return call('editChuDauTu', id);
                case 'delete-investor':
                    return call('deleteChuDauTu', id);
                case 'show-contractor':
                    return call('showNhaThauDetails', id);
                case 'show-contractor-close-jv':
                    return call('showNhaThauDetailsAndCloseJV', id);
                case 'show-jv':
                    if (window._jvDataMap && window._jvDataMap[id] && typeof window.openMoThauJVViewModal === 'function') {
                        event.preventDefault();
                        const data = window._jvDataMap[id];
                        window.openMoThauJVViewModal(data.members, data.leadName, data.leadCode);
                    }
                    return;
                case 'show-lot-winners':
                    return call('showLotWinnersModal', id);
                case 'edit-contractor':
                    return call('editNhaThau', id);
                case 'delete-contractor':
                    return call('deleteNhaThau', id);
                case 'show-expert':
                    return call('showChuyenGiaDetails', id);
                case 'edit-expert':
                    return call('editChuyenGia', id);
                case 'delete-expert':
                    return call('deleteChuyenGia', id);
                case 'zoom-signature':
                    return call('zoomSignatureImage', id);
                case 'zoom-certificate':
                    return call('zoomCertificateImage', id);
                case 'show-contract':
                    return call('showHopDongDetails', id);
                case 'edit-contract':
                    return call('editHopDong', id);
                case 'delete-contract':
                    return call('deleteHopDong', id);
                case 'export-contract':
                    return call('exportContractFromHopDong', id, target.dataset.contractNo || '');
                case 'change-plan-version':
                    return call('changePlanRowVersion', root, value);
                case 'change-package-version':
                    return call('changePackageRowVersion', root, value);
                default:
                    return;
            }
        });

        document.addEventListener('change', (event) => {
            const target = event.target.closest('[data-bf-change]');
            if (!target) return;
            const action = target.dataset.bfChange;
            const root = target.dataset.root;
            if (action === 'change-plan-version' && typeof window.changePlanRowVersion === 'function') {
                window.changePlanRowVersion(root, target.value);
            }
            if (action === 'change-package-version' && typeof window.changePackageRowVersion === 'function') {
                window.changePackageRowVersion(root, target.value);
            }
            if (action === 'change-investor-version' && typeof window.changeChuDauTuRowVersion === 'function') {
                window.changeChuDauTuRowVersion(root, target.value);
            }
            if (action === 'change-contractor-version' && typeof window.changeNhaThauRowVersion === 'function') {
                window.changeNhaThauRowVersion(root, target.value);
            }
            if (action === 'change-expert-version' && typeof window.changeChuyenGiaRowVersion === 'function') {
                window.changeChuyenGiaRowVersion(root, target.value);
            }
            if (action === 'change-contract-version' && typeof window.changeHopDongRowVersion === 'function') {
                window.changeHopDongRowVersion(root, target.value);
            }
        }, true);
    }
}
