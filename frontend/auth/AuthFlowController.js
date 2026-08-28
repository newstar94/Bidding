import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { renderLucideIcons } from "../shared/lucideIcons.js";
import { focusInvalidControl } from "../app/formStateUtils.js";
import { setValidationError } from "../shared/FormValidation.js";
import { trustedScriptURL } from "../shared/trustedTypes.js";
import {
  createGoogleIdentityLoader,
  getGoogleIdentityClientId,
} from "./GoogleIdentityLoader.js";
import { installAdminModule } from "../app/adminModuleLoader.js";
import { applyAccessContext, selectActiveOrganization } from "./accessContext.js";
import { setActiveOrganizationId } from "../app/workspaceState.js";
import { apiFetch } from "../shared/apiClient.js";
import { validateUsernameClient } from "./usernameClientPolicy.js";
import { prepareExplicitLogout } from "./logoutMutationSafety.js";
import {
  beginExplicitLogout,
  hideInitLoader,
  isAuthTransitionActive,
  isStaleAuthResult,
  setAuthFlowInProgress,
  setAuthSessionActive
} from "./authRuntimeState.js";
import { updateServerCapabilitiesFromSession } from "./serverCapabilities.js";
import {
  hideAuthOverlay,
  reloadWithInitLoader,
  setGoogleSignInAction,
  setAuthOverlayView,
  showGoogleSignInState,
} from "./AuthUi.js";
import {
  isTurnstilePrepared,
  prepareTurnstile,
  requireTurnstileToken,
  resetTurnstile
} from "./TurnstileController.js";

export function resolveSessionRequestedRole({ previousUser, previousRole, sessionUser } = {}) {
  const serverRole = String(sessionUser?.active_role || "").trim().toLowerCase();
  if (serverRole) return serverRole;
  const previousId = String(previousUser?.id || "").trim();
  const sessionId = String(sessionUser?.id || "").trim();
  const previousUsername = String(previousUser?.username || "").trim().toLowerCase();
  const sessionUsername = String(sessionUser?.username || "").trim().toLowerCase();
  const sameAccount = Boolean(
    (previousId && sessionId && previousId === sessionId)
    || (previousUsername && sessionUsername && previousUsername === sessionUsername)
  );
  return sameAccount ? previousRole || null : null;
}

export function createRegistrationPayload({ username, password, name, email, turnstileToken = "" }) {
  const payload = { username, password, name, email };
  if (turnstileToken) payload.turnstileToken = turnstileToken;
  return payload;
}

const PASSWORD_MISMATCH_MESSAGE = "Mật khẩu nhập lại không khớp.";

export function updatePasswordConfirmationState(
  passwordInput,
  confirmationInput,
  errorElement,
  { force = false } = {},
) {
  if (!passwordInput || !confirmationInput || !errorElement) return true;
  const password = String(passwordInput.value || "");
  const confirmation = String(confirmationInput.value || "");
  const comparisonReady = Boolean(confirmation)
    && (force || confirmation.length >= password.length);
  const mismatch = comparisonReady && password !== confirmation;

  confirmationInput.setCustomValidity(mismatch ? PASSWORD_MISMATCH_MESSAGE : "");
  if (mismatch) {
    confirmationInput.setAttribute("aria-invalid", "true");
  } else {
    confirmationInput.removeAttribute("aria-invalid");
  }
  confirmationInput.closest(".form-group")?.classList.toggle("invalid", mismatch);
  errorElement.textContent = mismatch ? PASSWORD_MISMATCH_MESSAGE : "";
  errorElement.hidden = !mismatch;
  return !mismatch;
}

export function createSingleFlightSubmitHandler(handler, {
  onStart = null,
  onDuplicate = null,
  onSettled = null,
} = {}) {
  let inFlight = false;
  return async (event, ...args) => {
    event?.preventDefault?.();
    if (inFlight) {
      onDuplicate?.();
      return undefined;
    }
    inFlight = true;
    onStart?.();
    try {
      return await handler(event, ...args);
    } finally {
      inFlight = false;
      onSettled?.();
    }
  };
}

