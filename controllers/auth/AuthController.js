/* ==========================================================================
   BiddingFlow - AuthController (Part of Controller split)
   ========================================================================== */

/**
 * validateUsernameClient(username)
 * Bộ lọc username phía client — đồng bộ logic 3 lớp với backend (username_validator.py).
 * Trả về: { ok: true } hoặc { ok: false, message: "..." }
 *
 * Lớp 1: FORMAT  — [a-z0-9_], 3-30 ký tự, không bắt đầu/kết thúc bằng '_', không '__'
 * Lớp 2: SENSITIVE — Nhãn hàng, từ thô tục, từ hệ thống
 * Lớp 3: RESERVED  — Route SPA / API của hệ thống
 */
export function validateUsernameClient(username) {
    const u = (username || '').toLowerCase().trim();

    // --- Lớp 1: Format ---
    if (!/^[a-z0-9_]{3,30}$/.test(u)) {
        return { ok: false, message: 'Tên đăng nhập chỉ được chứa chữ thường (a-z), số (0-9) và dấu gạch dưới (_), từ 3 đến 30 ký tự.' };
    }
    if (u.startsWith('_') || u.endsWith('_')) {
        return { ok: false, message: 'Tên đăng nhập không được bắt đầu hoặc kết thúc bằng dấu gạch dưới (_).' };
    }
    if (u.includes('__')) {
        return { ok: false, message: 'Tên đăng nhập không được chứa hai dấu gạch dưới liên tiếp (__).' };
    }

    // --- Lớp 2: Từ nhạy cảm ---
    const SENSITIVE = new Set([
        // Hệ thống / đặc quyền
        'admin','administrator','superadmin','superuser','root','sysadmin',
        'system','support','helpdesk','moderator','staff','operator',
        'service','bot','daemon','null','undefined','anonymous','guest',
        'test','demo','debug','dev','devops','api','server',
        'billing','noreply','no_reply','postmaster','webmaster','hostmaster',
        'info','contact','abuse','security',
        // Nhãn hàng
        'google','facebook','microsoft','apple','amazon','twitter','tiktok',
        'youtube','instagram','linkedin','github','gitlab','openai','chatgpt',
        'netflix','spotify','paypal','visa','mastercard',
        'vingroup','viettel','vnpt','mobifone','vinaphone',
        'biddingflow','bidding_flow',
        // Từ thô tục (dạng ASCII)
        'dit','dcm','dm','lol','cac','lon','bu_lon','bu_cac',
        'me_may','fuck','shit','ass','bitch','bastard','cunt',
        'porn','sex','nude','xxx','rape',
    ]);

    // Khớp toàn phần hoặc xuất hiện trong chuỗi ngăn cách bởi '_'
    if (SENSITIVE.has(u)) {
        return { ok: false, message: 'Tên đăng nhập chứa từ không được phép (nhãn hàng, từ thô tục hoặc từ hệ thống). Vui lòng chọn tên khác.' };
    }
    const parts = u.split('_').filter(Boolean);
    for (const part of parts) {
        if (SENSITIVE.has(part)) {
            return { ok: false, message: 'Tên đăng nhập chứa từ không được phép (nhãn hàng, từ thô tục hoặc từ hệ thống). Vui lòng chọn tên khác.' };
        }
    }

    // --- Lớp 3: Route hệ thống ---
    const RESERVED = new Set([
        'tong-quan','ke-hoach','goi-thau','mothau','danh-gia-hsdt',
        'chu-dau-tu','nha-thau','chuyen-gia','hop-dong','bieu-mau',
        'tong-quan-admin','quan-ly-tai-khoan','nhan-su','trang-thai-ho-so',
        'trang-ca-nhan','goi-thau-chi-tiet','ke-hoach-chi-tiet',
        'hop-dong-chi-tiet','chu-dau-tu-chi-tiet','nha-thau-chi-tiet',
        'chudautu-detail','nhathau-detail',
        'api','auth','sync','paginate','ws','dist','views',
        'controllers','models','uploads','static','templates',
        'holidays','export','import','address',
        'login','logout','register','verify','forgot','password',
        'me','self','my','account','profile','dashboard',
        'settings','config','setup','install',
    ]);

    if (RESERVED.has(u) || RESERVED.has(u.replace(/_/g, '-'))) {
        return { ok: false, message: 'Tên đăng nhập này trùng với đường dẫn hệ thống và không thể sử dụng. Vui lòng chọn tên khác.' };
    }

    return { ok: true, message: '' };
}

function setAuthFlowInProgress(isInProgress) {
    window._bfAuthFlowInProgress = !!isInProgress;
    window._bfAuthStateChangedAt = Date.now();
}

function setAuthSessionActive(isActive) {
    window._bfAuthSessionActive = !!isActive;
    window._bfAuthStateChangedAt = Date.now();
    if (isActive) {
        setAuthFlowInProgress(false);
    }
}

function isAuthTransitionActive() {
    return !!window._bfAuthFlowInProgress;
}

function isStaleAuthResult(requestStartedAt) {
    return Number.isFinite(requestStartedAt)
        && Number.isFinite(window._bfAuthStateChangedAt)
        && requestStartedAt < window._bfAuthStateChangedAt;
}

function hideAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.style.display = 'none';
    const appContainer = document.querySelector('.app-container');
    if (appContainer) appContainer.style.filter = 'none';
}

function showGoogleAuthPending() {
    let pending = document.getElementById('google-auth-pending-overlay');
    if (!pending) {
        pending = document.createElement('div');
        pending.id = 'google-auth-pending-overlay';
        pending.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:99998',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'background:rgba(15,23,42,0.72)',
            'backdrop-filter:blur(8px)',
            '-webkit-backdrop-filter:blur(8px)'
        ].join(';');
        pending.innerHTML = `
            <div style="background:var(--bg-card,#fff);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,0.22);padding:28px 32px;width:min(420px,calc(100vw - 32px));text-align:center;color:var(--text-main,#111);">
                <div style="width:44px;height:44px;border-radius:50%;border:4px solid #e5e7eb;border-top-color:#4f46e5;margin:0 auto 18px;animation:bf-spin 0.85s linear infinite;"></div>
                <div style="font-size:1rem;font-weight:800;margin-bottom:6px;">Đang tạo tài khoản Google</div>
                <div style="font-size:0.88rem;color:var(--text-muted,#6b7280);line-height:1.45;">Vui lòng chờ trong giây lát...</div>
            </div>
        `;
        const style = document.createElement('style');
        style.id = 'google-auth-pending-style';
        style.textContent = '@keyframes bf-spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(style);
        document.body.appendChild(pending);
    }
    pending.style.display = 'flex';
}

