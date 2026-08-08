import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { invalidateServerCapabilities } from "./serverCapabilities.js";
let flowInProgress = false;
let sessionActive = false;
let stateChangedAt = 0;
let googleIdentityInitialized = false;
let explicitLogoutInProgress = false;
let sessionTerminationHandled = false;

const EXPLICIT_LOGOUT_KEY = "bf_explicit_logout_at";
const EXPLICIT_LOGOUT_TTL_MS = 30_000;

function readStoredLogoutAt(storage) {
  try {
    return Number(storage?.getItem?.(EXPLICIT_LOGOUT_KEY) || 0);
  } catch {
    return 0;
  }
}

function clearStoredLogout(storage) {
  try {
    storage?.removeItem?.(EXPLICIT_LOGOUT_KEY);
  } catch {
  }
}

export function setAuthFlowInProgress(value) {
  flowInProgress = !!value;
  stateChangedAt = Date.now();
}

export function setAuthSessionActive(value, storage = globalThis.localStorage) {
  sessionActive = !!value;
  stateChangedAt = Date.now();
  if (sessionActive) {
    explicitLogoutInProgress = false;
    sessionTerminationHandled = false;
    clearStoredLogout(storage);
    setAuthFlowInProgress(false);
  } else {
    invalidateServerCapabilities();
  }
}

export const isAuthTransitionActive = () => flowInProgress;
export const isAuthSessionActive = () => sessionActive;

export function beginExplicitLogout(storage = globalThis.localStorage, now = Date.now()) {
  explicitLogoutInProgress = true;
  invalidateServerCapabilities();
  try {
    storage?.setItem?.(EXPLICIT_LOGOUT_KEY, String(now));
  } catch {
  }
}

export function isExplicitLogoutInProgress(storage = globalThis.localStorage, now = Date.now()) {
  if (explicitLogoutInProgress) return true;
  const logoutAt = readStoredLogoutAt(storage);
  return logoutAt > 0 && now - logoutAt >= 0 && now - logoutAt <= EXPLICIT_LOGOUT_TTL_MS;
}

export function claimSessionTermination(storage = globalThis.localStorage, now = Date.now()) {
  if (!sessionActive || sessionTerminationHandled || isExplicitLogoutInProgress(storage, now)) {
    return false;
  }
  sessionTerminationHandled = true;
  sessionActive = false;
  stateChangedAt = now;
  return true;
}
export const isStaleAuthResult = (startedAt) => (
  Number.isFinite(startedAt) && Number.isFinite(stateChangedAt) && startedAt < stateChangedAt
);

export const isGoogleIdentityInitialized = () => googleIdentityInitialized;
export const markGoogleIdentityInitialized = () => { googleIdentityInitialized = true; };
export const resetGoogleIdentityInitialized = () => { googleIdentityInitialized = false; };

export function hideInitLoader() {
  const loader = document.getElementById("system-init-loader");
  if (loader) {
    setRuntimeStyle(loader, "opacity", "0");
    setRuntimeStyle(loader, "visibility", "hidden");
    loader.setAttribute("aria-busy", "false");
  }
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
