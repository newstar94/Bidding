import { assertSafeStyleURL, trustedScriptURL } from "./trustedTypes.js";

const SCRIPT_LOADERS = /* @__PURE__ */ new Map();
const STYLE_LOADERS = /* @__PURE__ */ new Map();

function assetError(message, node, loaders, key) {
  node.dataset.assetState = "error";
  node.remove?.();
  loaders.delete(key);
  return new Error(message);
}

function scriptResult(src, globalName, node) {
  const result = globalName ? window[globalName] : true;
  if (globalName && !result) {
    throw new Error(`Thư viện ${src} đã tải nhưng thiếu global ${globalName}`);
  }
  node.dataset.assetState = "loaded";
  return result;
}

export function loadScriptOnce(src, globalName) {
  if (globalName && window[globalName]) {
    return Promise.resolve(window[globalName]);
  }
  if (SCRIPT_LOADERS.has(src)) {
    return SCRIPT_LOADERS.get(src);
  }
  const existing = document.querySelector(`script[src="${src}"]`);
  const promise = new Promise((resolve, reject) => {
    const script = existing || document.createElement("script");
    const loaded = () => {
      try {
        resolve(scriptResult(src, globalName, script));
      } catch (error) {
        reject(assetError(error.message, script, SCRIPT_LOADERS, src));
      }
    };
    const failed = () => reject(assetError(
      `Không thể tải thư viện: ${src}`,
      script,
      SCRIPT_LOADERS,
      src,
    ));
    if (
      existing
      && (existing.dataset.assetState === "loaded"
        || existing.readyState === "loaded"
        || existing.readyState === "complete")
    ) {
      loaded();
      return;
    }
    script.dataset.assetState = "loading";
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.src = trustedScriptURL(src);
      script.async = true;
      document.head.appendChild(script);
    }
  });
  SCRIPT_LOADERS.set(src, promise);
  return promise;
}
export function ensureXlsxLoaded() {
  return loadScriptOnce("/vendor/xlsx/xlsx.full.min.js?v=0.20.3", "XLSX");
}
export function loadStyleOnce(href) {
  const safeHref = assertSafeStyleURL(href);
  if (STYLE_LOADERS.has(safeHref)) {
    return STYLE_LOADERS.get(safeHref);
  }
  const existing = document.querySelector(`link[href="${safeHref}"]`);
  const promise = new Promise((resolve, reject) => {
    const link = existing || document.createElement("link");
    const loaded = () => {
      link.dataset.assetState = "loaded";
      resolve(true);
    };
    const failed = () => reject(assetError(
      `Không thể tải stylesheet: ${href}`,
      link,
      STYLE_LOADERS,
      safeHref,
    ));
    let existingSheet = false;
    try {
      existingSheet = Boolean(existing?.sheet);
    } catch {
      existingSheet = false;
    }
    if (existing && (existing.dataset.assetState === "loaded" || existingSheet)) {
      loaded();
      return;
    }
    link.dataset.assetState = "loading";
    link.addEventListener("load", loaded, { once: true });
    link.addEventListener("error", failed, { once: true });
    if (!existing) {
      link.rel = "stylesheet";
      link.href = safeHref;
      document.head.appendChild(link);
    }
  });
  STYLE_LOADERS.set(safeHref, promise);
  return promise;
}
export async function ensureFlatpickrLoaded() {
  await loadStyleOnce("/vendor/flatpickr/flatpickr.min.css?v=4");
  await loadScriptOnce("/vendor/flatpickr/flatpickr.min.js?v=4", "flatpickr");
  await loadScriptOnce("/vendor/flatpickr/l10n/vn.js?v=4");
  return window.flatpickr;
}
