import { apiFetch } from "./apiClient.js";

const embeddedReleaseId = typeof __BIDDINGFLOW_RELEASE_ID__ === "string"
  ? __BIDDINGFLOW_RELEASE_ID__
  : "development";

export const RELEASE_ID = String(embeddedReleaseId || "development").slice(0, 128);

const STALE_BUNDLE_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Failed to load module script/i,
];
const STALE_BUNDLE_URL_PATTERNS = [
  /Failed to fetch dynamically imported module:\s*([^\s"'<>]+)/i,
  /error loading dynamically imported module:\s*([^\s"'<>]+)/i,
  /Unable to preload CSS for\s+([^\s"'<>]+)/i,
];
const HASHED_ASSET_PATH_PATTERN = /^\/dist\/assets\/[A-Za-z0-9_./-]{1,240}$/;
let staleBundleReloadAttempted = false;

/**
 * A tab can keep an older hashed entry bundle alive across a deployment. Its
 * dynamic imports then point at chunks that were removed by the new release.
 * Reload once so the tab obtains the current HTML/manifest instead of leaving
 * the user with an unhandled promise rejection and a broken workspace.
 */
export const isStaleDynamicImportError = (error) => (
  STALE_BUNDLE_PATTERNS.some((pattern) => (
    pattern.test(String(error?.message || error || ""))
  ))
);

const bundleUrlCandidateFromError = error => {
  const message = String(error?.message || error || "");
  for (const pattern of STALE_BUNDLE_URL_PATTERNS) {
    const candidate = message.match(pattern)?.[1];
    if (candidate) return candidate.replace(/[),;]+$/u, "");
  }
  return "";
};

const safeSameOriginAssetUrl = (candidate, location) => {
  try {
    const baseUrl = location?.href || (location?.origin ? `${location.origin}/` : "");
    if (!baseUrl) return "";
    const baseOrigin = new URL(baseUrl).origin;
    const assetUrl = new URL(candidate, baseUrl);
    if (!/^https?:$/u.test(assetUrl.protocol)) return "";
    if (assetUrl.origin !== baseOrigin) return "";
    if (assetUrl.username || assetUrl.password) return "";
    if (!HASHED_ASSET_PATH_PATTERN.test(assetUrl.pathname)) return "";
    return assetUrl.href;
  } catch {
    return "";
  }
};

const reloadLocation = location => {
  try {
    location.reload();
    return true;
  } catch {
    return false;
  }
};

const refreshAssetThenReload = async ({ assetUrl, fetchAsset, location }) => {
  try {
    const response = await fetchAsset(assetUrl, {
      cache: "reload",
      credentials: "same-origin",
    });
    if (typeof response?.arrayBuffer === "function") {
      await response.arrayBuffer();
    } else if (typeof response?.text === "function") {
      await response.text();
    }
  } catch {
    // A fresh HTML/module graph can still recover when the explicit cache
    // refresh fails, so retain the guarded reload fallback.
  }
  reloadLocation(location);
};

export const recoverFromStaleDynamicImport = ({ error, target = globalThis.window } = {}) => {
  if (!isStaleDynamicImportError(error)) return false;
  const location = target?.location;
  if (!location || typeof location.reload !== "function") return false;

  const candidate = bundleUrlCandidateFromError(error);
  const assetUrl = candidate ? safeSameOriginAssetUrl(candidate, location) : "";
  if (candidate && !assetUrl) return false;

  const marker = `bf-stale-bundle:${RELEASE_ID}`;
  let storage = null;
  try {
    storage = target?.sessionStorage || globalThis.sessionStorage;
    if (staleBundleReloadAttempted || storage?.getItem(marker) === "1") return false;
    storage?.setItem(marker, "1");
    if (storage?.getItem(marker) !== "1") return false;
  } catch {
    // The module-level flag cannot survive a navigation. Without a confirmed
    // session marker, automatically reloading here could loop forever.
    return false;
  }
  staleBundleReloadAttempted = true;

  const fetchAsset = target?.fetch;
  if (assetUrl && typeof fetchAsset === "function") {
    void refreshAssetThenReload({
      assetUrl,
      fetchAsset: fetchAsset.bind(target),
      location,
    });
    return true;
  }
  return reloadLocation(location);
};

const safeErrorName = value => {
  const name = String(value || "Error").trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "Error";
};

const safeDimension = value => {
  const dimension = String(value || "").trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(dimension) ? dimension : "unknown";
};

const safeCorrelationId = value => {
  const correlationId = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(correlationId)
    ? correlationId
    : "";
};

const safeBundlePath = value => {
  try {
    const pathname = new URL(String(value || ""), globalThis.location?.origin || "http://localhost").pathname;
    return /^(?:\/dist\/assets\/|\/frontend\/)[A-Za-z0-9_./-]{1,240}$/.test(pathname)
      ? pathname
      : "unknown";
  } catch {
    return "unknown";
  }
};

const bundlePathFromError = error => String(error?.message || error || "")
  .match(/(?:https?:\/\/[^/\s]+)?(\/(?:dist\/assets|frontend)\/[A-Za-z0-9_./-]{1,240})/i)?.[1]
  || "";

export const buildReleaseDiagnostic = ({ error, filename, lineno, colno, kind = "error" } = {}) => ({
  kind: kind === "unhandledrejection" ? kind : "error",
  releaseId: RELEASE_ID,
  errorName: isStaleDynamicImportError(error)
    ? "StaleBundle.LoadFailure"
    : safeErrorName(error?.name),
  source: safeBundlePath(filename || bundlePathFromError(error)),
  line: Number.isSafeInteger(lineno) && lineno > 0 ? lineno : 0,
  column: Number.isSafeInteger(colno) && colno > 0 ? colno : 0,
});

export const hashWorkspaceScope = async (workspaceKey) => {
  const scope = String(workspaceKey || "").trim();
  if (!scope || scope.length > 512 || !globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(scope),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
};

export const buildOperationalDiagnostic = async ({
  releaseId = RELEASE_ID,
  errorName,
  source,
  operation,
  phase,
  retryable = false,
  backendStatus,
  workspaceKey,
  correlationId,
} = {}) => {
  const boundedErrorName = safeErrorName(errorName);
  const diagnostic = {
    kind: "error",
    releaseId: String(releaseId || RELEASE_ID).slice(0, 128),
    errorName: boundedErrorName === "Error" ? "Operational.Unknown" : boundedErrorName,
    source: safeBundlePath(source),
    line: 0,
    column: 0,
    operation: safeDimension(operation),
    phase: safeDimension(phase),
    retryable: retryable === true,
    backendStatus: safeDimension(backendStatus),
  };
  const workspaceHash = await hashWorkspaceScope(workspaceKey);
  if (workspaceHash) diagnostic.workspaceHash = workspaceHash;
  const boundedCorrelationId = safeCorrelationId(correlationId);
  if (boundedCorrelationId) diagnostic.correlationId = boundedCorrelationId;
  return diagnostic;
};

let reportWindowStartedAt = 0;
let reportsInWindow = 0;

export const reportReleaseDiagnostic = async (diagnostic, now = Date.now()) => {
  if (now - reportWindowStartedAt >= 60_000) {
    reportWindowStartedAt = now;
    reportsInWindow = 0;
  }
  if (reportsInWindow >= 5) return false;
  reportsInWindow += 1;
  try {
    const response = await apiFetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diagnostic),
      timeoutMs: 5_000,
      handleHttpErrors: false,
    });
    return response.ok;
  } catch {
    return false;
  }
};

const INDEXED_DB_READ_CODES = new Set([
  "QUOTA_EXCEEDED",
  "TRANSACTION_ABORTED",
  "PERMISSION_DENIED",
  "CORRUPTED_OR_INCOMPATIBLE",
  "OPERATION_FAILED",
  "NOT_INITIALIZED",
  "STORE_NOT_FOUND",
]);

export const reportIndexedDBReadFailure = (code, { workspaceKey } = {}) => {
  const boundedCode = INDEXED_DB_READ_CODES.has(String(code))
    ? String(code)
    : "OPERATION_FAILED";
  return reportOperationalSignal({
    errorName: `IndexedDBRead.${boundedCode}`,
    source: "/frontend/app/BiddingModel.js",
    operation: "indexeddb-read",
    phase: "workspace-hydration",
    retryable: true,
    backendStatus: "degraded",
    workspaceKey,
  });
};

const VERSION_FALLBACK_REASONS = new Map([
  ["capability_missing", "CapabilityMissing"],
]);

export const reportLegacyVersionFallback = (reason) => {
  const boundedReason = VERSION_FALLBACK_REASONS.get(String(reason)) || "Unknown";
  return reportReleaseDiagnostic({
    column: 0,
    errorName: `LegacyVersionFallback.${boundedReason}`,
    kind: "error",
    line: 0,
    releaseId: RELEASE_ID,
    source: "/frontend/shared/AggregateVersionClient.js",
  });
};

export const reportAggregateVersionConflict = ({ workspaceKey, correlationId } = {}) => reportOperationalSignal({
  errorName: "AggregateVersion.Conflict",
  source: "/frontend/shared/AggregateVersionClient.js",
  operation: "aggregate-version",
  phase: "commit",
  retryable: true,
  backendStatus: "conflict",
  workspaceKey,
  correlationId,
});

const reportOperationalSignal = async (details) => reportReleaseDiagnostic(
  await buildOperationalDiagnostic(details),
);

export const reportSyncConflict = ({ workspaceKey, correlationId } = {}) => reportOperationalSignal({
  errorName: "Sync.Conflict",
  source: "/frontend/app/SyncPushService.js",
  operation: "sync-push",
  phase: "commit",
  retryable: true,
  backendStatus: "conflict",
  workspaceKey,
  correlationId,
});

export const reportOfflineQueuedMutation = ({ workspaceKey } = {}) => reportOperationalSignal({
  errorName: "Sync.OfflineQueued",
  source: "/frontend/app/WorkspaceDataStore.js",
  operation: "workspace-mutation",
  phase: "persist",
  retryable: true,
  backendStatus: "offline",
  workspaceKey,
});

export const reportOutboxFailure = ({ workspaceKey, correlationId } = {}) => reportOperationalSignal({
  errorName: "Outbox.TransportFailure",
  source: "/frontend/app/SyncPushService.js",
  operation: "sync-push",
  phase: "transport",
  retryable: true,
  backendStatus: "transport-error",
  workspaceKey,
  correlationId,
});

export const reportOutboxRetry = ({ workspaceKey } = {}) => reportOperationalSignal({
  errorName: "Outbox.StartupRetry",
  source: "/frontend/app/startupReconciliation.js",
  operation: "sync-push",
  phase: "startup-replay",
  retryable: true,
  backendStatus: "queued",
  workspaceKey,
});

export const reportStartupReconciliationFailure = ({ workspaceKey, correlationId } = {}) => reportOperationalSignal({
  errorName: "Sync.StartupReconciliationFailure",
  source: "/frontend/app/startupReconciliation.js",
  operation: "sync",
  phase: "startup-reconciliation",
  retryable: true,
  backendStatus: "degraded",
  workspaceKey,
  correlationId,
});

export const reportExcelWorkerFailure = () => reportOperationalSignal({
  errorName: "ExcelWorker.Failure",
  source: "/frontend/documents/ExcelParseWorkerClient.js",
  operation: "excel-parse",
  phase: "worker",
  retryable: true,
  backendStatus: "degraded",
});

export const reportExcelWorkerFallback = () => reportOperationalSignal({
  errorName: "ExcelWorker.Fallback",
  source: "/frontend/documents/excelFileReader.js",
  operation: "excel-parse",
  phase: "main-thread-fallback",
  retryable: false,
  backendStatus: "fallback",
});

const LOT_JSON_RECOVERY_CODES = new Map([
  ["MALFORMED_JSON", "MalformedJSON"],
  ["EXPECTED_ARRAY", "ExpectedArray"],
  ["UNSUPPORTED_TYPE", "UnsupportedType"],
]);

const LOT_JSON_RECOVERY_CONTEXTS = new Map([
  ["award_approval_markup", "AwardApprovalMarkup"],
  ["award_history", "AwardHistory"],
  ["award_view_model", "AwardViewModel"],
  ["award_panel", "AwardPanel"],
  ["package_table", "PackageTable"],
  ["package_form", "PackageForm"],
  ["evaluation_scope", "EvaluationScope"],
  ["low_price_rules", "LowPriceRules"],
]);

export const reportLotJsonRecovery = ({ code, context } = {}) => {
  const boundedCode = LOT_JSON_RECOVERY_CODES.get(String(code)) || "Unknown";
  const boundedContext = LOT_JSON_RECOVERY_CONTEXTS.get(String(context)) || "Unknown";
  return reportOperationalSignal({
    errorName: `LotJSON.${boundedCode}.${boundedContext}`,
    source: "/frontend/packages/lotJsonParser.js",
    operation: "lot-json",
    phase: "display-recovery",
    retryable: false,
    backendStatus: "degraded",
  });
};

export const pollingFallbackDurationBucket = (durationMs) => {
  const duration = Math.max(0, Number(durationMs) || 0);
  if (duration < 30_000) return "Under30s";
  if (duration < 300_000) return "30sTo5m";
  return "Over5m";
};

export const reportWebSocketReconnect = ({ workspaceKey } = {}) => reportOperationalSignal({
  errorName: "WebSocket.Reconnect",
  source: "/frontend/app/WebSocketSyncClient.js",
  operation: "realtime",
  phase: "connect",
  retryable: true,
  backendStatus: "reconnecting",
  workspaceKey,
});

export const reportWebSocketPollingFallback = (durationMs, { workspaceKey } = {}) => reportOperationalSignal({
  errorName: `WebSocket.PollingFallback.${pollingFallbackDurationBucket(durationMs)}`,
  source: "/frontend/app/WebSocketSyncClient.js",
  operation: "realtime",
  phase: "polling",
  retryable: true,
  backendStatus: "fallback",
  workspaceKey,
});

export const reportWebSocketMessageFailure = ({ workspaceKey } = {}) => reportOperationalSignal({
  errorName: "WebSocket.MessageFailure",
  source: "/frontend/app/WebSocketSyncClient.js",
  operation: "realtime",
  phase: "message",
  retryable: true,
  backendStatus: "protocol-error",
  workspaceKey,
});

export const installReleaseDiagnostics = (target = globalThis.window) => {
  if (!target?.addEventListener || target.__bfReleaseDiagnosticsInstalled) return;
  Object.defineProperty(target, "__bfReleaseDiagnosticsInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(target, "__BIDDINGFLOW_RELEASE__", {
    value: RELEASE_ID,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  target.addEventListener("vite:preloadError", event => {
    if (recoverFromStaleDynamicImport({ error: event.payload, target })) {
      event.preventDefault?.();
    }
  });
  target.addEventListener("error", event => {
    const diagnostic = buildReleaseDiagnostic(event);
    console.error("BiddingFlow client error", diagnostic);
    void reportReleaseDiagnostic(diagnostic);
  });
  target.addEventListener("unhandledrejection", event => {
    if (recoverFromStaleDynamicImport({ error: event.reason, target })) {
      event.preventDefault?.();
      return;
    }
    const diagnostic = buildReleaseDiagnostic({
      error: event.reason,
      kind: "unhandledrejection",
    });
    console.error("BiddingFlow unhandled rejection", diagnostic);
    void reportReleaseDiagnostic(diagnostic);
  });
};
