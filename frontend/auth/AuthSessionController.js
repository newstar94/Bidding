import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { applyAccessContext } from "./accessContext.js";
import { getActiveOrganizationId } from "../app/workspaceState.js";
import { apiFetch } from "../shared/apiClient.js";
import { claimSessionTermination, isAuthSessionActive } from "./authRuntimeState.js";
import {
  invalidateServerCapabilities,
  updateServerCapabilitiesFromSession,
} from "./serverCapabilities.js";

const SESSION_AUTHENTICATION_CODES = new Set([
  "AUTH_REQUIRED",
  "SESSION_REQUIRED",
  "SESSION_INVALID",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
]);

const SESSION_AUTHENTICATION_MESSAGES = new Set([
  "Thiếu thông tin xác thực phiên làm việc!",
  "Tài khoản không tồn tại!",
  "Phiên làm việc đã hết hạn hoặc không hợp lệ!",
  "Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại.",
  "Phiên người dùng không còn hợp lệ.",
  "Phiên làm việc không còn hiệu lực.",
]);

export function isSessionAuthenticationFailure(status, data = null) {
  const normalizedStatus = Number(status);
  if (normalizedStatus === 401) return true;
  if (normalizedStatus !== 403) return false;

  const code = String(data?.code || data?.error_code || "").trim().toUpperCase();
  if (SESSION_AUTHENTICATION_CODES.has(code)) return true;

  const message = String(data?.error || data?.message || "").trim();
  return SESSION_AUTHENTICATION_MESSAGES.has(message);
}

export function getSessionTerminationNotice(reason, timeoutHours = 10) {
  if (reason === "logged_in_elsewhere" || reason === "session_revoked") {
    return {
      title: "Tài khoản đăng nhập ở thiết bị khác",
      message: "Tài khoản của bạn vừa được đăng nhập tại một thiết bị hoặc trình duyệt khác. Phiên làm việc hiện tại đã bị đóng."
    };
  }
  if (reason === "session_idle_expired") {
    return {
      title: "Phiên đăng nhập hết hạn",
      message: `Bạn đã không hoạt động trong ứng dụng hơn ${timeoutHours} giờ. Vui lòng đăng nhập lại.`
    };
  }
  if (reason === "token_expired") {
    return {
      title: "Phiên đăng nhập hết hạn",
      message: "Thời hạn phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại."
    };
  }
  return null;
}

