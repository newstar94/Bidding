export const GOOGLE_IDENTITY_SCRIPT_URL = "https://accounts.google.com/gsi/client";

export function hasGoogleIdentityApi(globalRef = globalThis) {
  return Boolean(globalRef?.google?.accounts?.id);
}

export function createGoogleIdentityLoader({
  documentRef = globalThis.document,
  globalRef = globalThis,
  scriptUrl = GOOGLE_IDENTITY_SCRIPT_URL,
  loadTimeoutMs = 8_000,
  setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
} = {}) {
  let inFlight = null;

  const findScript = () => documentRef?.querySelector?.("script[data-bf-google-identity]") || null;
  const removeScript = (script) => {
    if (script?.dataset?.bfGoogleIdentity !== "true") return;
    if (typeof script.remove === "function") script.remove();
    else script.parentNode?.removeChild?.(script);
  };

  const load = () => {
    if (hasGoogleIdentityApi(globalRef)) return Promise.resolve();
    if (inFlight) return inFlight;
    if (!documentRef?.createElement || !documentRef?.head?.appendChild) {
      return Promise.reject(new Error("Google Identity could not be loaded: document is unavailable."));
    }

    const existingScript = findScript();
    const script = existingScript || documentRef.createElement("script");
    let timeoutId = null;
    let settled = false;
    inFlight = new Promise((resolve, reject) => {
      const cleanup = () => {
        if (timeoutId !== null) clearTimeoutFn?.(timeoutId);
        script.removeEventListener?.("load", onLoad);
        script.removeEventListener?.("error", onError);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        removeScript(script);
        inFlight = null;
        reject(error);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        inFlight = null;
        resolve();
      };
      const onLoad = () => {
        if (hasGoogleIdentityApi(globalRef)) succeed();
        else fail(new Error("Google Identity could not be loaded: API is unavailable."));
      };
      const onError = () => fail(new Error("Google Identity could not be loaded."));
      script.addEventListener?.("load", onLoad, { once: true });
      script.addEventListener?.("error", onError, { once: true });
      timeoutId = setTimeoutFn?.(
        () => fail(new Error("Google Identity could not be loaded before the timeout.")),
        loadTimeoutMs,
      );
      if (!existingScript) {
        script.src = scriptUrl;
        script.async = true;
        script.defer = true;
        script.dataset.bfGoogleIdentity = "true";
        documentRef.head.appendChild(script);
      }
    });
    return inFlight;
  };

  return { isReady: () => hasGoogleIdentityApi(globalRef), load };
}
