import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { installAdminModule } from "../app/adminModuleLoader.js";
import { applyAccessContext, selectActiveOrganization } from "./accessContext.js";
import { ApiError, apiFetch, postJson } from "../shared/apiClient.js";
import { validateUsernameClient } from "./usernameClientPolicy.js";
import {
  isGoogleIdentityInitialized,
  markGoogleIdentityInitialized,
  resetGoogleIdentityInitialized,
  setAuthFlowInProgress,
  setAuthSessionActive
} from "./authRuntimeState.js";
import {
  hideAuthOverlay,
  hideGoogleAuthPending,
  reloadWithInitLoader,
  showGoogleAuthPending,
  showGoogleSignInState
} from "./AuthUi.js";

export function createGoogleIdentityOptions(clientId, callback) {
  return {
    client_id: clientId,
    callback,
    ux_mode: "popup",
    context: "signin",
    use_fedcm_for_button: false
  };
}

export function resetSetUsernameButton(submitBtn) {
  if (!submitBtn) return null;
  const btnSpan = submitBtn.querySelector("span");
  submitBtn.disabled = false;
  if (btnSpan) btnSpan.textContent = "Xác nhận tên đăng nhập";
  return btnSpan;
}

export function setupGoogleSignIn() {
  if (isGoogleIdentityInitialized()) return;
  const clientId = document.querySelector('meta[name="google-client-id"]')?.content?.trim();
  const container = document.getElementById("google-signin-btn-container");
  if (!container) return;
  if (clientId === "__GOOGLE_CLIENT_ID__" || !clientId) {
    showGoogleSignInState("Đăng nhập Google chưa được cấu hình.", "error");
    return;
  }
  if (typeof google === "undefined" || !google.accounts || !google.accounts.id) return;
  this._finishGoogleLogin = async (activeRole) => {
    setAuthSessionActive(true);
    if (this._workspaceDeferredUntilReload) {
      reloadWithInitLoader();
      return;
    }
    hideAuthOverlay();
    try {
      try {
        await this.forceSyncData();
      } catch (err) {
        console.error("Failed sync after Google login:", err);
      }
      if (typeof this.setupWebSocketConnection === "function") {
        this.setupWebSocketConnection();
      }
      this.view.updateActiveUserProfileDisplay();
      if (typeof this.renderWorkspaceSwitcher === "function") this.renderWorkspaceSwitcher();
      if (activeRole === "super_admin") {
        await this.switchTab("superadmin-dashboard");
      } else {
        await this.switchTab("dashboard");
      }
      this.setupRBACEvents?.();
      this.startBackgroundSessionChecker();
    } finally {
      hideGoogleAuthPending();
      setAuthFlowInProgress(false);
    }
  };
  this._showSetUsernameModal = (activeRole, onSuccess, suggestedUsername = "", accountLinked = false, temporaryPasswordSent = false) => {
    const modalOverlay = document.getElementById("modal-set-username-overlay");
    const input = document.getElementById("input-set-username");
    const errorDiv = document.getElementById("set-username-error");
    const submitBtn = document.getElementById("btn-set-username-submit");
    if (!modalOverlay || !input || !submitBtn) return;
    const btnSpan = resetSetUsernameButton(submitBtn);
    setRuntimeStyle(submitBtn, "opacity", "1");
    let isSubmitting = false;
    const descEl = modalOverlay.querySelector("[data-username-modal-desc]");
    if (descEl) {
      if (accountLinked) {
        descEl.innerHTML = 'Đây là tài khoản cũ của bạn (Email + Mật khẩu) đã được tự động liên kết với Google. Vui lòng đặt <strong>tên đăng nhập</strong> để hoàn tất.<br><span class="bf-s-df017f976f">Lưu ý: Tên này không thể thay đổi sau khi đặt.</span>';
      } else {
        descEl.innerHTML = temporaryPasswordSent
          ? 'Tài khoản Google mới đã được tạo. Vui lòng đặt <strong>tên đăng nhập</strong> để hoàn tất.<br><span class="bf-s-df017f976f">Mật khẩu tạm đã được gửi tới email Google của bạn. Hãy đổi mật khẩu sau lần đăng nhập đầu tiên.</span>'
          : 'Tài khoản Google của bạn đã sẵn sàng. Vui lòng đặt <strong>tên đăng nhập</strong> để hoàn tất.';
      }
    }
    setRuntimeStyle(modalOverlay, "display", "flex");
    if (suggestedUsername) {
      input.value = suggestedUsername;
    } else {
      input.value = "";
    }
    input.focus();
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch (_) {
    }
    if (errorDiv) setRuntimeStyle(errorDiv, "display", "none");
    if (typeof lucide !== "undefined") lucide.createIcons();
    input.oninput = () => {
      const val = input.value.toLowerCase();
      input.value = val.replace(/[^a-z0-9_]/g, "");
      const hint = document.getElementById("set-username-hint");
      if (hint && input.value.length > 0) {
        const check = validateUsernameClient(input.value);
        if (!check.ok) {
          hint.textContent = check.message;
          setRuntimeStyle(hint, "color", "#ef4444");
        } else {
          hint.textContent = "Chỉ chữ thường (a-z), số (0-9) và dấu gạch dưới (_). Từ 3 đến 30 ký tự.";
          setRuntimeStyle(hint, "color", "#22c55e");
        }
      } else if (hint) {
        hint.textContent = "Chỉ chữ thường (a-z), số (0-9) và dấu gạch dưới (_). Từ 3 đến 30 ký tự.";
        setRuntimeStyle(hint, "color", "");
      }
    };
    const _doSubmit = async () => {
      if (isSubmitting) return;
      const username = input.value.trim();
      const usernameCheck = validateUsernameClient(username);
      if (!usernameCheck.ok) {
        if (errorDiv) {
          errorDiv.textContent = usernameCheck.message;
          setRuntimeStyle(errorDiv, "display", "block");
        }
        return;
      }
      isSubmitting = true;
      submitBtn.disabled = true;
      setRuntimeStyle(submitBtn, "opacity", "0.7");
      if (btnSpan) btnSpan.textContent = "Đang lưu...";
      if (errorDiv) setRuntimeStyle(errorDiv, "display", "none");
      try {
        const result = await postJson("/api/auth/set-username", { username });
        if (this.model?.state?.activeuser) {
          this.model.state.activeuser.username = result.username;
        }
        sessionStorage.setItem("bf_username", result.username);
        await onSuccess();
        setRuntimeStyle(modalOverlay, "display", "none");
      } catch (err) {
        isSubmitting = false;
        if (errorDiv) {
          errorDiv.textContent = err instanceof ApiError
            ? err.message
            : "Lỗi kết nối. Vui lòng thử lại.";
          setRuntimeStyle(errorDiv, "display", "block");
        }
        submitBtn.disabled = false;
        setRuntimeStyle(submitBtn, "opacity", "1");
        if (btnSpan) btnSpan.textContent = "Xác nhận tên đăng nhập";
      }
    };
    submitBtn.onclick = _doSubmit;
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        _doSubmit();
      }
    };
  };
  const handleGoogleResponse = async (response) => {
    if (!response || !response.credential) return;
    setAuthFlowInProgress(true);
    const errorDiv = document.getElementById("login-error");
    if (errorDiv) setRuntimeStyle(errorDiv, "display", "none");
    hideAuthOverlay();
    showGoogleAuthPending();
    const showGoogleLoginError = (message) => {
      setAuthSessionActive(false);
      setAuthFlowInProgress(false);
      hideGoogleAuthPending();
      const overlay = document.getElementById("auth-overlay");
      const appContainer = document.querySelector(".app-container");
      if (overlay) setRuntimeStyle(overlay, "display", "flex");
      if (appContainer) setRuntimeStyle(appContainer, "filter", "blur(10px)");
      const formLogin = document.getElementById("form-auth-login");
      const formRegister = document.getElementById("form-auth-register");
      const formForgot = document.getElementById("form-auth-forgot");
      const formVerify = document.getElementById("form-auth-verify");
      if (formLogin) setRuntimeStyle(formLogin, "display", "block");
      if (formRegister) setRuntimeStyle(formRegister, "display", "none");
      if (formForgot) setRuntimeStyle(formForgot, "display", "none");
      if (formVerify) setRuntimeStyle(formVerify, "display", "none");
      if (errorDiv) {
        errorDiv.textContent = message;
        setRuntimeStyle(errorDiv, "display", "block");
      }
    };
    try {
      const res = await apiFetch("/api/auth/google-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await res.json();
      if (!res.ok) {
        showGoogleLoginError(data.error || "Dang nhap Google that bai!");
        return;
      }
      showGoogleAuthPending({
        title: "Đăng nhập Google thành công",
        detail: "Đang tải không gian làm việc..."
      });
      setAuthSessionActive(true);
      if (data.username) {
        sessionStorage.setItem("bf_username", data.username);
      } else {
        sessionStorage.removeItem("bf_username");
      }
      sessionStorage.setItem("bf_user_id", data.id);
      localStorage.removeItem("bf_remember_me");
      hideAuthOverlay();
      const { selected: activeWorkspace } = selectActiveOrganization(data);
      if (!activeWorkspace) {
        this._workspaceDeferredUntilReload = true;
      }
      const effectiveRoles = data.effective_roles || [];
      if (effectiveRoles.some((role) => ["manager", "super_admin"].includes(role))) {
        await installAdminModule(this.constructor);
      }
      let activeRole = data.role || "employee";
      if (effectiveRoles.includes("super_admin")) activeRole = "super_admin";
      else if (effectiveRoles.includes("manager")) activeRole = "manager";
      if (data.needs_username) {
        hideGoogleAuthPending();
        this._showSetUsernameModal(
          activeRole,
          async () => {
            const submitBtn = document.getElementById("btn-set-username-submit");
            const btnSpan = submitBtn ? submitBtn.querySelector("span") : null;
            const originalText = btnSpan ? btnSpan.textContent : "Xác nhận tên đăng nhập";
            if (btnSpan) btnSpan.textContent = "Đang khởi tạo thiết lập...";
            try {
              if (this._workspaceDeferredUntilReload) {
                await this._finishGoogleLogin(activeRole);
                return;
              }
              await this.model.init();
              this.model.state.activeuser = {
                ...this.model.state.activeuser || {}
              };
              applyAccessContext(this.model.state.activeuser, data);
              this.model.switchActiveRole(activeRole, data.name || data.username, data.id);
              this.model.state.activeuser.username = data.username || sessionStorage.getItem("bf_username") || "";
              this.model.state.activeuser.avatar = data.avatar || "";
              this.model.state.activeuser.email = data.email || "";
              this.model.state.activeuser.package_id = data.package_id || "none";
              localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));
              if (data.inactivity_timeout_hours) {
                localStorage.setItem("bf_inactivity_timeout", data.inactivity_timeout_hours);
              }
              await this._finishGoogleLogin(activeRole);
            } catch (initErr) {
              console.error("Failed to init model after username set:", initErr);
              reloadWithInitLoader();
            }
          },
          data.suggested_username || "",
          data.account_linked || false,
          data.temporary_password_sent || false
        );
        return;
      }
      if (this._workspaceDeferredUntilReload) {
        await this._finishGoogleLogin(activeRole);
        return;
      }
      await this.model.init();
      this.model.state.activeuser = {
        ...this.model.state.activeuser || {}
      };
      applyAccessContext(this.model.state.activeuser, data);
      this.model.switchActiveRole(activeRole, data.name || data.username, data.id);
      this.model.state.activeuser.username = data.username || sessionStorage.getItem("bf_username") || "";
      this.model.state.activeuser.avatar = data.avatar || "";
      this.model.state.activeuser.email = data.email || "";
      this.model.state.activeuser.package_id = data.package_id || "none";
      localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));
      if (data.inactivity_timeout_hours) {
        localStorage.setItem("bf_inactivity_timeout", data.inactivity_timeout_hours);
      }
      await this._finishGoogleLogin(activeRole);
    } catch (err) {
      showGoogleLoginError("Lỗi kết nối Google: " + err.message);
    }
  };
  try {
    container.replaceChildren();
    markGoogleIdentityInitialized();
    google.accounts.id.initialize(
      createGoogleIdentityOptions(clientId, handleGoogleResponse.bind(this))
    );
    google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "large",
      width: 300,
      text: "signin_with",
      locale: "vi",
      logo_alignment: "center"
    });
    showGoogleSignInState("", "ready");
  } catch (error) {
    resetGoogleIdentityInitialized();
    console.warn("Google Sign-In could not be initialized.", error);
    showGoogleSignInState("Không thể khởi tạo đăng nhập Google. Vui lòng tải lại trang.", "error");
  }
}
