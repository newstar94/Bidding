const STORAGE_KEY = "bf_pending_commercial_checkout";
const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PERIODS = new Set(["monthly", "yearly"]);

function storageOf(storage = globalThis.sessionStorage) {
  try {
    return storage && typeof storage.getItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

function normalizeIntent(value) {
  if (!value || typeof value !== "object") return null;
  const sku = String(value.sku || "").trim();
  if (!SKU_PATTERN.test(sku)) return null;
  const period = PERIODS.has(value.period) ? value.period : "";
  return { sku, period };
}

export function readPendingCheckoutIntent(storage = globalThis.sessionStorage) {
  const target = storageOf(storage);
  if (!target) return null;
  try {
    return normalizeIntent(JSON.parse(target.getItem(STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

export function savePendingCheckoutIntent(intent, storage = globalThis.sessionStorage) {
  const normalized = normalizeIntent(intent);
  const target = storageOf(storage);
  if (!normalized || !target) return false;
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingCheckoutIntent(storage = globalThis.sessionStorage) {
  const target = storageOf(storage);
  if (!target) return false;
  try {
    target.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function checkoutIntentFromLocation(locationRef = globalThis.location) {
  try {
    const params = new URLSearchParams(locationRef?.search || "");
    return normalizeIntent({ sku: params.get("checkout"), period: params.get("period") });
  } catch {
    return null;
  }
}

export function captureCheckoutIntentFromLocation(locationRef = globalThis.location, storage = globalThis.sessionStorage) {
  const intent = checkoutIntentFromLocation(locationRef);
  return intent ? savePendingCheckoutIntent(intent, storage) : false;
}

export function clearCheckoutIntentFromLocation(locationRef = globalThis.location, historyRef = globalThis.history) {
  try {
    const url = new URL(locationRef.href);
    if (!url.searchParams.has("checkout") && !url.searchParams.has("period")) return false;
    url.searchParams.delete("checkout");
    url.searchParams.delete("period");
    historyRef.replaceState(historyRef.state, "", `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch { return false; }
}

