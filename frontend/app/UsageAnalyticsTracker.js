import { apiFetch } from "../shared/apiClient.js";

export const USAGE_EVENT_ENDPOINT = "/api/usage-analytics/events";
export const USAGE_HEARTBEAT_INTERVAL_MS = 60_000;
const VISIBILITY_DEDUPE_MS = 5_000;

export const USAGE_FEATURE_BY_TAB = Object.freeze({
  dashboard: "dashboard",
  kehoach: "plans",
  "kehoach-detail": "plans",
  goithau: "packages",
  "goithau-detail": "packages",
  "goithau-timeline": "timeline",
  mothau: "bid-opening",
  danhgiahsdt: "bid-evaluation",
  chudautu: "investors",
  "chudautu-detail": "investors",
  nhathau: "contractors",
  "nhathau-detail": "contractors",
  chuyengia: "experts",
  hopdong: "contracts",
  "hopdong-detail": "contracts",
  bieumau: "templates",
  "xuatban-word": "word-publication",
  "superadmin-dashboard": "dashboard",
  superadmin: "account-admin",
  "commercial-admin": "commercial",
  "commercial-storefront": "commercial",
  "usage-analytics": "usage-analytics",
  profile: "profile",
});

const ALLOWED_FEATURES = new Set(Object.values(USAGE_FEATURE_BY_TAB));

export function featureCodeForTab(tabName) {
  return USAGE_FEATURE_BY_TAB[String(tabName || "")] || "";
}

function isVisible(documentRef) {
  return !documentRef || documentRef.visibilityState !== "hidden";
}

export function createUsageAnalyticsTracker({
  documentRef = globalThis.document,
  setIntervalImpl = globalThis.setInterval?.bind(globalThis),
  clearIntervalImpl = globalThis.clearInterval?.bind(globalThis),
  now = () => Date.now(),
  send = null,
} = {}) {
  let stopped = false;
  let intervalId = null;
  let request = null;
  let lastHeartbeatAt = 0;
  let lastFeature = "";

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (intervalId !== null) clearIntervalImpl?.(intervalId);
    intervalId = null;
    request?.abort();
    request = null;
    documentRef?.removeEventListener?.("visibilitychange", onVisibilityChange);
  };

  const post = async (payload) => {
    if (stopped) return false;
    const controller = new AbortController();
    request = controller;
    try {
      const response = send
        ? await send(payload, controller.signal)
        : await apiFetch(USAGE_EVENT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          handleHttpErrors: false,
          retries: 0,
          timeoutMs: 10_000,
          signal: controller.signal,
        });
      if (response?.status === 401 || response?.status === 403) stop();
      return Boolean(response?.ok);
    } catch {
      // Telemetry is deliberately best-effort and must never interrupt the
      // user's navigation or business action.
      return false;
    } finally {
      if (request === controller) request = null;
    }
  };

  const heartbeat = ({ force = false } = {}) => {
    if (stopped || !isVisible(documentRef)) return false;
    const currentTime = now();
    if (!force && lastHeartbeatAt > 0 && currentTime - lastHeartbeatAt < VISIBILITY_DEDUPE_MS) return false;
    lastHeartbeatAt = currentTime;
    void post({ eventType: "heartbeat" });
    return true;
  };

  const trackFeature = (tabName, { force = false } = {}) => {
    if (stopped) return false;
    const feature = featureCodeForTab(tabName);
    if (!ALLOWED_FEATURES.has(feature)) return false;
    if (!force && feature === lastFeature) return false;
    lastFeature = feature;
    void post({ eventType: "feature_used", feature });
    return true;
  };

  function onVisibilityChange() {
    if (documentRef?.visibilityState === "visible") heartbeat();
  }

  const start = ({ initialTab = "" } = {}) => {
    if (stopped || intervalId !== null) return false;
    documentRef?.addEventListener?.("visibilitychange", onVisibilityChange);
    heartbeat({ force: true });
    if (initialTab) trackFeature(initialTab);
    intervalId = setIntervalImpl?.(() => heartbeat({ force: true }), USAGE_HEARTBEAT_INTERVAL_MS) ?? null;
    return true;
  };

  return Object.freeze({ start, stop, heartbeat, trackFeature, isStopped: () => stopped });
}

export function startUsageAnalyticsTracker(controller, options = {}) {
  controller?.usageAnalyticsTracker?.stop?.();
  const tracker = createUsageAnalyticsTracker(options);
  if (controller) controller.usageAnalyticsTracker = tracker;
  tracker.start({ initialTab: controller?.model?.state?.activetab || "" });
  return tracker;
}
