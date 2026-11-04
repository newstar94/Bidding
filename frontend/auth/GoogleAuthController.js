import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { renderLucideIcons } from "../shared/lucideIcons.js";
import { installAdminModule } from "../app/adminModuleLoader.js";
import {
  LEGAL_CONSENT_REQUIRED_MESSAGE,
  initializeInteractiveLoginModel,
  startInteractivePostLoginServices,
} from "./AuthFlowController.js";
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
import { readPendingCheckoutIntent } from "../commercial-policy/pendingCheckout.js";
import { focusInvalidControl } from "../app/formStateUtils.js";
import { setValidationError } from "../shared/FormValidation.js";

export const GOOGLE_WORKSPACE_INIT_TIMEOUT_MS = 15000;

export function runGoogleWorkspaceStepWithTimeout(task, timeoutMs = GOOGLE_WORKSPACE_INIT_TIMEOUT_MS) {
  const limit = Math.max(1, Number(timeoutMs) || GOOGLE_WORKSPACE_INIT_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      callback(value);
    };
    const timer = globalThis.setTimeout(() => {
      const error = new Error("Khởi tạo không gian làm việc Google quá thời gian chờ.");
      error.code = "GOOGLE_WORKSPACE_INIT_TIMEOUT";
      finish(reject, error);
    }, limit);
    Promise.resolve()
      .then(() => task())
      .then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

// ADR 0097: a Google identity without an account is created only from the
// username step, together with the explicit legal consent.
export function createGoogleRegistrationPayload(username, acceptLegal = false) {
  return { username, acceptLegal: acceptLegal === true };
}

const GOOGLE_REGISTRATION_RESTART_CODES = new Set([
  "GOOGLE_REGISTRATION_EXPIRED",
  "GOOGLE_ACCOUNT_EXISTS",
]);

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

export async function initializeGoogleWorkspaceAfterAuthentication(
  controller,
  data,
  activeRole,
  { installAdmin = installAdminModule } = {},
) {
  if (controller?._workspaceDeferredUntilReload) {
    await controller._finishGoogleLogin(activeRole);
    return { deferredUntilReload: true };
  }
  const effectiveRoles = data.effective_roles || [];
  if (effectiveRoles.some((role) => ["manager", "super_admin"].includes(role))) {
    await installAdmin(controller.constructor);
  }
  await runGoogleWorkspaceStepWithTimeout(() => initializeInteractiveLoginModel(controller));
  controller.model.state.activeuser = {
    ...controller.model.state.activeuser || {}
  };
  applyAccessContext(controller.model.state.activeuser, data);
  controller.model.switchActiveRole(activeRole, data.name || data.username, data.id);
  controller.model.state.activeuser.username = data.username || sessionStorage.getItem("bf_username") || "";
  controller.model.state.activeuser.avatar = data.avatar || "";
  controller.model.state.activeuser.email = data.email || "";
  controller.model.state.activeuser.package_id = data.package_id || "none";
  localStorage.setItem(
    controller.model.STORAGE_KEYS.ACTIVEUSER,
    JSON.stringify(controller.model.state.activeuser),
  );
  if (data.inactivity_timeout_hours) {
    localStorage.setItem("bf_inactivity_timeout", data.inactivity_timeout_hours);
  }
  await controller._finishGoogleLogin(activeRole);
  return { deferredUntilReload: false };
}

export async function continueGoogleLoginAfterAuthentication(
  controller,
  data,
  activeRole,
  {
    documentRef = globalThis.document,
    hidePending = hideGoogleAuthPending,
    initializeWorkspace = initializeGoogleWorkspaceAfterAuthentication,
    reload = reloadWithInitLoader,
  } = {},
) {
  if (!data.needs_username) {
    return initializeWorkspace(controller, data, activeRole);
  }
  hidePending();
  controller._showSetUsernameModal(
    activeRole,
    async () => {
      const submitBtn = documentRef?.getElementById?.("btn-set-username-submit");
      const btnSpan = submitBtn ? submitBtn.querySelector("span") : null;
      if (btnSpan) btnSpan.textContent = "Đang khởi tạo thiết lập...";
      try {
        await initializeWorkspace(controller, data, activeRole);
      } catch (initErr) {
        console.error("Failed to init model after username set:", initErr);
        reload();
      }
    },
    data.suggested_username || "",
    data.account_linked || false,
  );
  return { usernameRequired: true };
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
      this.view.updateActiveUserProfileDisplay();
      if (typeof this.renderWorkspaceSwitcher === "function") this.renderWorkspaceSwitcher();
      if (activeRole === "super_admin") {
        window.location.assign("/admin");
        return;
      } else {
        const pendingCheckout = readPendingCheckoutIntent();
        if (pendingCheckout) this._pendingCommercialCheckout = pendingCheckout;
        const destinationTab = pendingCheckout ? "commercial-storefront" : "dashboard";
        await runGoogleWorkspaceStepWithTimeout(async () => await this.switchTab(destinationTab));
      }
      // Reconciliation derives its route projection from the selected URL.
      // Start it only after navigation so Google login cannot reconcile the
      // stale /dang-nhap route while still returning the UI without awaiting
      // the authoritative pull.
      startInteractivePostLoginServices(this);
      this.setupProfileDropdownEvents?.();
      this.setupRBACEvents?.();
      this.startBackgroundSessionChecker();
    } finally {
      hideGoogleAuthPending();
      setAuthFlowInProgress(false);
    }
  };
  this._showSetUsernameModal = (
    activeRole,
    onSuccess,
    suggestedUsername = "",
    accountLinked = false,
    registration = null,
  ) => {
    const modalOverlay = document.getElementById("modal-set-username-overlay");
    const input = document.getElementById("input-set-username");
    const errorDiv = document.getElementById("set-username-error");
    const submitBtn = document.getElementById("btn-set-username-submit");
    if (!modalOverlay || !input || !submitBtn) return;
    const consentGroup = document.getElementById("set-username-legal-group");
    const acceptLegalInput = document.getElementById("google-accept-legal");
    const backBtn = document.getElementById("btn-set-username-back");
    const submitLabel = registration ? "Tạo tài khoản" : "Xác nhận tên đăng nhập";
    const btnSpan = resetSetUsernameButton(submitBtn);
    if (btnSpan) btnSpan.textContent = submitLabel;
    setRuntimeStyle(submitBtn, "opacity", "1");
    let isSubmitting = false;
    if (consentGroup) consentGroup.hidden = !registration;
    if (acceptLegalInput) {
      acceptLegalInput.checked = false;
      setValidationError(acceptLegalInput, "");
      acceptLegalInput.onchange = () => {
        if (acceptLegalInput.checked) setValidationError(acceptLegalInput, "");
      };
    }
    const closeRegistration = () => {
      setRuntimeStyle(modalOverlay, "display", "none");
      if (consentGroup) consentGroup.hidden = true;
      if (backBtn) backBtn.hidden = true;
    };
    if (backBtn) {
      backBtn.hidden = !registration;
      backBtn.onclick = registration
        ? () => {
          closeRegistration();
          registration.onCancel?.("");
        }
        : null;
    }
    const descEl = modalOverlay.querySelector("[data-username-modal-desc]");
    if (descEl) {
      if (registration) {
        const email = document.createElement("strong");
        email.textContent = registration.email || "";
        descEl.replaceChildren(
          "Email Google ",
          email,
          " chưa có tài khoản BiddingFlow. Đặt tên đăng nhập và đồng ý với các điều khoản để tạo tài khoản.",
        );
      } else if (accountLinked) {
        descEl.innerHTML = trustedHTML('Đây là tài khoản cũ của bạn (Email + Mật khẩu) đã được tự động liên kết với Google. Vui lòng đặt <strong>tên đăng nhập</strong> để hoàn tất.<br><span class="bf-s-df017f976f">Lưu ý: Tên này không thể thay đổi sau khi đặt.</span>');
      } else {
        descEl.innerHTML = trustedHTML('Tài khoản của bạn đã sẵn sàng. Vui lòng đặt <strong>tên đăng nhập</strong> để hoàn tất.');
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
    if (typeof lucide !== "undefined") renderLucideIcons(modalOverlay, lucide);
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
      if (registration && !acceptLegalInput?.checked) {
        if (acceptLegalInput) {
          setValidationError(acceptLegalInput, LEGAL_CONSENT_REQUIRED_MESSAGE);
          focusInvalidControl(acceptLegalInput);
        }
        return;
      }
      isSubmitting = true;
      submitBtn.disabled = true;
      setRuntimeStyle(submitBtn, "opacity", "0.7");
      if (btnSpan) btnSpan.textContent = registration ? "Đang tạo tài khoản..." : "Đang lưu...";
      if (errorDiv) setRuntimeStyle(errorDiv, "display", "none");
      try {
        if (registration) {
          const created = await postJson(
            "/api/auth/google-register",
            createGoogleRegistrationPayload(username, acceptLegalInput?.checked),
          );
          closeRegistration();
          await onSuccess(created);
          return;
        }
        const result = await postJson("/api/auth/set-username", { username });
        if (this.model?.state?.activeuser) {
          this.model.state.activeuser.username = result.username;
        }
        sessionStorage.setItem("bf_username", result.username);
        await onSuccess();
        setRuntimeStyle(modalOverlay, "display", "none");
      } catch (err) {
        isSubmitting = false;
        submitBtn.disabled = false;
        setRuntimeStyle(submitBtn, "opacity", "1");
        if (btnSpan) btnSpan.textContent = submitLabel;
        if (registration && err instanceof ApiError) {
          if (err.code === "LEGAL_CONSENT_REQUIRED" && acceptLegalInput) {
            setValidationError(acceptLegalInput, err.message);
            focusInvalidControl(acceptLegalInput);
            return;
          }
          if (GOOGLE_REGISTRATION_RESTART_CODES.has(err.code)) {
            closeRegistration();
            registration.onCancel?.(err.message);
            return;
          }
        }
        if (errorDiv) {
          errorDiv.textContent = err instanceof ApiError
            ? err.message
            : "Lỗi kết nối. Vui lòng thử lại.";
          setRuntimeStyle(errorDiv, "display", "block");
        }
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
  const showGoogleLoginError = (message) => {
    setAuthSessionActive(false);
    setAuthFlowInProgress(false);
    hideGoogleAuthPending();
    const errorDiv = document.getElementById("login-error");
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
    if (errorDiv && message) {
      errorDiv.textContent = message;
      setRuntimeStyle(errorDiv, "display", "block");
    }
  };
  const completeGoogleLogin = async (data) => {
    try {
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
      let activeRole = data.role || "employee";
      if (effectiveRoles.includes("super_admin")) activeRole = "super_admin";
      else if (effectiveRoles.includes("manager")) activeRole = "manager";
      await continueGoogleLoginAfterAuthentication(this, data, activeRole);
    } catch (err) {
      if (err?.code === "GOOGLE_WORKSPACE_INIT_TIMEOUT") {
        console.error("Google workspace initialization timed out; reloading the authenticated session.");
        reloadWithInitLoader();
        return;
      }
      showGoogleLoginError("Lỗi kết nối Google: " + err.message);
    }
  };
  const handleGoogleResponse = async (response) => {
    if (!response || !response.credential) return;
    setAuthFlowInProgress(true);
    const errorDiv = document.getElementById("login-error");
    if (errorDiv) setRuntimeStyle(errorDiv, "display", "none");
    hideAuthOverlay();
    showGoogleAuthPending();
    let data;
    try {
      const res = await apiFetch("/api/auth/google-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential })
      });
      data = await res.json();
      if (!res.ok) {
        showGoogleLoginError(data.error || "Dang nhap Google that bai!");
        return;
      }
    } catch (err) {
      showGoogleLoginError("Lỗi kết nối Google: " + err.message);
      return;
    }
    if (data.pending_registration) {
      // ADR 0097: no account exists yet; it is created from the username step
      // once the user explicitly accepts the legal documents.
      hideGoogleAuthPending();
      this._showSetUsernameModal(
        "employee",
        (created) => completeGoogleLogin(created),
        data.suggested_username || "",
        false,
        {
          email: data.email || "",
          onCancel: (message) => showGoogleLoginError(message),
        },
      );
      return;
    }
    await completeGoogleLogin(data);
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
