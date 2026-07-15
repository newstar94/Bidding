import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { showInitLoader } from "./authRuntimeState.js";

export function hideAuthOverlay() {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) setRuntimeStyle(overlay, "display", "none");
  const appContainer = document.querySelector(".app-container");
  if (appContainer) setRuntimeStyle(appContainer, "filter", "none");
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
export function showGoogleAuthPending() {
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
    pending.innerHTML = `
            <div class="bf-s-c439060eb8">
                <div class="bf-s-41cbab3292"></div>
                <div class="bf-s-b0e7843cfa">Đang tạo tài khoản Google</div>
                <div class="bf-s-513ea906bd">Vui lòng chờ trong giây lát...</div>
            </div>
        `;
    document.body.appendChild(pending);
  }
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
  if (!status) return;
  status.textContent = message || "";
  status.hidden = !message;
  status.dataset.state = state;
}