function hideGoogleAuthPending() {
    const pending = document.getElementById('google-auth-pending-overlay');
    if (pending) pending.style.display = 'none';
}

export function setupActivityTracker() {
    const updateActivity = () => {
        localStorage.setItem('bf_last_activity', Date.now().toString());
    };

    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(type => {
        document.addEventListener(type, updateActivity, { passive: true });
    });

    // Initial set if user is already logged in
    if (!localStorage.getItem('bf_last_activity')) {
        updateActivity();
    }
}

export function checkInactivity() {
    const activeUser = this.model?.state?.activeuser;
    if (!activeUser || !activeUser.name) return false;

    const lastActivity = localStorage.getItem('bf_last_activity');
    if (lastActivity) {
        const storedTimeout = localStorage.getItem('bf_inactivity_timeout');
        const timeoutHours = storedTimeout ? parseInt(storedTimeout, 10) : 10;
        const inactivityLimit = timeoutHours * 60 * 60 * 1000;
        const idleTime = Date.now() - parseInt(lastActivity, 10);

        if (idleTime > inactivityLimit) {
            if (this._sessionInterval) clearInterval(this._sessionInterval);
            this.model.clearSessionData();

            // Show session expired notification using custom popup if available, else fallback to styled banner
            const showSessionExpired = async () => {
                if (this.view && typeof this.view.customAlert === 'function') {
                    await this.view.customAlert('Phiên làm việc hết hạn', 'Bạn đã không hoạt động trong ứng dụng hơn ' + timeoutHours + ' giờ. Vui lòng đăng nhập lại để đảm bảo bảo mật thông tin.', 'clock');
                } else {
                    const banner = document.createElement('div');
                    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:14px 24px;font-weight:700;font-size:0.9rem;text-align:center;';
                    banner.textContent = '⏳ Phiên làm việc hết hạn — Vui lòng đăng nhập lại để đảm bảo bảo mật.';
                    document.body.prepend(banner);
                    setTimeout(() => banner.remove(), 5000);
                }
            };
            showSessionExpired();

            const overlay = document.getElementById('auth-overlay');
            if (overlay) {
                overlay.style.display = 'flex';
                document.querySelector('.app-container').style.filter = 'blur(10px)';
                const formLogin = document.getElementById('form-auth-login');
                const formRegister = document.getElementById('form-auth-register');
                const formForgot = document.getElementById('form-auth-forgot');
                formLogin.style.display = 'block';
                formRegister.style.display = 'none';
                formForgot.style.display = 'none';
                document.getElementById('login-username').value = '';
                document.getElementById('login-password').value = '';
            }
            return true;
        }
    }
    return false;
}

export function startBackgroundSessionChecker() {
    if (this._sessionInterval) clearInterval(this._sessionInterval);

    // Check every 30 seconds
    this._sessionInterval = setInterval(() => {
        // Check if the user is idle first
        if (this.checkInactivity()) {
            clearInterval(this._sessionInterval);
            return;
        }

        fetch('/api/auth/check-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ remember: localStorage.getItem('bf_remember_me') === 'true' })
        }).then(res => {
            if (res.ok) return res.json();
            throw new Error("Invalid session");
        }).then(async data => {
            if (!data || !data.valid) {
                clearInterval(this._sessionInterval);
                this.model.clearSessionData();
                const overlay = document.getElementById('auth-overlay');
                if (overlay) {
                    overlay.style.display = 'flex';
                    document.querySelector('.app-container').style.filter = 'blur(10px)';
                    const formLogin = document.getElementById('form-auth-login');
                    const formRegister = document.getElementById('form-auth-register');
                    const formForgot = document.getElementById('form-auth-forgot');
                    if (formLogin) formLogin.style.display = 'block';
                    if (formRegister) formRegister.style.display = 'none';
                    if (formForgot) formForgot.style.display = 'none';
                    document.getElementById('login-username').value = '';
                    document.getElementById('login-password').value = '';
                }

                if (data && data.reason === 'logged_in_elsewhere') {
                    this.view.showToast('Tài khoản đăng nhập ở thiết bị khác', 'Tài khoản của bạn vừa được đăng nhập tại một thiết bị hoặc trình duyệt khác. Phiên làm việc hiện tại đã bị đóng.', 'warning');
                } else {
                    this.view.showToast('Phiên đăng nhập hết hạn', 'Phiên đăng nhập của bạn đã hết hiệu lực hoặc không hợp lệ. Vui lòng đăng nhập lại.', 'warning');
                }
            } else {
                if (data.user) {
                    const activeuser = this.model.state.activeuser || {};
                    this.model.state.activeuser = activeuser;
                    let hasChanges = false;
                    const nextDbRoles = data.user.effective_roles || [];
                    const nextActiveRole = this.model.constructor.resolveAllowedActiveRole({
                        ...activeuser,
                        dbRole: data.user.role || '',
                        dbRoles: nextDbRoles
                    }, this.model.state.activerole);
                    if (this.model.state.activerole !== nextActiveRole) {
                        this.model.state.activerole = nextActiveRole;
                        hasChanges = true;
                    }
                    if (activeuser.name !== data.user.name) { activeuser.name = data.user.name; hasChanges = true; }
                    if (activeuser.avatar !== (data.user.avatar || '')) { activeuser.avatar = data.user.avatar || ''; hasChanges = true; }
                    if (activeuser.email !== (data.user.email || '')) { activeuser.email = data.user.email || ''; hasChanges = true; }
                    if (activeuser.dbRole !== (data.user.role || '')) { activeuser.dbRole = data.user.role || ''; hasChanges = true; }
                    if (JSON.stringify(activeuser.dbRoles || []) !== JSON.stringify(nextDbRoles)) { activeuser.dbRoles = nextDbRoles; hasChanges = true; }
                    const nextTitle = this.model.constructor.getRoleTitle(this.model.state.activerole);
                    if (activeuser.title !== nextTitle) { activeuser.title = nextTitle; hasChanges = true; }
                    if (activeuser.package_id !== (data.user.package_id || 'none')) { activeuser.package_id = data.user.package_id || 'none'; hasChanges = true; }
                    if (activeuser.organization_name !== (data.user.organization_name || '')) { activeuser.organization_name = data.user.organization_name || ''; hasChanges = true; }
                    if (hasChanges) {
                        sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEROLE, JSON.stringify(this.model.state.activerole));
                        sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(activeuser));
                        localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(activeuser));
                        this.view.updateActiveUserProfileDisplay();

                        let activeOrg = localStorage.getItem('bf_active_org');
                        const orgs = (activeuser.organization_name || '').split(',').map(o => o.trim()).filter(Boolean);
                        if (activeOrg && !orgs.includes(activeOrg)) {
                            const nextOrg = orgs[0] || '';
                            if (typeof this.resetWorkspaceData === 'function') {
                                await this.resetWorkspaceData(nextOrg);
                            } else {
                                if (nextOrg) {
                                    localStorage.setItem('bf_active_org', nextOrg);
                                } else {
                                    localStorage.removeItem('bf_active_org');
                                }
                                localStorage.setItem('bf_last_sync_timestamp', '0');
                                localStorage.removeItem('bf_last_sync_version');
                            }
                            // Tải lại dữ liệu cho không gian làm việc mới ngay lập tức
                            this.forceSyncData().catch(err => console.error("Lỗi tự động tải lại dữ liệu:", err));
                        }

                        if (typeof this.renderWorkspaceSwitcher === 'function') {
                            this.renderWorkspaceSwitcher();
                        }
                    }
                }
            }
        }).catch(err => {
            console.error("Lỗi tự động kiểm tra phiên làm việc:", err);
        });
    }, 30000);
}