export function startPostLoginReconciliation(controller) {
  controller?.initializeStartupReconciliation?.();
  let task;
  try {
    if (typeof controller?.reconcileInitialRouteData === "function") {
      task = controller.reconcileInitialRouteData();
    } else if (typeof controller?.forceSyncData === "function") {
      task = controller.forceSyncData(true, true, true);
    } else {
      return { started: false, promise: Promise.resolve(false) };
    }
  } catch (error) {
    task = Promise.reject(error);
  }
  const promise = Promise.resolve(task).catch((error) => {
    console.error("Failed to reconcile workspace after login:", error);
    return false;
  });
  return { started: true, promise };
}

export function resolvePostLoginActiveRole(data = {}) {
  const effectiveRoles = Array.isArray(data.effective_roles) ? data.effective_roles : [];
  const confirmedRole = String(data.active_role || "").trim().toLowerCase();
  if (effectiveRoles.includes(confirmedRole)) return confirmedRole;
  if (effectiveRoles.includes("super_admin")) return "super_admin";
  if (effectiveRoles.includes("manager")) return "manager";
  if (effectiveRoles.includes("employee")) return "employee";
  return String(data.role || "employee").trim().toLowerCase() || "employee";
}

export function setLoginSubmitBusy(form, button, label, busy, defaultLabel = "Đăng nhập") {
  if (busy) form?.setAttribute?.("aria-busy", "true");
  else form?.removeAttribute?.("aria-busy");
  if (button) {
    button.disabled = busy;
    if (busy) button.setAttribute?.("aria-busy", "true");
    else button.removeAttribute?.("aria-busy");
  }
  if (label) label.textContent = busy ? "Đang đăng nhập…" : defaultLabel;
}

