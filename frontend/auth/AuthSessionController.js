import { applyAccessContext } from "./accessContext.js";
import { getActiveOrganizationId } from "../app/workspaceState.js";
import { apiFetch } from "../shared/apiClient.js";
import { isAuthSessionActive } from "./authRuntimeState.js";
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
      if (this._sessionInterval) clearInterval(this._sessionInterval);
      this.disconnectWebSocket?.(false);
      void Promise.resolve(this.model.purgeWorkspaceData?.() || this.model.deactivateWorkspace?.()).catch((error) => {
        console.error("Failed to clear inactive workspace data:", error);
      });
      this.model.clearSessionData();
      const showSessionExpired = async () => {
        if (this.view && typeof this.view.customAlert === "function") {
          await this.view.customAlert("Phiên làm việc hết hạn", "Bạn đã không hoạt động trong ứng dụng hơn " + timeoutHours + " giờ. Vui lòng đăng nhập lại để đảm bảo bảo mật thông tin.", "clock");
        } else {
          const banner = document.createElement("div");
          banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:14px 24px;font-weight:700;font-size:0.9rem;text-align:center;";
          banner.textContent = "⏳ Phiên làm việc hết hạn — Vui lòng đăng nhập lại để đảm bảo bảo mật.";
          document.body.prepend(banner);
          setTimeout(() => banner.remove(), 5e3);
        }
      };
      showSessionExpired();
      const overlay = document.getElementById("auth-overlay");
      if (overlay) {
        overlay.style.display = "flex";
        document.querySelector(".app-container").style.filter = "blur(10px)";
        const formLogin = document.getElementById("form-auth-login");
        const formRegister = document.getElementById("form-auth-register");
        const formForgot = document.getElementById("form-auth-forgot");
        formLogin.style.display = "block";
        formRegister.style.display = "none";
        formForgot.style.display = "none";
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
  const checkSession = () => {
    if (this.checkInactivity()) {
      clearInterval(this._sessionInterval);
      return;
    }
    apiFetch("/api/auth/check-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remember: localStorage.getItem("bf_remember_me") === "true" })
    }).then((res) => {
      if (res.ok) return res.json();
      throw new Error("Invalid session");
    }).then(async (data) => {
      if (!data || !data.valid) {
        clearInterval(this._sessionInterval);
        this.disconnectWebSocket?.(false);
        void Promise.resolve(this.model.purgeWorkspaceData?.() || this.model.deactivateWorkspace?.()).catch((error) => {
          console.error("Failed to clear expired workspace data:", error);
        });
        this.model.clearSessionData();
        const overlay = document.getElementById("auth-overlay");
        if (overlay) {
          overlay.style.display = "flex";
          document.querySelector(".app-container").style.filter = "blur(10px)";
          const formLogin = document.getElementById("form-auth-login");
          const formRegister = document.getElementById("form-auth-register");
          const formForgot = document.getElementById("form-auth-forgot");
          if (formLogin) formLogin.style.display = "block";
          if (formRegister) formRegister.style.display = "none";
          if (formForgot) formForgot.style.display = "none";
          document.getElementById("login-username").value = "";
          document.getElementById("login-password").value = "";
        }
        if (data && data.reason === "logged_in_elsewhere") {
          this.view.showToast("Tài khoản đăng nhập ở thiết bị khác", "Tài khoản của bạn vừa được đăng nhập tại một thiết bị hoặc trình duyệt khác. Phiên làm việc hiện tại đã bị đóng.", "warning");
        } else {
          this.view.showToast("Phiên đăng nhập hết hạn", "Phiên đăng nhập của bạn đã hết hiệu lực hoặc không hợp lệ. Vui lòng đăng nhập lại.", "warning");
        }
      } else {
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
          const nextActiveRole = this.model.constructor.resolveAllowedActiveRole(activeuser, this.model.state.activerole);
          if (this.model.state.activerole !== nextActiveRole) {
            this.model.state.activerole = nextActiveRole;
            hasChanges = true;
          }
          if (activeuser.name !== data.user.name) {
            activeuser.name = data.user.name;
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
