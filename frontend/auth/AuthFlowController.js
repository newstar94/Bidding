import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { installAdminModule } from "../app/adminModuleLoader.js";
import { applyAccessContext, selectActiveOrganization } from "./accessContext.js";
import { setActiveOrganizationId } from "../app/workspaceState.js";
import { apiFetch } from "../shared/apiClient.js";
import { validateUsernameClient } from "./usernameClientPolicy.js";
import {
  hideInitLoader,
  isAuthTransitionActive,
  isStaleAuthResult,
  setAuthFlowInProgress,
  setAuthSessionActive
} from "./authRuntimeState.js";
import { hideAuthOverlay, reloadWithInitLoader, showGoogleSignInState } from "./AuthUi.js";
export function setupAuth() {
  const overlay = document.getElementById("auth-overlay");
  if (!overlay) return;
  const formLogin = document.getElementById("form-auth-login");
  const formRegister = document.getElementById("form-auth-register");
  const formForgot = document.getElementById("form-auth-forgot");
  const formReset = document.getElementById("form-auth-reset");
  const formVerify = document.getElementById("form-auth-verify");
  let resetToken = window.location.pathname === "/reset-password"
    ? new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") || ""
    : "";
  const hasLocalWorkspaceData = () => {
    if (typeof this.hasLocalWorkspaceData === "function") {
      return this.hasLocalWorkspaceData();
    }
    const keys = ["kehoach", "goithau", "chudautu", "nhathau", "chuyengia", "hopdong", "thongtinmothau"];
    return keys.some((key) => Array.isArray(this.model.state[key]) && this.model.state[key].length > 0);
  };
  const showLoginOverlay = (requestStartedAt = Date.now()) => {
    if (isAuthTransitionActive() || isStaleAuthResult(requestStartedAt)) {
      hideInitLoader();
      return;
    }
    this.disconnectWebSocket?.(false);
    void this.model.deactivateWorkspace?.();
    this.model.clearSessionData();
    setRuntimeStyle(overlay, "display", "flex");
    setRuntimeStyle(document.querySelector(".app-container"), "filter", "blur(10px)");
    const showResetForm = Boolean(resetToken && formReset);
    setRuntimeStyle(formLogin, "display", showResetForm ? "none" : "block");
    setRuntimeStyle(formRegister, "display", "none");
    setRuntimeStyle(formForgot, "display", "none");
    if (formReset) setRuntimeStyle(formReset, "display", showResetForm ? "block" : "none");
    if (formVerify) setRuntimeStyle(formVerify, "display", "none");
    document.getElementById("login-username").value = "";
    document.getElementById("login-password").value = "";
    hideInitLoader();
  };
  const showCachedWorkspace = async () => {
    setRuntimeStyle(overlay, "display", "none");
    setRuntimeStyle(document.querySelector(".app-container"), "filter", "none");
    this.view.updateActiveUserProfileDisplay();
    try {
      const initialTab = this.getTabNameForPath?.(window.location.pathname) || (this.model.state.activerole === "super_admin" ? "superadmin-dashboard" : "dashboard");
      await this.view.ensureViewModules(initialTab);
      if (["mothau", "danhgiahsdt"].includes(initialTab) && !this._workflowModulesReady) {
        await this.ensureWorkflowModules();
      }
      if (!document.getElementById(`tab-${initialTab}`) && this.lazyTabPartials?.[initialTab]) {
        await this.ensureLazyTab(initialTab);
      }
      if (typeof this.handlePathRouting === "function") {
        await this.handlePathRouting(window.location.pathname, false, true);
      } else {
        await this.switchTab(initialTab);
      }
    } catch (error) {
      console.error("Failed to restore the initial workspace route:", error);
      this.switchTab(this.model.state.activerole === "super_admin" ? "superadmin-dashboard" : "dashboard");
    } finally {
      hideInitLoader();
    }
  };
  const applySessionUser = (user) => {
    if (!user) return;
    if (user.id) {
      sessionStorage.setItem("bf_user_id", user.id);
    }
    if (user.username) {
      sessionStorage.setItem("bf_username", user.username);
    }
    if (!this.model.state.activeuser) this.model.state.activeuser = {};
    applyAccessContext(this.model.state.activeuser, user);
    const requestedRole = this.model.state.activeuser.dbRole ? this.model.state.activerole : null;
    this.model.state.activerole = this.model.constructor.resolveAllowedActiveRole(this.model.state.activeuser, requestedRole);
    this.model.state.activeuser.name = user.name;
    this.model.state.activeuser.avatar = user.avatar || "";
    this.model.state.activeuser.email = user.email || "";
    this.model.state.activeuser.package_id = user.package_id || "none";
    if (user.inactivity_timeout_hours) {
      localStorage.setItem("bf_inactivity_timeout", user.inactivity_timeout_hours);
    }
    this.model.state.activeuser.title = this.model.constructor.getRoleTitle(this.model.state.activerole);
    sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEROLE, JSON.stringify(this.model.state.activerole));
    sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));
    localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));
    this.view.updateActiveUserProfileDisplay();
  };
  const refreshWorkspaceInBackground = () => {
    const runSync = () => {
      const syncPromise = typeof this.scheduleBackgroundSync === "function" ? (this.scheduleBackgroundSync(300), Promise.resolve()) : this.forceSyncData(true);
      this._initialSyncStarted = true;
      syncPromise.catch((err) => {
        console.error("Failed to force sync data after F5 restore:", err);
      });
    };
    if ("requestIdleCallback" in window) {
      requestIdleCallback(runSync, { timeout: 2e3 });
    } else {
      setTimeout(runSync, 500);
    }
  };
  {
    const loaderText = document.getElementById("system-init-loader-text");
    if (loaderText) loaderText.textContent = "Đang tải...";
    const initialPath = window.location.pathname;
    const initialParts = initialPath.startsWith("/") ? initialPath.substring(1).split("/").filter(Boolean) : [];
    const detailRoutePaths = [
      this.routeMap["goithau-detail"],
      this.routeMap["kehoach-detail"],
      this.routeMap["hopdong-detail"],
      this.routeMap["chudautu-detail"],
      this.routeMap["nhathau-detail"]
    ].filter(Boolean);
    const shouldWaitForDetailData = detailRoutePaths.includes(initialParts[0]) && !!initialParts[1];
    const canShowLocalFirst = typeof this.hasLocalDataForRoute === "function" ? this.hasLocalDataForRoute(initialPath) : hasLocalWorkspaceData();
    const sessionCheckStartedAt = Date.now();
    const precheckedSession = this._initialSessionData;
    delete this._initialSessionData;
    const routeManagedByWorkspaceBootstrap = precheckedSession?.valid === true;
    if (routeManagedByWorkspaceBootstrap) {
      setAuthSessionActive(true);
      applySessionUser(precheckedSession.user);
    } else if (canShowLocalFirst) {
      requestAnimationFrame(() => {
        void showCachedWorkspace();
      });
    }
    const sessionPromise = precheckedSession !== void 0 ? Promise.resolve(precheckedSession) : apiFetch("/api/auth/check-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remember: localStorage.getItem("bf_remember_me") === "true" })
    }).then((res) => {
      if (res.ok) return res.json();
      throw new Error("Invalid session response");
    });
    sessionPromise.then(async (data) => {
      if (isAuthTransitionActive() || isStaleAuthResult(sessionCheckStartedAt)) {
        return;
      }
      if (resetToken) {
        setAuthSessionActive(false);
        showLoginOverlay(sessionCheckStartedAt);
        return;
      }
      if (!data || !data.valid) {
        showLoginOverlay(sessionCheckStartedAt);
      } else {
        if (loaderText) loaderText.textContent = "Đang tải...";
        setAuthSessionActive(true);
        const previousUserId = sessionStorage.getItem("bf_user_id");
        if (!routeManagedByWorkspaceBootstrap) {
          applySessionUser(data.user);
        }
        if (data.user?.id && previousUserId !== String(data.user.id)) {
          await this.model.init({ priorityKeys: this.getStartupPriorityKeys?.(window.location.pathname) });
        }
        const effectiveRoles = data.user.effective_roles || [];
        let activeRole = data.user.role || "employee";
        if (effectiveRoles.includes("super_admin")) activeRole = "super_admin";
        else if (effectiveRoles.includes("manager")) activeRole = "manager";
        if (data.user.needs_username) {
          setRuntimeStyle(overlay, "display", "none");
          setRuntimeStyle(document.querySelector(".app-container"), "filter", "blur(10px)");
          hideInitLoader();
          this._showSetUsernameModal(
            activeRole,
            () => {
              setRuntimeStyle(document.querySelector(".app-container"), "filter", "none");
              this._finishGoogleLogin(activeRole);
            },
            data.user.suggested_username || "",
            data.user.account_linked || false
          );
        } else {
          if (!routeManagedByWorkspaceBootstrap && !canShowLocalFirst && !shouldWaitForDetailData) {
            void showCachedWorkspace();
          }
          refreshWorkspaceInBackground();
        }
        this.startBackgroundSessionChecker();
      }
    }).catch((err) => {
      console.error("Session check failed:", err);
      showLoginOverlay(sessionCheckStartedAt);
    });
  }
  const btnShowReg = document.getElementById("link-show-register");
  const btnShowForgot = document.getElementById("link-show-forgot");
  const btnShowLoginFromReg = document.getElementById("link-show-login-from-reg");
  const btnShowLoginFromForgot = document.getElementById("link-show-login-from-forgot");
  const btnShowLoginFromReset = document.getElementById("link-show-login-from-reset");
  const btnShowLoginFromVerify = document.getElementById("link-show-login-from-verify");
  const btnLogout = document.getElementById("btn-auth-logout");
  const switchForm = (showPane) => {
    setRuntimeStyle(formLogin, "display", "none");
    setRuntimeStyle(formRegister, "display", "none");
    setRuntimeStyle(formForgot, "display", "none");
    if (formReset) setRuntimeStyle(formReset, "display", "none");
    if (formVerify) setRuntimeStyle(formVerify, "display", "none");
    document.querySelectorAll(".auth-error-msg, .auth-success-msg").forEach((el) => setRuntimeStyle(el, "display", "none"));
    setRuntimeStyle(showPane, "display", "block");
  };
  let countdownInterval;
  const startOtpCountdown = (username) => {
    const btnResend2 = document.getElementById("btn-resend-otp");
    const timerSpan = document.getElementById("otp-timer");
    const countdownSpan = document.getElementById("otp-countdown");
    if (!btnResend2 || !timerSpan || !countdownSpan) return;
    setRuntimeStyle(btnResend2, "display", "none");
    setRuntimeStyle(timerSpan, "display", "inline");
    let seconds = 60;
    countdownSpan.textContent = seconds;
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      seconds--;
      countdownSpan.textContent = seconds;
      if (seconds <= 0) {
        clearInterval(countdownInterval);
        setRuntimeStyle(btnResend2, "display", "inline");
        setRuntimeStyle(timerSpan, "display", "none");
      }
    }, 1e3);
  };
  if (btnShowReg) btnShowReg.onclick = (e) => {
    e.preventDefault();
    switchForm(formRegister);
  };
  if (btnShowForgot) btnShowForgot.onclick = (e) => {
    e.preventDefault();
    switchForm(formForgot);
  };
  if (btnShowLoginFromReg) btnShowLoginFromReg.onclick = (e) => {
    e.preventDefault();
    switchForm(formLogin);
  };
  if (btnShowLoginFromForgot) btnShowLoginFromForgot.onclick = (e) => {
    e.preventDefault();
    switchForm(formLogin);
  };
  if (btnShowLoginFromReset) btnShowLoginFromReset.onclick = (e) => {
    e.preventDefault();
    resetToken = "";
    window.history.replaceState({}, "", "/");
    switchForm(formLogin);
  };
  if (btnShowLoginFromVerify) btnShowLoginFromVerify.onclick = (e) => {
    e.preventDefault();
    switchForm(formLogin);
  };
  if (btnLogout) {
    btnLogout.onclick = async () => {
      const pendingCount = this.model?.getPendingMutationSummary?.().pendingCount || 0;
      const hasUnsavedForm = Boolean(document.querySelector(".modal-overlay.active[data-bf-unsaved='true']"));
      const warning = pendingCount || hasUnsavedForm
        ? ` Cảnh báo: còn ${pendingCount ? `${pendingCount} thay đổi chưa đồng bộ` : ""}${pendingCount && hasUnsavedForm ? " và " : ""}${hasUnsavedForm ? "biểu mẫu chưa lưu" : ""}.`
        : "";
      const confirmed = await this.view.customConfirm("Xác nhận đăng xuất", `Bạn có chắc chắn muốn đăng xuất tài khoản này không?${warning}`, "log-out");
      if (confirmed) {
        try {
          if (typeof this.autoSync === "function") {
            await this.autoSync();
          }
        } catch (e) {
          console.error("Failed final sync during logout:", e);
        }
        try {
          await apiFetch("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
          });
        } catch (e) {
          console.error("Failed to clear server session during logout:", e);
        }
        if (typeof this.model.purgeWorkspaceData === "function") {
          this.disconnectWebSocket?.(false);
          setActiveOrganizationId("");
          try {
            await this.model.purgeWorkspaceData();
          } catch (error) {
            console.error("Failed to purge local workspace data:", error);
            await this.model.deactivateWorkspace?.();
          }
        } else if (typeof this.resetWorkspaceData === "function") {
          await this.resetWorkspaceData("");
        } else {
          setActiveOrganizationId("");
        }
        this.model.clearSessionData();
        setAuthSessionActive(false);
        setAuthFlowInProgress(false);
        if (this._sessionInterval) clearInterval(this._sessionInterval);
        setRuntimeStyle(overlay, "display", "flex");
        setRuntimeStyle(document.querySelector(".app-container"), "filter", "blur(10px)");
        switchForm(formLogin);
        document.getElementById("login-username").value = "";
        document.getElementById("login-password").value = "";
      }
    };
  }
  formLogin.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errorDiv = document.getElementById("login-error");
    setRuntimeStyle(errorDiv, "display", "none");
    const remember = document.getElementById("login-remember")?.checked || false;
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember })
      });
      const data = await res.json();
      if (!res.ok) {
        errorDiv.textContent = data.error || "Đăng nhập không thành công!";
        setRuntimeStyle(errorDiv, "display", "block");
        if (data.unverified && formVerify) {
          document.getElementById("verify-username-hidden").value = data.username || username;
          document.getElementById("verify-code").value = "";
          setTimeout(() => {
            switchForm(formVerify);
            startOtpCountdown(data.username || username);
          }, 2e3);
        }
        return;
      }
      setAuthSessionActive(true);
      sessionStorage.setItem("bf_username", data.username);
      sessionStorage.setItem("bf_user_id", data.id);
      if (remember) {
        localStorage.setItem("bf_remember_me", "true");
        localStorage.setItem("bf_username", data.username);
        localStorage.setItem("bf_user_id", data.id);
      } else {
        localStorage.removeItem("bf_remember_me");
        localStorage.removeItem("bf_username");
        localStorage.removeItem("bf_user_id");
      }
      selectActiveOrganization(data);
      if (this._workspaceDeferredUntilReload) {
        reloadWithInitLoader();
        return;
      }
      await this.model.init();
      const effectiveRoles = data.effective_roles || [];
      if (effectiveRoles.some((role) => ["manager", "super_admin"].includes(role))) {
        await installAdminModule(this.constructor);
      }
      let activeRole = data.role || "employee";
      if (effectiveRoles.includes("super_admin")) activeRole = "super_admin";
      else if (effectiveRoles.includes("manager")) activeRole = "manager";
      else if (effectiveRoles.includes("employee")) activeRole = "employee";
      this.model.state.activeuser = {
        ...this.model.state.activeuser || {}
      };
      applyAccessContext(this.model.state.activeuser, data);
      this.model.switchActiveRole(activeRole, data.name, data.id);
      this.model.state.activeuser.avatar = data.avatar || "";
      this.model.state.activeuser.email = data.email || "";
      this.model.state.activeuser.package_id = data.package_id || "none";
      localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));
      if (data.inactivity_timeout_hours) {
        localStorage.setItem("bf_inactivity_timeout", data.inactivity_timeout_hours);
      }
      hideAuthOverlay();
      try {
        await this.forceSyncData();
      } catch (err) {
        console.error("Failed to load initial data from SQLite after login:", err);
      }
      if (typeof this.setupWebSocketConnection === "function") {
        this.setupWebSocketConnection();
      }
      this.view.updateActiveUserProfileDisplay();
      if (typeof this.renderWorkspaceSwitcher === "function") {
        this.renderWorkspaceSwitcher();
      }
      if (activeRole === "super_admin") {
        await this.switchTab("superadmin-dashboard");
      } else {
        await this.switchTab("dashboard");
      }
      this.setupRBACEvents?.();
      this.startBackgroundSessionChecker();
    } catch (err) {
      errorDiv.textContent = "Lỗi kết nối máy chủ Starlette: " + err.message;
      setRuntimeStyle(errorDiv, "display", "block");
    }
  };
  formRegister.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById("register-username").value.trim().toLowerCase();
    const fullname = document.getElementById("register-fullname").value.trim();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;
    const confirmPassword = document.getElementById("register-confirm-password").value;
    const role = "employee";
    const errorDiv = document.getElementById("register-error");
    const successDiv = document.getElementById("register-success");
    setRuntimeStyle(errorDiv, "display", "none");
    setRuntimeStyle(successDiv, "display", "none");
    const usernameCheck = validateUsernameClient(username);
    if (!usernameCheck.ok) {
      errorDiv.textContent = usernameCheck.message;
      setRuntimeStyle(errorDiv, "display", "block");
      document.getElementById("register-username").focus();
      return;
    }
    if (password.length < 8 || password.length > 256) {
      errorDiv.textContent = "Mật khẩu phải có từ 8 đến 256 ký tự!";
      setRuntimeStyle(errorDiv, "display", "block");
      return;
    }
    if (password !== confirmPassword) {
      errorDiv.textContent = "Nhập lại mật khẩu không trùng khớp!";
      setRuntimeStyle(errorDiv, "display", "block");
      return;
    }
    try {
      const res = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, name: fullname, email, role })
      });
      const data = await res.json();
      if (!res.ok) {
        errorDiv.textContent = data.error || "Đăng ký tài khoản thất bại!";
        setRuntimeStyle(errorDiv, "display", "block");
        return;
      }
      successDiv.textContent = data.message || "Chúc mừng! Đăng ký tài khoản thành công. Vui lòng nhập mã OTP để xác thực email.";
      setRuntimeStyle(successDiv, "display", "block");
      document.getElementById("verify-username-hidden").value = username;
      document.getElementById("verify-code").value = "";
      formRegister.reset();
      setTimeout(() => {
        switchForm(formVerify);
        startOtpCountdown(username);
      }, 2e3);
    } catch (err) {
      errorDiv.textContent = "Lỗi kết nối máy chủ: " + err.message;
      setRuntimeStyle(errorDiv, "display", "block");
    }
  };
  if (formVerify) {
    formVerify.onsubmit = async (e) => {
      e.preventDefault();
      const username = document.getElementById("verify-username-hidden").value.trim();
      const code = document.getElementById("verify-code").value.trim();
      const errorDiv = document.getElementById("verify-error");
      const successDiv = document.getElementById("verify-success");
      setRuntimeStyle(errorDiv, "display", "none");
      setRuntimeStyle(successDiv, "display", "none");
      if (code.length !== 6) {
        errorDiv.textContent = "Mã xác thực OTP phải gồm đúng 6 chữ số!";
        setRuntimeStyle(errorDiv, "display", "block");
        return;
      }
      try {
        const res = await apiFetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, code })
        });
        const data = await res.json();
        if (!res.ok) {
          errorDiv.textContent = data.error || "Xác thực OTP thất bại!";
          setRuntimeStyle(errorDiv, "display", "block");
          return;
        }
        successDiv.textContent = data.message || "Đang tải...";
        setRuntimeStyle(successDiv, "display", "block");
        if (countdownInterval) clearInterval(countdownInterval);
        setTimeout(() => {
          switchForm(formLogin);
        }, 2e3);
      } catch (err) {
        errorDiv.textContent = "Lỗi kết nối máy chủ: " + err.message;
        setRuntimeStyle(errorDiv, "display", "block");
      }
    };
  }
  const btnResend = document.getElementById("btn-resend-otp");
  if (btnResend) {
    btnResend.onclick = async (e) => {
      e.preventDefault();
      const username = document.getElementById("verify-username-hidden").value.trim();
      const errorDiv = document.getElementById("verify-error");
      const successDiv = document.getElementById("verify-success");
      setRuntimeStyle(errorDiv, "display", "none");
      setRuntimeStyle(successDiv, "display", "none");
      if (!username) {
        errorDiv.textContent = "Không tìm thấy thông tin tài khoản để gửi lại mã!";
        setRuntimeStyle(errorDiv, "display", "block");
        return;
      }
      try {
        const res = await apiFetch("/api/auth/resend-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (!res.ok) {
          errorDiv.textContent = data.error || "Không thể gửi lại mã OTP!";
          setRuntimeStyle(errorDiv, "display", "block");
          return;
        }
        successDiv.textContent = data.message || "Đã gửi lại mã OTP mới!";
        setRuntimeStyle(successDiv, "display", "block");
        startOtpCountdown(username);
      } catch (err) {
        errorDiv.textContent = "Lỗi kết nối máy chủ: " + err.message;
        setRuntimeStyle(errorDiv, "display", "block");
      }
    };
  }
  formForgot.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById("forgot-username").value.trim();
    const email = document.getElementById("forgot-email").value.trim();
    const errorDiv = document.getElementById("forgot-error");
    const successDiv = document.getElementById("forgot-success");
    setRuntimeStyle(errorDiv, "display", "none");
    setRuntimeStyle(successDiv, "display", "none");
    try {
      const res = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email })
      });
      const data = await res.json();
      if (!res.ok) {
        errorDiv.textContent = data.error || "Thông tin khôi phục không hợp lệ!";
        setRuntimeStyle(errorDiv, "display", "block");
        return;
      }
      successDiv.textContent = data.message;
      setRuntimeStyle(successDiv, "display", "block");
    } catch (err) {
      errorDiv.textContent = "Lỗi kết nối máy chủ: " + err.message;
      setRuntimeStyle(errorDiv, "display", "block");
    }
  };
  document.querySelectorAll(".toggle-password").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      if (!input) return;
      const icon = btn.querySelector("i");
      if (input.type === "password") {
        input.type = "text";
        if (icon) {
          icon.setAttribute("data-lucide", "eye-off");
        }
      } else {
        input.type = "password";
        if (icon) {
          icon.setAttribute("data-lucide", "eye");
        }
      }
      if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
        lucide.createIcons();
        const newSvg = btn.querySelector("svg");
        if (newSvg) {
          setRuntimeStyle(newSvg, "cssText", "position:static; pointer-events:none; width:16px; height:16px;");
        }
      }
    };
  });
  const initGoogle = () => {
    if (typeof google !== "undefined" && google.accounts && google.accounts.id) {
      this.setupGoogleSignIn();
    }
  };
  if (formReset) formReset.onsubmit = async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById("reset-new-password").value;
    const confirmPassword = document.getElementById("reset-confirm-password").value;
    const errorDiv = document.getElementById("reset-error");
    const successDiv = document.getElementById("reset-success");
    setRuntimeStyle(errorDiv, "display", "none");
    setRuntimeStyle(successDiv, "display", "none");
    if (!resetToken) {
      errorDiv.textContent = "Liên kết đặt lại mật khẩu không hợp lệ.";
      setRuntimeStyle(errorDiv, "display", "block");
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 256) {
      errorDiv.textContent = "Mật khẩu phải có từ 8 đến 256 ký tự.";
      setRuntimeStyle(errorDiv, "display", "block");
      return;
    }
    if (newPassword !== confirmPassword) {
      errorDiv.textContent = "Mật khẩu xác nhận không khớp.";
      setRuntimeStyle(errorDiv, "display", "block");
      return;
    }
    const csrfToken = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("csrf_token="))
      ?.slice("csrf_token=".length) || "";
    try {
      const res = await apiFetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {})
        },
        body: JSON.stringify({ token: resetToken, new_password: newPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        errorDiv.textContent = data.error || "Không thể đặt lại mật khẩu.";
        setRuntimeStyle(errorDiv, "display", "block");
        return;
      }
      resetToken = "";
      window.history.replaceState({}, "", "/");
      formReset.reset();
      successDiv.textContent = data.message;
      setRuntimeStyle(successDiv, "display", "block");
      const submitButton = formReset.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
    } catch (err) {
      errorDiv.textContent = "Lỗi kết nối máy chủ: " + err.message;
      setRuntimeStyle(errorDiv, "display", "block");
    }
  };
  const loadGoogleIdentity = () => {
    if (typeof google !== "undefined" && google.accounts) {
      initGoogle();
      return;
    }
    const existingScript = document.querySelector("script[data-bf-google-identity]");
    const script = existingScript || document.createElement("script");
    const timeout = setTimeout(() => {
      if (typeof google === "undefined" || !google.accounts) {
        showGoogleSignInState("Không thể tải đăng nhập Google. Vui lòng kiểm tra kết nối mạng.", "error");
      }
    }, 8_000);
    script.addEventListener("load", () => {
      clearTimeout(timeout);
      initGoogle();
    }, { once: true });
    script.addEventListener("error", () => {
      clearTimeout(timeout);
      console.warn("Google Sign-In could not be loaded.");
      showGoogleSignInState("Không thể tải đăng nhập Google. Vui lòng kiểm tra kết nối mạng.", "error");
    }, { once: true });
    if (!existingScript) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.bfGoogleIdentity = "true";
      document.head.appendChild(script);
    }
  };
  if (document.readyState === "complete") {
    setTimeout(loadGoogleIdentity, 0);
  } else {
    window.addEventListener("load", () => setTimeout(loadGoogleIdentity, 0), { once: true });
  }
}