export function setupAuth() {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;

    // Form switcher elements
    const formLogin = document.getElementById('form-auth-login');
    const formRegister = document.getElementById('form-auth-register');
    const formForgot = document.getElementById('form-auth-forgot');
    const formVerify = document.getElementById('form-auth-verify');

    const hideInitLoader = () => {
        const initLoader = document.getElementById('system-init-loader');
        if (initLoader) {
            initLoader.style.opacity = '0';
            initLoader.style.visibility = 'hidden';
            setTimeout(() => initLoader.remove(), 90);
        }
    };
    window.hideInitLoader = hideInitLoader;

    const hasLocalWorkspaceData = () => {
        if (typeof this.hasLocalWorkspaceData === 'function') {
            return this.hasLocalWorkspaceData();
        }
        const keys = ['kehoach', 'goithau', 'chudautu', 'nhathau', 'chuyengia', 'hopdong', 'thongtinmothau'];
        return keys.some(key => Array.isArray(this.model.state[key]) && this.model.state[key].length > 0);
    };

    const showLoginOverlay = (requestStartedAt = Date.now()) => {
        if (isAuthTransitionActive() || isStaleAuthResult(requestStartedAt)) {
            hideInitLoader();
            return;
        }
        this.model.clearSessionData();
        overlay.style.display = 'flex';
        document.querySelector('.app-container').style.filter = 'blur(10px)';
        formLogin.style.display = 'block';
        formRegister.style.display = 'none';
        formForgot.style.display = 'none';
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
        hideInitLoader();
    };

    const showCachedWorkspace = () => {
        overlay.style.display = 'none';
        document.querySelector('.app-container').style.filter = 'none';
        this.view.updateActiveUserProfileDisplay();
        if (typeof this.handlePathRouting === 'function') {
            this.handlePathRouting(window.location.pathname, false, true);
        } else {
            this.switchTab(this.model.state.activerole === 'super_admin' ? 'superadmin-dashboard' : 'dashboard');
        }
        hideInitLoader();
    };

    const applySessionUser = (user) => {
        if (!user) return;
        if (user.id) {
            sessionStorage.setItem('bf_user_id', user.id);
        }
        if (user.username) {
            sessionStorage.setItem('bf_username', user.username);
        }
        if (!this.model.state.activeuser) this.model.state.activeuser = {};
        const requestedRole = this.model.state.activeuser.dbRole ? this.model.state.activerole : null;
        this.model.state.activerole = this.model.constructor.resolveAllowedActiveRole({
            ...this.model.state.activeuser,
            dbRole: user.role || '',
            dbRoles: user.effective_roles || []
        }, requestedRole);
        this.model.state.activeuser.name = user.name;
        this.model.state.activeuser.avatar = user.avatar || '';
        this.model.state.activeuser.email = user.email || '';
        this.model.state.activeuser.dbRole = user.role || '';
        this.model.state.activeuser.dbRoles = user.effective_roles || [];
        this.model.state.activeuser.package_id = user.package_id || 'none';
        this.model.state.activeuser.organization_name = user.organization_name || '';
        if (user.inactivity_timeout_hours) {
            localStorage.setItem('bf_inactivity_timeout', user.inactivity_timeout_hours);
        }
        this.model.state.activeuser.title = this.model.constructor.getRoleTitle(this.model.state.activerole);
        sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEROLE, JSON.stringify(this.model.state.activerole));
        sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));
        localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));
        this.view.updateActiveUserProfileDisplay();
    };

    const refreshWorkspaceInBackground = () => {
        const runSync = () => {
            const syncPromise = typeof this.scheduleBackgroundSync === 'function'
                ? (this.scheduleBackgroundSync(300), Promise.resolve())
                : this.forceSyncData(true);
            this._initialSyncStarted = true;
            syncPromise.catch(err => {
                console.error("Failed to force sync data after F5 restore:", err);
            });
        };
        if ('requestIdleCallback' in window) {
            requestIdleCallback(runSync, { timeout: 2000 });
        } else {
            setTimeout(runSync, 500);
        }
    };

    {
        const loaderText = document.getElementById('system-init-loader-text');
        if (loaderText) loaderText.textContent = 'Đang tải...';

        const initialPath = window.location.pathname;
        const initialParts = initialPath.startsWith('/') ? initialPath.substring(1).split('/').filter(Boolean) : [];
        const detailRoutePaths = [
            this.routeMap['goithau-detail'],
            this.routeMap['kehoach-detail'],
            this.routeMap['hopdong-detail'],
            this.routeMap['chudautu-detail'],
            this.routeMap['nhathau-detail']
        ].filter(Boolean);
        const shouldWaitForDetailData = detailRoutePaths.includes(initialParts[0]) && !!initialParts[1];

        const canShowLocalFirst = typeof this.hasLocalDataForRoute === 'function'
            ? this.hasLocalDataForRoute(initialPath)
            : hasLocalWorkspaceData();
        if (canShowLocalFirst) {
            requestAnimationFrame(showCachedWorkspace);
        }

        const sessionCheckStartedAt = Date.now();
        fetch('/api/auth/check-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ remember: localStorage.getItem('bf_remember_me') === 'true' })
        }).then(res => {
            if (res.ok) {
                return res.json();
            }
            throw new Error("Invalid session response");
        }).then(async data => {
            if (isAuthTransitionActive() || isStaleAuthResult(sessionCheckStartedAt)) {
                return;
            }
            if (!data || !data.valid) {
                showLoginOverlay(sessionCheckStartedAt);
            } else {
                if (loaderText) loaderText.textContent = 'Đang tải...';

                setAuthSessionActive(true);

                // Update active user details dynamically to prevent cache issues
                const previousUserId = sessionStorage.getItem('bf_user_id');
                applySessionUser(data.user);
                if (data.user?.id && previousUserId !== String(data.user.id)) {
                    await this.model.init({ priorityKeys: this.getStartupPriorityKeys?.(window.location.pathname) });
                }

                const effectiveRoles = data.user.effective_roles || [];
                let activeRole = data.user.role || 'employee';
                if (effectiveRoles.includes('super_admin')) activeRole = 'super_admin';
                else if (effectiveRoles.includes('manager')) activeRole = 'manager';

                // Nếu user cần đặt username, hiển thị modal và chặn không cho vào dashboard trước khi đặt xong
                if (data.user.needs_username) {
                    overlay.style.display = 'none';
                    document.querySelector('.app-container').style.filter = 'blur(10px)';
                    hideInitLoader();
                    
                    this._showSetUsernameModal(
                        activeRole,
                        () => {
                            document.querySelector('.app-container').style.filter = 'none';
                            this._finishGoogleLogin(activeRole);
                        },
                        data.user.suggested_username || '',
                        data.user.account_linked || false
                    );
                } else {
                    if (!canShowLocalFirst && !shouldWaitForDetailData) {
                        showCachedWorkspace();
                    }
                    refreshWorkspaceInBackground();
                }

                this.startBackgroundSessionChecker();
            }
        }).catch(err => {
            console.error("Lỗi kiểm tra phiên làm việc:", err);
            showLoginOverlay(sessionCheckStartedAt);
        });
    }

    const btnShowReg = document.getElementById('link-show-register');
    const btnShowForgot = document.getElementById('link-show-forgot');
    const btnShowLoginFromReg = document.getElementById('link-show-login-from-reg');
    const btnShowLoginFromForgot = document.getElementById('link-show-login-from-forgot');
    const btnShowLoginFromVerify = document.getElementById('link-show-login-from-verify');
    const btnLogout = document.getElementById('btn-auth-logout');

    const switchForm = (showPane) => {
        formLogin.style.display = 'none';
        formRegister.style.display = 'none';
        formForgot.style.display = 'none';
        if (formVerify) formVerify.style.display = 'none';

        // Reset msgs
        document.querySelectorAll('.auth-error-msg, .auth-success-msg').forEach(el => el.style.display = 'none');
        showPane.style.display = 'block';
    };

    let countdownInterval;
    const startOtpCountdown = (username) => {
        const btnResend = document.getElementById('btn-resend-otp');
        const timerSpan = document.getElementById('otp-timer');
        const countdownSpan = document.getElementById('otp-countdown');
        if (!btnResend || !timerSpan || !countdownSpan) return;

        btnResend.style.display = 'none';
        timerSpan.style.display = 'inline';

        let seconds = 60;
        countdownSpan.textContent = seconds;

        if (countdownInterval) clearInterval(countdownInterval);

        countdownInterval = setInterval(() => {
            seconds--;
            countdownSpan.textContent = seconds;
            if (seconds <= 0) {
                clearInterval(countdownInterval);
                btnResend.style.display = 'inline';
                timerSpan.style.display = 'none';
            }
        }, 1000);
    };

    if (btnShowReg) btnShowReg.onclick = (e) => { e.preventDefault(); switchForm(formRegister); };
    if (btnShowForgot) btnShowForgot.onclick = (e) => { e.preventDefault(); switchForm(formForgot); };
    if (btnShowLoginFromReg) btnShowLoginFromReg.onclick = (e) => { e.preventDefault(); switchForm(formLogin); };
    if (btnShowLoginFromForgot) btnShowLoginFromForgot.onclick = (e) => { e.preventDefault(); switchForm(formLogin); };
    if (btnShowLoginFromVerify) btnShowLoginFromVerify.onclick = (e) => { e.preventDefault(); switchForm(formLogin); };

    if (btnLogout) {
        btnLogout.onclick = async () => {
            const confirmed = await this.view.customConfirm('Xác nhận đăng xuất', 'Bạn có chắc chắn muốn đăng xuất tài khoản này không?', 'log-out');
            if (confirmed) {
                try {
                    // Trigger a final sync to ensure all unsaved changes are pushed before logout
                    // Dùng autoSync() thay vì JSON.stringify(model.state) toàn bộ để giảm payload
                    if (typeof this.autoSync === 'function') {
                        await this.autoSync();
                    }
                } catch (e) {
                    console.error("Failed final sync during logout:", e);
                }

                try {
                    await fetch('/api/auth/logout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: '{}'
                    });
                } catch (e) {
                    console.error("Failed to clear server session during logout:", e);
                }

                this.model.clearSessionData();
                setAuthSessionActive(false);
                setAuthFlowInProgress(false);
                if (this._sessionInterval) clearInterval(this._sessionInterval);
                if (typeof this.resetWorkspaceData === 'function') {
                    await this.resetWorkspaceData('');
                } else {
                    localStorage.removeItem('bf_active_org');
                    localStorage.removeItem('bf_last_sync_timestamp');
                    localStorage.removeItem('bf_last_sync_version');
                }

                overlay.style.display = 'flex';
                document.querySelector('.app-container').style.filter = 'blur(10px)';
                switchForm(formLogin);
                document.getElementById('login-username').value = '';
                document.getElementById('login-password').value = '';
            }
        };
    }

    // Handle Login Submission
    formLogin.onsubmit = async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value.trim();
        const errorDiv = document.getElementById('login-error');
        errorDiv.style.display = 'none';

        const remember = document.getElementById('login-remember')?.checked || false;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, remember })
            });
            const data = await res.json();
            if (!res.ok) {
                errorDiv.textContent = data.error || 'Đăng nhập không thành công!';
                errorDiv.style.display = 'block';
                if (data.unverified && formVerify) {
                    document.getElementById('verify-username-hidden').value = data.username || username;
                    document.getElementById('verify-code').value = '';
                    setTimeout(() => {
                        switchForm(formVerify);
                        startOtpCountdown(data.username || username);
                    }, 2000);
                }
                return;
            }

            // Save non-sensitive profile/cache metadata. Session token lives only in HttpOnly cookies.
            setAuthSessionActive(true);
            sessionStorage.removeItem('bf_session_token');
            localStorage.removeItem('bf_session_token');
            sessionStorage.setItem('bf_username', data.username);
            sessionStorage.setItem('bf_user_id', data.id);

            if (remember) {
                localStorage.setItem('bf_remember_me', 'true');
                localStorage.setItem('bf_username', data.username);
                localStorage.setItem('bf_user_id', data.id);
            } else {
                localStorage.removeItem('bf_remember_me');
                localStorage.removeItem('bf_username');
                localStorage.removeItem('bf_user_id');
            }

            // Đồng bộ active org mới trước khi init model
            const orgs = (data.organization_name || '').split(',').map(o => o.trim()).filter(Boolean);
            const currentActiveOrg = localStorage.getItem('bf_active_org');
            if (!currentActiveOrg || !orgs.includes(currentActiveOrg)) {
                if (orgs.length > 0) {
                    localStorage.setItem('bf_active_org', orgs[0]);
                } else {
                    localStorage.removeItem('bf_active_org');
                }
            }

            // Re-initialize database connection name and data keys for this specific user
            await this.model.init();

            // Xác định active role cao nhất từ effective_roles
            const effectiveRoles = data.effective_roles || [];
            let activeRole = data.role || 'employee';
            if (effectiveRoles.includes('super_admin')) activeRole = 'super_admin';
            else if (effectiveRoles.includes('manager')) activeRole = 'manager';
            else if (effectiveRoles.includes('employee')) activeRole = 'employee';

            const resolvedUserId = !this.model.hasEffectiveRole(data.role, 'manager')
                ? (data.id ? data.id : '1')
                : (this.model.hasEffectiveRole(data.role, 'super_admin') ? 'sa-1' : 'mgr-1');

            this.model.state.activeuser = {
                ...(this.model.state.activeuser || {}),
                dbRole: data.role || '',
                dbRoles: effectiveRoles
            };
            this.model.switchActiveRole(activeRole, data.name, resolvedUserId);
            this.model.state.activeuser.avatar = data.avatar || '';
            this.model.state.activeuser.email = data.email || '';
            this.model.state.activeuser.dbRole = data.role || '';
            this.model.state.activeuser.dbRoles = effectiveRoles;
            this.model.state.activeuser.package_id = data.package_id || 'none';
            this.model.state.activeuser.organization_name = data.organization_name || '';
            localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));

            if (data.inactivity_timeout_hours) {
                localStorage.setItem('bf_inactivity_timeout', data.inactivity_timeout_hours);
            }

            // Hide Auth overlay
            hideAuthOverlay();

            // Fetch and load all data from SQLite immediately
            try {
                await this.forceSyncData();
            } catch (err) {
                console.error("Failed to load initial data from SQLite after login:", err);
            }

            // Bootstrap visual profile and tab
            this.view.updateActiveUserProfileDisplay();
            if (typeof this.renderWorkspaceSwitcher === 'function') {
                this.renderWorkspaceSwitcher();
            }
            // Sau khi đăng nhập: về dashboard theo role (không restore URL vì URL có thể là /) 
            if (activeRole === 'super_admin') {
                this.switchTab('superadmin-dashboard');
            } else {
                this.switchTab('dashboard');
            }

            // Start background checker
            this.startBackgroundSessionChecker();
        } catch (err) {
            errorDiv.textContent = 'Lỗi kết nối máy chủ Starlette: ' + err.message;
            errorDiv.style.display = 'block';
        }
    };

    // Handle Register Submission
    formRegister.onsubmit = async (e) => {
        e.preventDefault();
        const username = document.getElementById('register-username').value.trim().toLowerCase();
        const fullname = document.getElementById('register-fullname').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value.trim();
        const confirmPassword = document.getElementById('register-confirm-password').value.trim();
        const role = 'employee';
        const errorDiv = document.getElementById('register-error');
        const successDiv = document.getElementById('register-success');

        errorDiv.style.display = 'none';
        successDiv.style.display = 'none';

        // Kiểm tra username qua bộ lọc 3 lớp (format + nhạy cảm + trùng route)
        const usernameCheck = validateUsernameClient(username);
        if (!usernameCheck.ok) {
            errorDiv.textContent = usernameCheck.message;
            errorDiv.style.display = 'block';
            document.getElementById('register-username').focus();
            return;
        }

        if (password.length < 6) {
            errorDiv.textContent = 'Mật khẩu đăng nhập phải có ít nhất 6 ký tự!';
            errorDiv.style.display = 'block';
            return;
        }

        if (password !== confirmPassword) {
            errorDiv.textContent = 'Nhập lại mật khẩu không trùng khớp!';
            errorDiv.style.display = 'block';
            return;
        }

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, name: fullname, email, role })
            });
            const data = await res.json();
            if (!res.ok) {
                errorDiv.textContent = data.error || 'Đăng ký tài khoản thất bại!';
                errorDiv.style.display = 'block';
                return;
            }

            successDiv.textContent = data.message || 'Chúc mừng! Đăng ký tài khoản thành công. Vui lòng nhập mã OTP để xác thực email.';
            successDiv.style.display = 'block';
            document.getElementById('verify-username-hidden').value = username;
            document.getElementById('verify-code').value = '';
            formRegister.reset();
            setTimeout(() => {
                switchForm(formVerify);
                startOtpCountdown(username);
            }, 2000);
        } catch (err) {
            errorDiv.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
            errorDiv.style.display = 'block';
        }
    };

    // Handle Verification Submission
    if (formVerify) {
        formVerify.onsubmit = async (e) => {
            e.preventDefault();
            const username = document.getElementById('verify-username-hidden').value.trim();
            const code = document.getElementById('verify-code').value.trim();
            const errorDiv = document.getElementById('verify-error');
            const successDiv = document.getElementById('verify-success');

            errorDiv.style.display = 'none';
            successDiv.style.display = 'none';

            if (code.length !== 6) {
                errorDiv.textContent = 'Mã xác thực OTP phải gồm đúng 6 chữ số!';
                errorDiv.style.display = 'block';
                return;
            }

            try {
                const res = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, code })
                });
                const data = await res.json();
                if (!res.ok) {
                    errorDiv.textContent = data.error || 'Xác thực OTP thất bại!';
                    errorDiv.style.display = 'block';
                    return;
                }

                successDiv.textContent = data.message || 'Đang tải...';
                successDiv.style.display = 'block';
                if (countdownInterval) clearInterval(countdownInterval);
                setTimeout(() => {
                    switchForm(formLogin);
                }, 2000);
            } catch (err) {
                errorDiv.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
                errorDiv.style.display = 'block';
            }
        };
    }

    // Handle Resend OTP Click
    const btnResend = document.getElementById('btn-resend-otp');
    if (btnResend) {
        btnResend.onclick = async (e) => {
            e.preventDefault();
            const username = document.getElementById('verify-username-hidden').value.trim();
            const errorDiv = document.getElementById('verify-error');
            const successDiv = document.getElementById('verify-success');

            errorDiv.style.display = 'none';
            successDiv.style.display = 'none';

            if (!username) {
                errorDiv.textContent = 'Không tìm thấy thông tin tài khoản để gửi lại mã!';
                errorDiv.style.display = 'block';
                return;
            }

            try {
                const res = await fetch('/api/auth/resend-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username })
                });
                const data = await res.json();
                if (!res.ok) {
                    errorDiv.textContent = data.error || 'Không thể gửi lại mã OTP!';
                    errorDiv.style.display = 'block';
                    return;
                }

                successDiv.textContent = data.message || 'Đã gửi lại mã OTP mới!';
                successDiv.style.display = 'block';
                startOtpCountdown(username);
            } catch (err) {
                errorDiv.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
                errorDiv.style.display = 'block';
            }
        };
    }

    // Handle Forgot Submission
    formForgot.onsubmit = async (e) => {
        e.preventDefault();
        const username = document.getElementById('forgot-username').value.trim();
        const email = document.getElementById('forgot-email').value.trim();
        const errorDiv = document.getElementById('forgot-error');
        const successDiv = document.getElementById('forgot-success');

        errorDiv.style.display = 'none';
        successDiv.style.display = 'none';

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email })
            });
            const data = await res.json();
            if (!res.ok) {
                errorDiv.textContent = data.error || 'Thông tin khôi phục không hợp lệ!';
                errorDiv.style.display = 'block';
                return;
            }

            successDiv.textContent = data.message;
            successDiv.style.display = 'block';
        } catch (err) {
            errorDiv.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
            errorDiv.style.display = 'block';
        }
    };

    // Bind Toggle Password Visibility Click Listeners
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;

            const icon = btn.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                if (icon) {
                    icon.setAttribute('data-lucide', 'eye-off');
                }
            } else {
                input.type = 'password';
                if (icon) {
                    icon.setAttribute('data-lucide', 'eye');
                }
            }
            // Re-render Lucide icon if function exists globally
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
                lucide.createIcons();
                // Explicitly keep style safe after lucide recreates it into an svg
                const newSvg = btn.querySelector('svg');
                if (newSvg) {
                    newSvg.style.cssText = 'position:static; pointer-events:none; width:16px; height:16px;';
                }
            }
        };
    });

    // Khoi dong Google Sign-In sau khi GSI library da tai xong
    const initGoogle = () => {
        if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
            this.setupGoogleSignIn();
        }
    };
    if (typeof google !== 'undefined' && google.accounts) {
        initGoogle();
    } else {
        window.addEventListener('load', initGoogle, { once: true });
        setTimeout(initGoogle, 1500);
    }
}

