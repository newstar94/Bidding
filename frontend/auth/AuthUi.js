import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { showInitLoader } from "./authRuntimeState.js";

const AUTH_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const AUTH_VIEW_CONFIG = Object.freeze({
  login: { panel: "login", titleId: "auth-login-title" },
  register: { panel: "register", titleId: "auth-register-title" },
  forgot: { panel: "support", titleId: "auth-forgot-title" },
  reset: { panel: "support", titleId: "auth-reset-title" },
  verify: { panel: "support", titleId: "auth-verify-title" },
});

function setInert(element, inert) {
  if (!element) return;
  element.toggleAttribute("inert", inert);
  if (inert) element.setAttribute("aria-hidden", "true");
  else element.removeAttribute("aria-hidden");
}

export function setAuthOverlayView(view = "login", documentRef = globalThis.document) {
  const resolvedView = Object.hasOwn(AUTH_VIEW_CONFIG, view) ? view : "login";
  const config = AUTH_VIEW_CONFIG[resolvedView];
  const overlay = documentRef?.getElementById?.("auth-overlay");
  const card = overlay?.querySelector?.(".auth-card");
  if (!card) return resolvedView;
  card.dataset.authView = config.panel;
  card.dataset.authForm = resolvedView;
  overlay.setAttribute("aria-labelledby", config.titleId);
  card.querySelectorAll(".auth-brand-message").forEach((message) => {
    const active = message.classList.contains(`auth-brand-message-${config.panel}`);
    message.setAttribute("aria-hidden", active ? "false" : "true");
  });
  return resolvedView;
}

export function syncAuthOverlayAccessibility() {
  const overlay = document.getElementById("auth-overlay");
  if (!overlay) return false;
  const visible = !overlay.hidden && getComputedStyle(overlay).display !== "none";
  setInert(overlay, !visible);
  setInert(document.querySelector(".app-container"), visible);
  setInert(document.querySelector(".workspace-skip-link"), visible);
  return visible;
}

export function installAuthOverlayAccessibility() {
  const overlay = document.getElementById("auth-overlay");
  if (!overlay || typeof MutationObserver !== "function") return null;
  syncAuthOverlayAccessibility();
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !syncAuthOverlayAccessibility()) return;
    const focusable = [...overlay.querySelectorAll(AUTH_FOCUSABLE_SELECTOR)]
      .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  });
  const observer = new MutationObserver(syncAuthOverlayAccessibility);
  observer.observe(overlay, {
    attributes: true,
    attributeFilter: ["class", "style", "hidden"]
  });
  return observer;
}

export function hideAuthOverlay() {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) setRuntimeStyle(overlay, "display", "none");
  const appContainer = document.querySelector(".app-container");
  if (appContainer) setRuntimeStyle(appContainer, "filter", "none");
  syncAuthOverlayAccessibility();
}
export function reloadWithInitLoader() {
  const initLoader = showInitLoader();
  if (initLoader) {
    hideGoogleAuthPending();
    void initLoader.offsetHeight;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.location.reload());
  });
}

function ensureGoogleSignInLaunch(container) {
  if (!container) return null;
  const existing = container.querySelector("#google-signin-launch");
  if (existing) return existing;
  const launch = document.createElement("button");
  launch.id = "google-signin-launch";
  launch.className = "google-signin-launch";
  launch.type = "button";
  const mark = document.createElement("span");
  mark.className = "google-signin-launch-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "G";
  const label = document.createElement("span");
  label.className = "google-signin-launch-label";
  label.textContent = "Tiếp tục với Google";
  launch.append(mark, label);
  container.appendChild(launch);
  return launch;
}

export function showGoogleAuthPending({
  title = "Đang đăng nhập bằng Google",
  detail = "Đang xác thực tài khoản..."
} = {}) {
  let pending = document.getElementById("google-auth-pending-overlay");
  if (!pending) {
    pending = document.createElement("div");
    pending.id = "google-auth-pending-overlay";
    setRuntimeStyle(pending, "cssText", [
      "position:fixed",
      "inset:0",
      "z-index:99998",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:rgba(15,23,42,0.72)",
      "backdrop-filter:blur(8px)",
      "-webkit-backdrop-filter:blur(8px)"
    ].join(";"));
    pending.innerHTML = trustedHTML(`
            <div class="bf-s-c439060eb8">
                <div class="bf-s-41cbab3292"></div>
                <div class="bf-s-b0e7843cfa" data-google-auth-pending-title></div>
                <div class="bf-s-513ea906bd" data-google-auth-pending-detail></div>
            </div>
        `);
    document.body.appendChild(pending);
  }
  const titleElement = pending.querySelector("[data-google-auth-pending-title]");
  const detailElement = pending.querySelector("[data-google-auth-pending-detail]");
  if (titleElement) titleElement.textContent = title;
  if (detailElement) detailElement.textContent = detail;
  setRuntimeStyle(pending, "display", "flex");
}
export function hideGoogleAuthPending() {
  const pending = document.getElementById("google-auth-pending-overlay");
  if (pending) setRuntimeStyle(pending, "display", "none");
}

export function showGoogleSignInState(message, state = "loading") {
  const container = document.getElementById("google-signin-btn-container");
  const status = document.getElementById("google-signin-status");
  if (container) container.dataset.state = state;
  const launch = state === "ready" ? container?.querySelector("#google-signin-launch") : ensureGoogleSignInLaunch(container);
  const launchLabel = launch?.querySelector(".google-signin-launch-label");
  if (launch) {
    launch.hidden = state === "ready";
    launch.disabled = state === "loading" || launch.disabled;
    launch.setAttribute("aria-busy", String(state === "loading"));
    if (launchLabel) launchLabel.textContent = state === "loading" ? "Đang kiểm tra Google..." : "Tiếp tục với Google";
  }
  if (!status) return;
  status.textContent = message || "";
  status.hidden = !message;
  status.dataset.state = state;
}

export function setGoogleSignInAction(handler) {
  const container = document.getElementById("google-signin-btn-container");
  const launch = ensureGoogleSignInLaunch(container);
  if (!launch) return;
  const canLaunch = typeof handler === "function";
  launch.disabled = !canLaunch;
  launch.onclick = canLaunch ? (event) => {
    event.preventDefault();
    void handler({ userInitiated: true });
  } : null;
}

