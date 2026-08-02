import { trustedScriptURL } from "../shared/trustedTypes.js";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const widgetIds = new Map();
let scriptPromise;

function metaContent(documentRef, name) {
  return documentRef?.querySelector?.(`meta[name="${name}"]`)?.content?.trim() || "";
}

export function readTurnstileBrowserConfig(documentRef = globalThis.document) {
  const enabled = ["1", "true", "yes", "on"].includes(
    metaContent(documentRef, "bf-turnstile-enabled").toLowerCase()
  );
  return {
    enabled,
    siteKey: enabled ? metaContent(documentRef, "bf-turnstile-site-key") : ""
  };
}

export function isTurnstileEnabled(documentRef = globalThis.document) {
  const config = readTurnstileBrowserConfig(documentRef);
  return Boolean(config.enabled && config.siteKey);
}

function shellFor(action) {
  return document.querySelector(`.auth-turnstile[data-turnstile-action="${action}"]`);
}

function preferredWidgetSize() {
  return globalThis.matchMedia?.("(max-width: 359px)")?.matches
    ? "compact"
    : "flexible";
}

function updateStatus(action, state, message) {
  const shell = shellFor(action);
  if (!shell) return;
  shell.hidden = state !== "interactive" && state !== "error";
  shell.dataset.state = state;
  const status = shell.querySelector(".auth-turnstile-status");
  if (status) status.textContent = message;
}

function loadTurnstileScript() {
  if (globalThis.turnstile?.render) return Promise.resolve(globalThis.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-bf-turnstile="true"]');
    const script = existing || document.createElement("script");
    const onReady = () => {
      if (globalThis.turnstile?.render) resolve(globalThis.turnstile);
      else reject(new Error("Turnstile API không sẵn sàng."));
    };
    const onError = () => reject(new Error("Không thể tải bước xác minh bảo mật."));
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.dataset.bfTurnstile = "true";
      script.async = true;
      script.defer = true;
      script.src = trustedScriptURL(SCRIPT_URL);
      document.head.appendChild(script);
    }
  }).catch((error) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

export async function prepareTurnstile(action) {
  const config = readTurnstileBrowserConfig();
  if (!config.enabled) return false;
  const shell = shellFor(action);
  const target = shell?.querySelector(".auth-turnstile-widget");
  if (!shell || !target || !config.siteKey) return false;
  if (widgetIds.has(action)) return true;
  updateStatus(action, "loading", "Đang chuẩn bị bước xác minh bảo mật…");
  try {
    const api = await loadTurnstileScript();
    if (widgetIds.has(action)) return true;
    const widgetId = api.render(target, {
      sitekey: config.siteKey,
      action,
      theme: "auto",
      size: preferredWidgetSize(),
      appearance: "interaction-only",
      callback() {
        updateStatus(action, "verified", "Đã xác minh");
      },
      "before-interactive-callback"() {
        updateStatus(action, "interactive", "Xác minh để tiếp tục");
      },
      "expired-callback"() {
        updateStatus(action, "error", "Phiên xác minh đã hết hạn. Vui lòng xác minh lại.");
      },
      "error-callback"() {
        updateStatus(action, "error", "Không thể xác minh lúc này. Vui lòng thử lại.");
      }
    });
    widgetIds.set(action, widgetId);
    if (shell.dataset.state === "loading") {
      updateStatus(action, "ready", "Xác minh để tiếp tục");
    }
    return true;
  } catch (error) {
    updateStatus(action, "error", error?.message || "Không thể tải bước xác minh bảo mật.");
    return false;
  }
}

export function getTurnstileToken(action) {
  if (!isTurnstileEnabled()) return "";
  const widgetId = widgetIds.get(action);
  if (widgetId === undefined || !globalThis.turnstile?.getResponse) return "";
  return String(globalThis.turnstile.getResponse(widgetId) || "").trim();
}

export function isTurnstilePrepared(action) {
  return widgetIds.has(action) || shellFor(action)?.hidden === false;
}

export function resetTurnstile(action) {
  const widgetId = widgetIds.get(action);
  if (widgetId === undefined || !globalThis.turnstile?.reset) return;
  globalThis.turnstile.reset(widgetId);
  updateStatus(action, "ready", "Xác minh để tiếp tục");
}

export async function requireTurnstileToken(action) {
  if (!isTurnstileEnabled()) return { enabled: false, token: "" };
  await prepareTurnstile(action);
  const token = getTurnstileToken(action);
  if (!token) {
    updateStatus(action, "error", "Vui lòng hoàn tất bước xác minh bảo mật.");
    shellFor(action)?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }
  return { enabled: true, token };
}
