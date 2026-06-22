/* ==========================================================================
   BiddingFlow - AuthController (Part of Controller split)
   ========================================================================== */

export function setupActivityTracker() {
    const updateActivity = () => {
        localStorage.setItem('bf_last_activity', Date.now().toString());
    };
    
    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(type => {
        document.addEventListener(type, updateActivity, { passive: true });
    });
    
    // Initial set if user is already logged in
    const token = localStorage.getItem('bf_session_token');
    if (token && !localStorage.getItem('bf_last_activity')) {
        updateActivity();
    }
}

export function checkInactivity() {
    const token = localStorage.getItem('bf_session_token');
    const username = localStorage.getItem('bf_username');
    if (!token || !username) return false;

    const lastActivity = localStorage.getItem('bf_last_activity');
    if (lastActivity) {
        const idleTime = Date.now() - parseInt(lastActivity, 10);
        const tenHours = 10 * 60 * 60 * 1000; // 10 hours in milliseconds
        if (idleTime > tenHours) {
            if (this._sessionInterval) clearInterval(this._sessionInterval);
            this.model.clearSessionData();
            
            // Show session expired notification using custom popup if available, else fallback to styled banner
            const showSessionExpired = async () => {
                if (this.view && typeof this.view.customAlert === 'function') {
                    await this.view.customAlert('Phiên làm việc hết hạn', 'Bạn đã không hoạt động trong ứng dụng hơn 10 giờ. Vui lòng đăng nhập lại để đảm bảo bảo mật thông tin.', 'clock');
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
        const token = localStorage.getItem('bf_session_token');
        const username = localStorage.getItem('bf_username');
        if (!token || !username) {
            clearInterval(this._sessionInterval);
            return;
        }

        // Check if the user is idle first
        if (this.checkInactivity()) {
            clearInterval(this._sessionInterval);
            return;
        }

        fetch('/api/auth/check-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, session_token: token })
        }).then(res => {
            if (res.ok) return res.json();
            throw new Error("Invalid session");
        }).then(data => {
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
                    this.view.customAlert('Tài khoản đăng nhập ở thiết bị khác', 'Tài khoản của bạn vừa được đăng nhập tại một thiết bị hoặc trình duyệt khác. Phiên làm việc hiện tại đã bị đóng.', 'warning');
                } else {
                    this.view.customAlert('Phiên đăng nhập hết hạn', 'Phiên đăng nhập của bạn đã hết hiệu lực hoặc không hợp lệ. Vui lòng đăng nhập lại.', 'warning');
                }
            } else {
                if (data.user) {
                    const activeuser = this.model.state.activeuser;
                    let hasChanges = false;
                    if (activeuser.name !== data.user.name) { activeuser.name = data.user.name; hasChanges = true; }
                    if (activeuser.avatar !== (data.user.avatar || '')) { activeuser.avatar = data.user.avatar || ''; hasChanges = true; }
                    if (activeuser.email !== (data.user.email || '')) { activeuser.email = data.user.email || ''; hasChanges = true; }
                    if (activeuser.dbRole !== (data.user.role || '')) { activeuser.dbRole = data.user.role || ''; hasChanges = true; }
                    if (activeuser.package_id !== (data.user.package_id || 'none')) { activeuser.package_id = data.user.package_id || 'none'; hasChanges = true; }
                    if (activeuser.organization_name !== (data.user.organization_name || '')) { activeuser.organization_name = data.user.organization_name || ''; hasChanges = true; }
                    if (hasChanges) {
                        localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(activeuser));
                        if (this.model.db) {
                            this.model.db.set(this.model.STORAGE_KEYS.ACTIVEUSER, activeuser).catch(() => {});
                        }
                        this.view.updateActiveUserProfileDisplay();
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

    const token = localStorage.getItem('bf_session_token');
    const username = localStorage.getItem('bf_username');

    if (!token || !username) {
        overlay.style.display = 'flex';
        document.querySelector('.app-container').style.filter = 'blur(10px)';
        formLogin.style.display = 'block';
        formRegister.style.display = 'none';
        formForgot.style.display = 'none';
    } else {
        fetch('/api/auth/check-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, session_token: token })
        }).then(res => {
            if (res.ok) {
                return res.json();
            }
            throw new Error("Invalid session response");
        }).then(data => {
            if (!data || !data.valid) {
                this.model.clearSessionData();
                overlay.style.display = 'flex';
                document.querySelector('.app-container').style.filter = 'blur(10px)';
                formLogin.style.display = 'block';
                formRegister.style.display = 'none';
                formForgot.style.display = 'none';
                document.getElementById('login-username').value = '';
                document.getElementById('login-password').value = '';
            } else {
                // Update active user details dynamically to prevent cache issues
                if (data.user) {
                    this.model.state.activeuser.name = data.user.name;
                    this.model.state.activeuser.avatar = data.user.avatar || '';
                    this.model.state.activeuser.email = data.user.email || '';
                    this.model.state.activeuser.dbRole = data.user.role || '';
                    this.model.state.activeuser.dbRoles = data.user.effective_roles || [];
                    this.model.state.activeuser.package_id = data.user.package_id || 'none';
                    this.model.state.activeuser.organization_name = data.user.organization_name || '';
                    
                    let title = 'Chuyên viên';
                    if (this.model.state.activerole === 'super_admin') title = 'Super Admin';
                    else if (this.model.state.activerole === 'manager') title = 'Quản lý';
                    this.model.state.activeuser.title = title;

                    localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));
                    if (this.model.db) {
                        this.model.db.set(this.model.STORAGE_KEYS.ACTIVEUSER, this.model.state.activeuser).catch(() => {});
                    }
                }

                // Hide Auth overlay
                overlay.style.display = 'none';
                document.querySelector('.app-container').style.filter = 'none';

                // Bootstrap visual profile and tab
                this.view.updateActiveUserProfileDisplay();

                // Khôi phục tab từ URL ngay lập tức (không đợi sync để tránh trễ)
                if (typeof this.handlePathRouting === 'function') {
                    this.handlePathRouting(window.location.pathname, false, true);
                } else {
                    const activeRole = this.model.state.activerole;
                    if (activeRole === 'super_admin') {
                        this.switchTab('superadmin-dashboard');
                    } else {
                        this.switchTab('dashboard');
                    }
                }

                // Sync data — sau khi sync xong, re-route để giải mã mã gói thầu từ URL
                this.forceSyncData().then(() => {
                    // Re-route sau sync để đảm bảo goithau-detail có thể map maGoiThau → id
                    if (typeof this.handlePathRouting === 'function') {
                        this.handlePathRouting(window.location.pathname, false, true);
                    }
                }).catch(err => {
                    console.error("Failed to force sync data after F5 restore:", err);
                });

                this.startBackgroundSessionChecker();
            }
        }).catch(err => {
            console.error("Lỗi kiểm tra phiên làm việc:", err);
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

                this.model.clearSessionData();
                if (this._sessionInterval) clearInterval(this._sessionInterval);

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

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
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

            // Save to localStorage
            localStorage.setItem('bf_session_token', data.session_token);
            localStorage.setItem('bf_username', data.username);
            localStorage.setItem('bf_user_id', data.id);

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

            this.model.switchActiveRole(activeRole, data.name, resolvedUserId);
            this.model.state.activeuser.avatar = data.avatar || '';
            this.model.state.activeuser.email = data.email || '';
            this.model.state.activeuser.dbRole = data.role || '';
            this.model.state.activeuser.dbRoles = effectiveRoles;
            this.model.state.activeuser.package_id = data.package_id || 'none';
            this.model.state.activeuser.organization_name = data.organization_name || '';
            localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));
            if (this.model.db) {
                this.model.db.set(this.model.STORAGE_KEYS.ACTIVEUSER, this.model.state.activeuser).catch(() => {});
            }

            // Hide Auth overlay
            overlay.style.display = 'none';
            document.querySelector('.app-container').style.filter = 'none';

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
        const username = document.getElementById('register-username').value.trim();
        const fullname = document.getElementById('register-fullname').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value.trim();
        const confirmPassword = document.getElementById('register-confirm-password').value.trim();
        const role = 'employee';
        const errorDiv = document.getElementById('register-error');
        const successDiv = document.getElementById('register-success');

        errorDiv.style.display = 'none';
        successDiv.style.display = 'none';

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

                successDiv.textContent = data.message || 'Xác thực thành công! Đang chuyển hướng đăng nhập...';
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
}