export function setupAuth() {
  const overlay = document.getElementById("auth-overlay");
  if (!overlay) return;
  const formLogin = document.getElementById("form-auth-login");
  const formRegister = document.getElementById("form-auth-register");
  const formForgot = document.getElementById("form-auth-forgot");
  const formReset = document.getElementById("form-auth-reset");
  const formVerify = document.getElementById("form-auth-verify");
  const registerPasswordInput = document.getElementById("register-password");
  const registerConfirmPasswordInput = document.getElementById("register-confirm-password");
  const registerConfirmPasswordError = document.getElementById("register-confirm-password-error");
  const registerUsernameInput = document.getElementById("register-username");
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
    setAuthOverlayView(showResetForm ? "reset" : "login");
    setRuntimeStyle(formLogin, "display", showResetForm ? "none" : "block");
    setRuntimeStyle(formRegister, "display", "none");
    setRuntimeStyle(formForgot, "display", "none");
    if (formReset) setRuntimeStyle(formReset, "display", showResetForm ? "block" : "none");
    if (formVerify) setRuntimeStyle(formVerify, "display", "none");
    showGoogleSignInState("", "idle");
    setGoogleSignInAction(loadGoogleIdentity);
    scheduleGoogleIdentityLoad();
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
      const workflowRequirement = this.getWorkflowRequirementForRoute?.(initialTab);
      if (!this.isWorkflowRequirementReady?.(workflowRequirement)) {
        await this.ensureWorkflowRequirement(workflowRequirement);
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
    const previousUser = this.model.state.activeuser;
    const previousRole = this.model.state.activerole;
    const requestedRole = resolveSessionRequestedRole({
      previousUser,
      previousRole,
      sessionUser: user,
    });
    if (user.id) {
      sessionStorage.setItem("bf_user_id", user.id);
    }
    if (user.username) {
      sessionStorage.setItem("bf_username", user.username);
    }
    if (!this.model.state.activeuser) this.model.state.activeuser = {};
    applyAccessContext(this.model.state.activeuser, user);
    this.model.state.activerole = this.model.constructor.resolveAllowedActiveRole(this.model.state.activeuser, requestedRole);
    this.model.state.activeuser.name = user.name || user.username || "Người dùng";
    this.model.state.activeuser.username = user.username || sessionStorage.getItem("bf_username") || "";
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
      updateServerCapabilitiesFromSession(data);
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
  const btnBrandRegister = document.getElementById("btn-auth-brand-register");
  const btnBrandLogin = document.getElementById("btn-auth-brand-login");
  const btnBrandBack = document.getElementById("btn-auth-brand-back");
  const btnLogout = document.getElementById("btn-auth-logout");
  const switchForm = (showPane) => {
    setRuntimeStyle(formLogin, "display", "none");
    setRuntimeStyle(formRegister, "display", "none");
    setRuntimeStyle(formForgot, "display", "none");
    if (formReset) setRuntimeStyle(formReset, "display", "none");
    if (formVerify) setRuntimeStyle(formVerify, "display", "none");
    document.querySelectorAll(".auth-error-msg, .auth-success-msg").forEach((el) => setRuntimeStyle(el, "display", "none"));
    setRuntimeStyle(showPane, "display", "block");
    const viewByFormId = {
      "form-auth-login": "login",
      "form-auth-register": "register",
      "form-auth-forgot": "forgot",
      "form-auth-reset": "reset",
      "form-auth-verify": "verify",
    };
    setAuthOverlayView(viewByFormId[showPane?.id] || "login");
    const challengeActions = {
      "form-auth-register": "register",
      "form-auth-forgot": "forgot_password"
    };
    const action = challengeActions[showPane?.id];
    if (action) void prepareTurnstile(action);
  };
  let countdownInterval;
  const startOtpCountdown = () => {
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
  if (btnBrandRegister) btnBrandRegister.onclick = () => switchForm(formRegister);
  if (btnBrandLogin) btnBrandLogin.onclick = () => switchForm(formLogin);
  if (btnBrandBack) btnBrandBack.onclick = () => switchForm(formLogin);
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
  if (registerPasswordInput && registerConfirmPasswordInput && registerConfirmPasswordError) {
    const updatePasswordMatch = (force = false) => updatePasswordConfirmationState(
      registerPasswordInput,
      registerConfirmPasswordInput,
      registerConfirmPasswordError,
      { force },
    );
    registerConfirmPasswordInput.addEventListener("input", () => {
      updatePasswordMatch(
        registerConfirmPasswordInput.value.length >= registerPasswordInput.value.length,
      );
    });
    registerConfirmPasswordInput.addEventListener("blur", () => updatePasswordMatch(true));
    registerPasswordInput.addEventListener("input", () => {
      updatePasswordMatch(Boolean(registerConfirmPasswordInput.value));
    });
    formRegister.addEventListener("reset", () => {
      queueMicrotask(() => updatePasswordMatch(false));
    });
  }
  if (registerUsernameInput) {
    const syncUsernameValidity = () => {
      const value = registerUsernameInput.value.trim().toLowerCase();
      const result = value ? validateUsernameClient(value) : { ok: true, message: "" };
      registerUsernameInput.setCustomValidity(result.ok ? "" : result.message);
      if (registerUsernameInput.getAttribute("aria-invalid") === "true") {
        setValidationError(registerUsernameInput, result.ok ? "" : result.message);
      }
    };
    registerUsernameInput.addEventListener("input", syncUsernameValidity);
    registerUsernameInput.addEventListener("blur", syncUsernameValidity);
    formRegister.addEventListener("reset", () => {
      queueMicrotask(() => {
        registerUsernameInput.setCustomValidity("");
        setValidationError(registerUsernameInput, "");
      });
    });
  }
  if (btnLogout) {
    btnLogout.onclick = async () => {
      const hasUnsavedForm = Boolean(document.querySelector(".modal-overlay.active[data-bf-unsaved='true']"));
      const warning = hasUnsavedForm
        ? " Cảnh báo: còn biểu mẫu chưa lưu."
        : "";
      const confirmed = await this.view.customConfirm("Xác nhận đăng xuất", `Bạn có chắc chắn muốn đăng xuất tài khoản này không?${warning}`, "log-out");
      if (confirmed) {
        const logoutDecision = await prepareExplicitLogout(this);
        if (!logoutDecision.proceed) return;
        beginExplicitLogout();
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
        window.location.assign("/");
      }
    };
  }
  const loginSubmitButton = formLogin.querySelector('button[type="submit"]');
  const loginSubmitLabel = loginSubmitButton?.querySelector("span");
  const loginSubmitDefaultLabel = loginSubmitLabel?.textContent || "Đăng nhập";
  formLogin.onsubmit = createSingleFlightSubmitHandler(async () => {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errorDiv = document.getElementById("login-error");
    setRuntimeStyle(errorDiv, "display", "none");
    const remember = document.getElementById("login-remember")?.checked || false;
    try {
      let turnstileToken = "";
      if (isTurnstilePrepared("login")) {
        const challenge = await requireTurnstileToken("login");
        if (challenge.enabled && !challenge.token) {
          return;
        }
        turnstileToken = challenge.token;
      }
      let res;
      try {
        res = await apiFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, remember, ...(turnstileToken ? { turnstileToken } : {}) })
        });
      } finally {
        if (turnstileToken) resetTurnstile("login");
      }
      let data = await res.json();
      if (!res.ok) {
        errorDiv.textContent = data.error || "Đăng nhập không thành công!";
        setRuntimeStyle(errorDiv, "display", "block");
        if (data.code === "BOT_CHALLENGE_REQUIRED") {
          await prepareTurnstile("login");
        }
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
      const activeRole = resolvePostLoginActiveRole(data);
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
      this.view.updateActiveUserProfileDisplay();
      if (typeof this.renderWorkspaceSwitcher === "function") {
        this.renderWorkspaceSwitcher();
      }
      if (activeRole === "super_admin") {
        await this.switchTab("superadmin-dashboard");
      } else {
        await this.switchTab("dashboard");
      }
      this.setupProfileDropdownEvents?.();
      hideAuthOverlay();
      this.setupRBACEvents?.();
      this.startBackgroundSessionChecker();
      const reconciliation = startPostLoginReconciliation(this);
      void reconciliation.promise.then(() => {
        this.setupWebSocketConnection?.();
      });
    } catch (err) {
      errorDiv.textContent = "Lỗi kết nối máy chủ Starlette: " + err.message;
      setRuntimeStyle(errorDiv, "display", "block");
    }
  }, {
    onStart: () => {
      setLoginSubmitBusy(
        formLogin, loginSubmitButton, loginSubmitLabel, true, loginSubmitDefaultLabel,
      );
    },
    onDuplicate: () => {
      const errorDiv = document.getElementById("login-error");
      if (!errorDiv) return;
      errorDiv.textContent = "Yêu cầu đăng nhập đang được xử lý…";
      setRuntimeStyle(errorDiv, "display", "block");
    },
    onSettled: () => {
      setLoginSubmitBusy(
        formLogin, loginSubmitButton, loginSubmitLabel, false, loginSubmitDefaultLabel,
      );
    },
  });
  formRegister.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById("register-username").value.trim().toLowerCase();
    const fullname = document.getElementById("register-fullname").value.trim();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;
    const confirmPassword = document.getElementById("register-confirm-password").value;
    const errorDiv = document.getElementById("register-error");
    const successDiv = document.getElementById("register-success");
    setRuntimeStyle(errorDiv, "display", "none");
    setRuntimeStyle(successDiv, "display", "none");
    const usernameCheck = validateUsernameClient(username);
    if (!usernameCheck.ok) {
      setValidationError(registerUsernameInput, usernameCheck.message);
      focusInvalidControl(registerUsernameInput);
      return;
    }
    if (password.length < 8 || password.length > 256) {
      setValidationError(registerPasswordInput, "Mật khẩu phải có từ 8 đến 256 ký tự.");
      focusInvalidControl(registerPasswordInput);
      return;
    }
    if (password !== confirmPassword) {
      updatePasswordConfirmationState(
        registerPasswordInput,
        registerConfirmPasswordInput,
        registerConfirmPasswordError,
        { force: true },
      );
      registerConfirmPasswordInput?.focus();
      return;
    }
    try {
      const challenge = await requireTurnstileToken("register");
      if (challenge.enabled && !challenge.token) {
        return;
      }
      let res;
      try {
        res = await apiFetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createRegistrationPayload({
            username,
            password,
            name: fullname,
            email,
            turnstileToken: challenge.token
          }))
        });
      } finally {
        if (challenge.token) resetTurnstile("register");
      }
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
        const codeInput = document.getElementById("verify-code");
        setValidationError(codeInput, "Mã xác thực OTP phải gồm đúng 6 chữ số.");
        focusInvalidControl(codeInput);
        return;
      }
      try {
        let turnstileToken = "";
        if (isTurnstilePrepared("verify_email")) {
          const challenge = await requireTurnstileToken("verify_email");
          if (challenge.enabled && !challenge.token) return;
          turnstileToken = challenge.token;
        }
        let res;
        try {
          res = await apiFetch("/api/auth/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, code, ...(turnstileToken ? { turnstileToken } : {}) })
          });
        } finally {
          if (turnstileToken) resetTurnstile("verify_email");
        }
        const data = await res.json();
        if (!res.ok) {
          errorDiv.textContent = data.error || "Xác thực OTP thất bại!";
          setRuntimeStyle(errorDiv, "display", "block");
          if (data.code === "BOT_CHALLENGE_REQUIRED") {
            await prepareTurnstile("verify_email");
          }
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
        const challenge = await requireTurnstileToken("resend_code");
        if (challenge.enabled && !challenge.token) {
          return;
        }
        let res;
        try {
          res = await apiFetch("/api/auth/resend-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, ...(challenge.token ? { turnstileToken: challenge.token } : {}) })
          });
        } finally {
          if (challenge.token) resetTurnstile("resend_code");
        }
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
      const challenge = await requireTurnstileToken("forgot_password");
      if (challenge.enabled && !challenge.token) {
        return;
      }
      let res;
      try {
        res = await apiFetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, ...(challenge.token ? { turnstileToken: challenge.token } : {}) })
        });
      } finally {
        if (challenge.token) resetTurnstile("forgot_password");
      }
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
        renderLucideIcons(btn, lucide);
        const newSvg = btn.querySelector("svg");
        if (newSvg) {
          setRuntimeStyle(newSvg, "cssText", "position:static; pointer-events:none; width:16px; height:16px;");
        }
      }
    };
  });
  const googleIdentityLoader = createGoogleIdentityLoader({
    documentRef: document,
    globalRef: window,
    scriptUrl: trustedScriptURL("https://accounts.google.com/gsi/client"),
  });
  const initGoogle = () => {
    if (googleIdentityLoader.isReady()) this.setupGoogleSignIn();
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
      const newPasswordInput = document.getElementById("reset-new-password");
      setValidationError(newPasswordInput, "Mật khẩu phải có từ 8 đến 256 ký tự.");
      focusInvalidControl(newPasswordInput);
      return;
    }
    if (newPassword !== confirmPassword) {
      const confirmPasswordInput = document.getElementById("reset-confirm-password");
      setValidationError(confirmPasswordInput, "Mật khẩu xác nhận không khớp.");
      focusInvalidControl(confirmPasswordInput);
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
  let googleIdentityLoadPromise = null;
  let googleIdentityLoadScheduled = false;
  const loadGoogleIdentity = ({ userInitiated = false } = {}) => {
    if (googleIdentityLoader.isReady()) {
      initGoogle();
      if (userInitiated && document.getElementById("google-signin-btn-container")?.dataset.state === "ready") {
        globalThis.google?.accounts?.id?.prompt?.();
      }
      return Promise.resolve(true);
    }
    if (!getGoogleIdentityClientId(document)) {
      showGoogleSignInState("Đăng nhập Google chưa được cấu hình.", "error");
      setGoogleSignInAction(loadGoogleIdentity);
      return Promise.resolve(false);
    }
    if (googleIdentityLoadPromise) return googleIdentityLoadPromise;
    googleIdentityLoadPromise = googleIdentityLoader.load()
      .then(() => {
        initGoogle();
        if (userInitiated && document.getElementById("google-signin-btn-container")?.dataset.state === "ready") {
          globalThis.google?.accounts?.id?.prompt?.();
        }
        return true;
      })
      .catch((error) => {
        console.warn("Google Sign-In could not be loaded.", error);
        showGoogleSignInState("Không thể tải đăng nhập Google. Vui lòng kiểm tra kết nối mạng hoặc thử lại.", "error");
        setGoogleSignInAction(loadGoogleIdentity);
        return false;
      })
      .finally(() => {
        googleIdentityLoadPromise = null;
      });
    return googleIdentityLoadPromise;
  };
  const scheduleGoogleIdentityLoad = () => {
    if (googleIdentityLoader.isReady() || googleIdentityLoadScheduled) return;
    googleIdentityLoadScheduled = true;
    setTimeout(() => {
      googleIdentityLoadScheduled = false;
      void loadGoogleIdentity();
    }, 0);
  };
  showGoogleSignInState("", "idle");
  setGoogleSignInAction(loadGoogleIdentity);
}
