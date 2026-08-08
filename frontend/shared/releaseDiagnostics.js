import { apiFetch } from "./apiClient.js";

const embeddedReleaseId = typeof __BIDDINGFLOW_RELEASE_ID__ === "string"
  ? __BIDDINGFLOW_RELEASE_ID__
  : "development";

export const RELEASE_ID = String(embeddedReleaseId || "development").slice(0, 128);

const safeErrorName = value => {
  const name = String(value || "Error").trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "Error";
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

export const buildReleaseDiagnostic = ({ error, filename, lineno, colno, kind = "error" } = {}) => ({
  kind: kind === "unhandledrejection" ? kind : "error",
  releaseId: RELEASE_ID,
  errorName: safeErrorName(error?.name),
  source: safeBundlePath(filename),
  line: Number.isSafeInteger(lineno) && lineno > 0 ? lineno : 0,
  column: Number.isSafeInteger(colno) && colno > 0 ? colno : 0,
});

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

export const reportIndexedDBReadFailure = (code) => {
  const boundedCode = INDEXED_DB_READ_CODES.has(String(code))
    ? String(code)
    : "OPERATION_FAILED";
  return reportReleaseDiagnostic({
    column: 0,
    errorName: `IndexedDBRead.${boundedCode}`,
    kind: "error",
    line: 0,
    releaseId: RELEASE_ID,
    source: "/frontend/app/BiddingModel.js",
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

export const reportAggregateVersionConflict = () => reportReleaseDiagnostic({
  column: 0,
  errorName: "AggregateVersion.Conflict",
  kind: "error",
  line: 0,
  releaseId: RELEASE_ID,
  source: "/frontend/shared/AggregateVersionClient.js",
});

const reportOperationalSignal = (errorName, source) => reportReleaseDiagnostic({
  column: 0,
  errorName,
  kind: "error",
  line: 0,
  releaseId: RELEASE_ID,
  source,
});

export const reportSyncConflict = () => reportOperationalSignal(
  "Sync.Conflict",
  "/frontend/app/SyncPushService.js",
);

export const reportOfflineQueuedMutation = () => reportOperationalSignal(
  "Sync.OfflineQueued",
  "/frontend/app/WorkspaceDataStore.js",
);

export const reportOutboxFailure = () => reportOperationalSignal(
  "Outbox.TransportFailure",
  "/frontend/app/SyncPushService.js",
);

export const reportOutboxRetry = () => reportOperationalSignal(
  "Outbox.StartupRetry",
  "/frontend/app/startupReconciliation.js",
);

export const reportExcelWorkerFailure = () => reportOperationalSignal(
  "ExcelWorker.Failure",
  "/frontend/documents/ExcelParseWorkerClient.js",
);

export const reportExcelWorkerFallback = () => reportOperationalSignal(
  "ExcelWorker.Fallback",
  "/frontend/documents/excelFileReader.js",
);

export const pollingFallbackDurationBucket = (durationMs) => {
  const duration = Math.max(0, Number(durationMs) || 0);
  if (duration < 30_000) return "Under30s";
  if (duration < 300_000) return "30sTo5m";
  return "Over5m";
};

export const reportWebSocketReconnect = () => reportOperationalSignal(
  "WebSocket.Reconnect",
  "/frontend/app/WebSocketSyncClient.js",
);

export const reportWebSocketPollingFallback = (durationMs) => reportOperationalSignal(
  `WebSocket.PollingFallback.${pollingFallbackDurationBucket(durationMs)}`,
  "/frontend/app/WebSocketSyncClient.js",
);

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
  target.addEventListener("error", event => {
    const diagnostic = buildReleaseDiagnostic(event);
    console.error("BiddingFlow client error", diagnostic);
    void reportReleaseDiagnostic(diagnostic);
  });
  target.addEventListener("unhandledrejection", event => {
    const diagnostic = buildReleaseDiagnostic({
      error: event.reason,
      kind: "unhandledrejection",
    });
    console.error("BiddingFlow unhandled rejection", diagnostic);
    void reportReleaseDiagnostic(diagnostic);
  });
};
