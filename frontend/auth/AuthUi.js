import { showInitLoader } from "./authRuntimeState.js";

export function hideAuthOverlay() {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) overlay.style.display = "none";
  const appContainer = document.querySelector(".app-container");
  if (appContainer) appContainer.style.filter = "none";
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
    pending.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:99998",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:rgba(15,23,42,0.72)",
      "backdrop-filter:blur(8px)",
      "-webkit-backdrop-filter:blur(8px)"
    ].join(";");
    pending.innerHTML = `
            <div style="background:var(--bg-card,#fff);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,0.22);padding:28px 32px;width:min(420px,calc(100vw - 32px));text-align:center;color:var(--text-main,#111);">
                <div style="width:44px;height:44px;border-radius:50%;border:4px solid #e5e7eb;border-top-color:#4f46e5;margin:0 auto 18px;animation:bf-spin 0.85s linear infinite;"></div>
                <div style="font-size:1rem;font-weight:800;margin-bottom:6px;">Đang tạo tài khoản Google</div>
                <div style="font-size:0.88rem;color:var(--text-muted,#6b7280);line-height:1.45;">Vui lòng chờ trong giây lát...</div>
            </div>
        `;
    const style = document.createElement("style");
    style.id = "google-auth-pending-style";
    style.textContent = "@keyframes bf-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);
    document.body.appendChild(pending);
  }
  pending.style.display = "flex";
}
export function hideGoogleAuthPending() {
  const pending = document.getElementById("google-auth-pending-overlay");
  if (pending) pending.style.display = "none";
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