export function setupActivityTracker() {
  if (this._activityTrackerBound) return;
  this._activityTrackerBound = true;
  const minimumWriteInterval = 15e3;
  let lastWriteAt = Number(localStorage.getItem("bf_last_activity") || 0);
  const updateActivity = (force = false) => {
    if (!force && !isAuthSessionActive()) return;
    const now = Date.now();
    if (!force && now - lastWriteAt < minimumWriteInterval) return;
    lastWriteAt = now;
    localStorage.setItem("bf_last_activity", now.toString());
  };
  ["mousedown", "mousemove", "keypress", "scroll", "touchstart"].forEach((type) => {
    document.addEventListener(type, updateActivity, { passive: true });
  });
  updateActivity(true);
}
export function checkInactivity() {
  const activeUser = this.model?.state?.activeuser;
  if (!activeUser || !activeUser.name) return false;
  const lastActivity = localStorage.getItem("bf_last_activity");
  if (lastActivity) {
    const storedTimeout = localStorage.getItem("bf_inactivity_timeout");
    const timeoutHours = storedTimeout ? parseInt(storedTimeout, 10) : 10;
    const inactivityLimit = timeoutHours * 60 * 60 * 1e3;
    const idleTime = Date.now() - parseInt(lastActivity, 10);
    if (idleTime > inactivityLimit) {
      if (!claimSessionTermination()) return true;
      invalidateServerCapabilities();
      if (this._sessionInterval) clearInterval(this._sessionInterval);
      this.disconnectWebSocket?.(false);
      void Promise.resolve(this.model.purgeWorkspaceData?.() || this.model.deactivateWorkspace?.()).catch((error) => {
        console.error("Failed to clear inactive workspace data:", error);
      });
      this.model.clearSessionData();
      const notice = getSessionTerminationNotice("session_idle_expired", timeoutHours);
      this.view?.showToast?.(notice.title, notice.message, "warning");
      const overlay = document.getElementById("auth-overlay");
      if (overlay) {
        setRuntimeStyle(overlay, "display", "flex");
        setRuntimeStyle(document.querySelector(".app-container"), "filter", "blur(10px)");
        const formLogin = document.getElementById("form-auth-login");
        const formRegister = document.getElementById("form-auth-register");
        const formForgot = document.getElementById("form-auth-forgot");
        setRuntimeStyle(formLogin, "display", "block");
        setRuntimeStyle(formRegister, "display", "none");
        setRuntimeStyle(formForgot, "display", "none");
        document.getElementById("login-username").value = "";
        document.getElementById("login-password").value = "";
      }
      return true;
    }
  }
  return false;
}
export function startBackgroundSessionChecker() {
  if (this._sessionInterval) clearInterval(this._sessionInterval);
  this._sessionExpiryHandled = false;
  this._activeRoleBootstrapAttempted = false;
  const checkSession = () => {
    if (this._sessionCheckInFlight) return this._sessionCheckInFlight;
    if (this.checkInactivity()) {
      clearInterval(this._sessionInterval);
      return;
    }
    const sessionCheck = apiFetch("/api/auth/check-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remember: localStorage.getItem("bf_remember_me") === "true" })
    }).then((res) => {
      if (res.ok) return res.json();
      throw new Error("Invalid session");
    }).then(async (data) => {
      updateServerCapabilitiesFromSession(data);
      if (!data || !data.valid) {
        if (this._sessionExpiryHandled) return;
        if (!claimSessionTermination()) return;
        this._sessionExpiryHandled = true;
        clearInterval(this._sessionInterval);
        this.disconnectWebSocket?.(false);
        void Promise.resolve(this.model.purgeWorkspaceData?.() || this.model.deactivateWorkspace?.()).catch((error) => {
          console.error("Failed to clear expired workspace data:", error);
        });
        this.model.clearSessionData();
        const overlay = document.getElementById("auth-overlay");
        if (overlay) {
          setRuntimeStyle(overlay, "display", "flex");
          setRuntimeStyle(document.querySelector(".app-container"), "filter", "blur(10px)");
          const formLogin = document.getElementById("form-auth-login");
          const formRegister = document.getElementById("form-auth-register");
          const formForgot = document.getElementById("form-auth-forgot");
          if (formLogin) setRuntimeStyle(formLogin, "display", "block");
          if (formRegister) setRuntimeStyle(formRegister, "display", "none");
          if (formForgot) setRuntimeStyle(formForgot, "display", "none");
          document.getElementById("login-username").value = "";
          document.getElementById("login-password").value = "";
        }
        const notice = getSessionTerminationNotice(data?.reason);
        if (notice) this.view?.showToast?.(notice.title, notice.message, "warning");
      } else {
        this._sessionExpiryHandled = false;
        if (data.user) {
          const activeuser = this.model.state.activeuser || {};
          this.model.state.activeuser = activeuser;
          let hasChanges = false;
          const previousAccess = JSON.stringify({
            role: activeuser.dbRole,
            roles: activeuser.dbRoles,
            organizations: activeuser.organizations,
            activeOrganizationId: activeuser.activeOrganizationId
          });
          const previousOrgId = getActiveOrganizationId();
          applyAccessContext(activeuser, data.user);
          let serverActiveRole = data.user.active_role || null;
          let roleRestoreFailed = false;
          if (!serverActiveRole && !this._activeRoleBootstrapAttempted) {
            this._activeRoleBootstrapAttempted = true;
            const storedActiveRole = this.model.state.activerole;
            if (storedActiveRole && storedActiveRole !== "super_admin") {
              try {
                const roleResponse = await apiFetch("/api/auth/active-role", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ active_role: storedActiveRole })
                });
                const rolePayload = await roleResponse.json();
                serverActiveRole = rolePayload.activeRole || null;
              } catch (error) {
                roleRestoreFailed = true;
                console.warn("Could not restore the active role on the server:", error);
              }
            }
          }
          if (roleRestoreFailed) this.model.state.activerole = null;
          const nextActiveRole = this.model.constructor.resolveAllowedActiveRole(
            activeuser,
            serverActiveRole || this.model.state.activerole
          );
          if (this.model.state.activerole !== nextActiveRole) {
            this.model.state.activerole = nextActiveRole;
            hasChanges = true;
          }
          const nextName = data.user.name || data.user.username || activeuser.name || "Người dùng";
          if (activeuser.name !== nextName) {
            activeuser.name = nextName;
            hasChanges = true;
          }
          const nextUsername = data.user.username || activeuser.username || sessionStorage.getItem("bf_username") || "";
          if (activeuser.username !== nextUsername) {
            activeuser.username = nextUsername;
            hasChanges = true;
          }
          if (activeuser.avatar !== (data.user.avatar || "")) {
            activeuser.avatar = data.user.avatar || "";
            hasChanges = true;
          }
          if (activeuser.email !== (data.user.email || "")) {
            activeuser.email = data.user.email || "";
            hasChanges = true;
          }
          const nextAccess = JSON.stringify({
            role: activeuser.dbRole,
            roles: activeuser.dbRoles,
            organizations: activeuser.organizations,
            activeOrganizationId: activeuser.activeOrganizationId
          });
          if (previousAccess !== nextAccess) hasChanges = true;
          const nextTitle = this.model.constructor.getRoleTitle(this.model.state.activerole);
          if (activeuser.title !== nextTitle) {
            activeuser.title = nextTitle;
            hasChanges = true;
          }
          if (activeuser.package_id !== (data.user.package_id || "none")) {
            activeuser.package_id = data.user.package_id || "none";
            hasChanges = true;
          }
          if (hasChanges) {
            sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEROLE, JSON.stringify(this.model.state.activerole));
            sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(activeuser));
            localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(activeuser));
            this.view.updateActiveUserProfileDisplay();
            const nextOrg = getActiveOrganizationId();
            if (previousOrgId && previousOrgId !== nextOrg) {
              await this.switchWorkspaceContext?.(nextOrg, { skipPendingFlush: true, accessRevoked: true });
            }
            if (typeof this.renderWorkspaceSwitcher === "function") {
              this.renderWorkspaceSwitcher();
            }
          }
        }
      }
    }).catch((err) => {
      console.error("Automatic session check failed:", err);
    });
    this._sessionCheckInFlight = sessionCheck.finally(() => {
      this._sessionCheckInFlight = null;
    });
    return this._sessionCheckInFlight;
  };
  this._checkSessionNow = checkSession;
  if (!this._sessionVisibilityBound) {
    this._sessionVisibilityBound = true;
    window.addEventListener("focus", () => this._checkSessionNow?.());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this._checkSessionNow?.();
    });
  }
  // WebSocket handles immediate revocation notifications; polling remains a
  // sparse fallback for sleeping tabs and interrupted socket connections.
  this._sessionInterval = setInterval(checkSession, 5 * 60 * 1e3);
}
