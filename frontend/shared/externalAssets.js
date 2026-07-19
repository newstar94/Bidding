import { assertSafeStyleURL, trustedScriptURL } from "./trustedTypes.js";

const SCRIPT_LOADERS = /* @__PURE__ */ new Map();
const STYLE_LOADERS = /* @__PURE__ */ new Map();
export function loadScriptOnce(src, globalName) {
  if (globalName && window[globalName]) {
    return Promise.resolve(window[globalName]);
  }
  if (SCRIPT_LOADERS.has(src)) {
    return SCRIPT_LOADERS.get(src);
  }
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(globalName ? window[globalName] : true), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Không thể tải thư viện: ${src}`)), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = trustedScriptURL(src);
    script.async = true;
    script.onload = () => resolve(globalName ? window[globalName] : true);
    script.onerror = () => reject(new Error(`Không thể tải thư viện: ${src}`));
    document.head.appendChild(script);
  });
  SCRIPT_LOADERS.set(src, promise);
  return promise;
}
export function ensureXlsxLoaded() {
  return loadScriptOnce("/vendor/xlsx/xlsx.full.min.js?v=0.20.3", "XLSX");
}
export function loadStyleOnce(href) {
  const safeHref = assertSafeStyleURL(href);
  if (document.querySelector(`link[href="${safeHref}"]`)) {
    return Promise.resolve(true);
  }
  if (STYLE_LOADERS.has(safeHref)) {
    return STYLE_LOADERS.get(safeHref);
  }
  const promise = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = safeHref;
    link.onload = () => resolve(true);
    link.onerror = () => reject(new Error(`Không thể tải stylesheet: ${href}`));
    document.head.appendChild(link);
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