export function setupGoogleSignIn() {
    // Guard: chỉ cho phép initialize 1 lần duy nhất
    if (window._gsiInitialized) return;
    window._gsiInitialized = true;

    const clientId = document.querySelector('meta[name="google-client-id"]')?.content?.trim();
    if (clientId === '__GOOGLE_CLIENT_ID__') return;
    if (!clientId) return;

    const container = document.getElementById('google-signin-btn-container');
    if (!container) return;

    // Cho den khi google.accounts.id san sang
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) return;

    // Helper: hoàn tất đăng nhập sau khi username đã được đặt (hoặc không cần đặt)
    this._finishGoogleLogin = async (activeRole) => {
        setAuthSessionActive(true);
        hideGoogleAuthPending();
        hideAuthOverlay();
        try { await this.forceSyncData(); } catch (err) { console.error('Failed sync after Google login:', err); }
        this.view.updateActiveUserProfileDisplay();
        if (typeof this.renderWorkspaceSwitcher === 'function') this.renderWorkspaceSwitcher();
        if (activeRole === 'super_admin') {
            this.switchTab('superadmin-dashboard');
        } else {
            this.switchTab('dashboard');
        }
        this.startBackgroundSessionChecker();
    };

    // Helper: hiển thị modal bắt buộc đặt username (không thể tắt)
    // - suggestedUsername: username gợi ý sinh tự động (có thể sửa)
    // - accountLinked: true nếu là tài khoản cũ (Email+MK) vừa được liên kết với Google
    this._showSetUsernameModal = (activeRole, onSuccess, suggestedUsername = '', accountLinked = false) => {
        const modalOverlay = document.getElementById('modal-set-username-overlay');
        const input = document.getElementById('input-set-username');
        const errorDiv = document.getElementById('set-username-error');
        const submitBtn = document.getElementById('btn-set-username-submit');
        if (!modalOverlay || !input || !submitBtn) return;

        // Cập nhật mô tả modal theo ngữ cảnh
        const descEl = modalOverlay.querySelector('[data-username-modal-desc]');
        if (descEl) {
            if (accountLinked) {
                descEl.innerHTML = 'Đây là tài khoản cũ của bạn (Email + Mật khẩu) đã được tự động liên kết với Google. Vui lòng đặt <strong>tên đăng nhập</strong> để hoàn tất.<br><span style="color: #ef4444; font-weight: 600;">Lưu ý: Tên này không thể thay đổi sau khi đặt.</span>';
            } else {
                descEl.innerHTML = 'Tài khoản Google của bạn đã được tạo. Vui lòng đặt <strong>tên đăng nhập</strong> để hoàn tất.<br><span style="color: #ef4444; font-weight: 600;">Lưu ý: Tên này không thể thay đổi sau khi đặt.</span>';
            }
        }

        // Hiện modal (dùng flex)
        modalOverlay.style.display = 'flex';

        // Điền sẵn username gợi ý nếu có
        if (suggestedUsername) {
            input.value = suggestedUsername;
        } else {
            input.value = '';
        }
        input.focus();
        // Đặt cursor ở cuối
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}

        if (errorDiv) errorDiv.style.display = 'none';

        // Render lucide icons bên trong modal
        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Validate realtime — dùng validateUsernameClient (3 lớp)
        input.oninput = () => {
            const val = input.value.toLowerCase();
            input.value = val.replace(/[^a-z0-9_]/g, '');
            const hint = document.getElementById('set-username-hint');
            if (hint && input.value.length > 0) {
                const check = validateUsernameClient(input.value);
                if (!check.ok) {
                    hint.textContent = check.message;
                    hint.style.color = '#ef4444';
                } else {
                    hint.textContent = 'Chỉ chữ thường (a-z), số (0-9) và dấu gạch dưới (_). Từ 3 đến 30 ký tự.';
                    hint.style.color = '#22c55e';
                }
            } else if (hint) {
                hint.textContent = 'Chỉ chữ thường (a-z), số (0-9) và dấu gạch dưới (_). Từ 3 đến 30 ký tự.';
                hint.style.color = '';
            }
        };

        // Submit
        const _doSubmit = async () => {
            const username = input.value.trim();
            // Kiểm tra 3 lớp phía client trước khi gửi lên server
            const usernameCheck = validateUsernameClient(username);
            if (!usernameCheck.ok) {
                if (errorDiv) {
                    errorDiv.textContent = usernameCheck.message;
                    errorDiv.style.display = 'block';
                }
                return;
            }
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.7';
            const btnSpan = submitBtn.querySelector('span');
            if (btnSpan) btnSpan.textContent = 'Đang lưu...';
            if (errorDiv) errorDiv.style.display = 'none';

            try {
                const res = await fetch('/api/auth/set-username', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username })
                });
                const result = await res.json();
                if (!res.ok) {
                    if (errorDiv) {
                        errorDiv.textContent = result.error || 'Đặt tên đăng nhập thất bại. Vui lòng thử lại.';
                        errorDiv.style.display = 'block';
                    }
                    submitBtn.disabled = false;
                    submitBtn.style.opacity = '1';
                    if (btnSpan) btnSpan.textContent = 'Xác nhận tên đăng nhập';
                    return;
                }
                // Thành công — cập nhật model và ẩn modal
                if (this.model?.state?.activeuser) {
                    this.model.state.activeuser.username = result.username;
                }
                sessionStorage.setItem('bf_username', result.username);
                modalOverlay.style.display = 'none';
                onSuccess();
            } catch (err) {
                if (errorDiv) {
                    errorDiv.textContent = 'Lỗi kết nối. Vui lòng thử lại.';
                    errorDiv.style.display = 'block';
                }
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                if (btnSpan) btnSpan.textContent = 'Xác nhận tên đăng nhập';
            }
        };

        submitBtn.onclick = _doSubmit;
        input.onkeydown = (e) => { if (e.key === 'Enter') _doSubmit(); };
    };

    const handleGoogleResponse = async (response) => {
        if (!response || !response.credential) return;
        setAuthFlowInProgress(true);
        const errorDiv = document.getElementById('login-error');
        if (errorDiv) errorDiv.style.display = 'none';
        hideAuthOverlay();
        showGoogleAuthPending();

        const showGoogleLoginError = (message) => {
            setAuthSessionActive(false);
            setAuthFlowInProgress(false);
            hideGoogleAuthPending();
            const overlay = document.getElementById('auth-overlay');
            const appContainer = document.querySelector('.app-container');
            if (overlay) overlay.style.display = 'flex';
            if (appContainer) appContainer.style.filter = 'blur(10px)';

            const formLogin = document.getElementById('form-auth-login');
            const formRegister = document.getElementById('form-auth-register');
            const formForgot = document.getElementById('form-auth-forgot');
            const formVerify = document.getElementById('form-auth-verify');
            if (formLogin) formLogin.style.display = 'block';
            if (formRegister) formRegister.style.display = 'none';
            if (formForgot) formForgot.style.display = 'none';
            if (formVerify) formVerify.style.display = 'none';

            if (errorDiv) {
                errorDiv.textContent = message;
                errorDiv.style.display = 'block';
            }
        };

        try {
            const res = await fetch('/api/auth/google-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential })
            });
            const data = await res.json();

            if (!res.ok) {
                showGoogleLoginError(data.error || 'Dang nhap Google that bai!');
                return;
            }

            setAuthSessionActive(true);

            // Xu ly ket qua giong login thuong
            sessionStorage.removeItem('bf_session_token');
            localStorage.removeItem('bf_session_token');
            if (data.username) {
                sessionStorage.setItem('bf_username', data.username);
            } else {
                sessionStorage.removeItem('bf_username');
            }
            sessionStorage.setItem('bf_user_id', data.id);
            localStorage.removeItem('bf_remember_me');

            // Ẩn overlay đăng nhập ngay lập tức để người dùng thấy modal Đặt tên đăng nhập (Ảnh 2)
            hideAuthOverlay();

            // Đồng bộ active org mới cho Google Login trước khi init model
            const orgs = (data.organization_name || '').split(',').map(o => o.trim()).filter(Boolean);
            const currentActiveOrg = localStorage.getItem('bf_active_org');
            if (!currentActiveOrg || !orgs.includes(currentActiveOrg)) {
                if (orgs.length > 0) {
                    localStorage.setItem('bf_active_org', orgs[0]);
                } else {
                    localStorage.removeItem('bf_active_org');
                }
            }

            const effectiveRoles = data.effective_roles || [];
            let activeRole = data.role || 'employee';
            if (effectiveRoles.includes('super_admin')) activeRole = 'super_admin';
            else if (effectiveRoles.includes('manager')) activeRole = 'manager';

            // Nếu tài khoản mới chưa đặt username → hiển thị modal bắt buộc ĐẦU TIÊN
            if (data.needs_username) {
                hideGoogleAuthPending();
                this._showSetUsernameModal(
                    activeRole,
                    async () => {
                        // Sau khi họ đặt username thành công và click Xác nhận:
                        // Tiến hành init model và hoàn tất đăng nhập
                        const submitBtn = document.getElementById('btn-set-username-submit');
                        const btnSpan = submitBtn ? submitBtn.querySelector('span') : null;
                        const originalText = btnSpan ? btnSpan.textContent : 'Xác nhận tên đăng nhập';
                        if (btnSpan) btnSpan.textContent = 'Đang khởi tạo thiết lập...';
                        
                        try {
                            await this.model.init();
                            const resolvedUserId = !this.model.hasEffectiveRole(data.role, 'manager')
                                ? (data.id ? data.id : '1')
                                : (this.model.hasEffectiveRole(data.role, 'super_admin') ? 'sa-1' : 'mgr-1');

                            this.model.state.activeuser = {
                                ...(this.model.state.activeuser || {}),
                                dbRole: data.role || '',
                                dbRoles: effectiveRoles
                            };
                            this.model.switchActiveRole(activeRole, data.name, resolvedUserId);
                            this.model.state.activeuser.avatar = data.avatar || '';
                            this.model.state.activeuser.email = data.email || '';
                            this.model.state.activeuser.dbRole = data.role || '';
                            this.model.state.activeuser.dbRoles = effectiveRoles;
                            this.model.state.activeuser.package_id = data.package_id || 'none';
                            this.model.state.activeuser.organization_name = data.organization_name || '';
                            localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));

                            if (data.inactivity_timeout_hours) {
                                localStorage.setItem('bf_inactivity_timeout', data.inactivity_timeout_hours);
                            }

                            await this._finishGoogleLogin(activeRole);
                        } catch (initErr) {
                            console.error('Failed to init model after username set:', initErr);
                            alert('Đã xảy ra lỗi khi khởi tạo dữ liệu. Vui lòng tải lại trang.');
                        }
                    },
                    data.suggested_username || '',
                    data.account_linked || false
                );
                return;
            }

            // Đối với tài khoản bình thường (đã có username), chạy tiếp như cũ:
            await this.model.init();

            const resolvedUserId = !this.model.hasEffectiveRole(data.role, 'manager')
                ? (data.id ? data.id : '1')
                : (this.model.hasEffectiveRole(data.role, 'super_admin') ? 'sa-1' : 'mgr-1');

            this.model.state.activeuser = {
                ...(this.model.state.activeuser || {}),
                dbRole: data.role || '',
                dbRoles: effectiveRoles
            };
            this.model.switchActiveRole(activeRole, data.name, resolvedUserId);
            this.model.state.activeuser.avatar = data.avatar || '';
            this.model.state.activeuser.email = data.email || '';
            this.model.state.activeuser.dbRole = data.role || '';
            this.model.state.activeuser.dbRoles = effectiveRoles;
            this.model.state.activeuser.package_id = data.package_id || 'none';
            this.model.state.activeuser.organization_name = data.organization_name || '';
            localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));

            if (data.inactivity_timeout_hours) {
                localStorage.setItem('bf_inactivity_timeout', data.inactivity_timeout_hours);
            }

            await this._finishGoogleLogin(activeRole);

        } catch (err) {
            showGoogleLoginError('Loi ket noi Google: ' + err.message);
        }
    };

    google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleResponse.bind(this),
        ux_mode: 'popup',
        context: 'signin',
    });

    google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        width: 300,
        text: 'signin_with',
        locale: 'vi',
        logo_alignment: 'center',
    });
}
