import { setRuntimeStyle } from "../shared/runtimeStyles.js";
let flowInProgress = false;
let sessionActive = false;
let stateChangedAt = 0;
let googleIdentityInitialized = false;

export function setAuthFlowInProgress(value) {
  flowInProgress = !!value;
  stateChangedAt = Date.now();
}

export function setAuthSessionActive(value) {
  sessionActive = !!value;
  stateChangedAt = Date.now();
  if (sessionActive) setAuthFlowInProgress(false);
}

export const isAuthTransitionActive = () => flowInProgress;
export const isAuthSessionActive = () => sessionActive;
export const isStaleAuthResult = (startedAt) => (
  Number.isFinite(startedAt) && Number.isFinite(stateChangedAt) && startedAt < stateChangedAt
);

export const isGoogleIdentityInitialized = () => googleIdentityInitialized;
export const markGoogleIdentityInitialized = () => { googleIdentityInitialized = true; };
export const resetGoogleIdentityInitialized = () => { googleIdentityInitialized = false; };

export function hideInitLoader() {
  const loader = document.getElementById("system-init-loader");
  if (!loader) return;
  setRuntimeStyle(loader, "opacity", "0");
  setRuntimeStyle(loader, "visibility", "hidden");
  loader.setAttribute("aria-busy", "false");
  document.body.classList.remove("bf-init-loading");
}

export function showInitLoader(message = "Đang tải...") {
  const loader = document.getElementById("system-init-loader");
  if (!loader) return null;
  document.body.classList.add("bf-init-loading");
  const messageElement = loader.querySelector("#system-init-loader-text");
  if (messageElement) messageElement.textContent = message;
  setRuntimeStyle(loader, "display", "flex");
  setRuntimeStyle(loader, "opacity", "1");
  setRuntimeStyle(loader, "visibility", "visible");
  loader.setAttribute("aria-busy", "true");
  return loader;
}
