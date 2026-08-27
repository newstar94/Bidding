import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { configureApiClient } from "../../frontend/shared/apiClient.js";
import {
  buildOperationalDiagnostic,
  hashWorkspaceScope,
  installReleaseDiagnostics,
  isStaleDynamicImportError,
  reportReleaseDiagnostic,
  recoverFromStaleDynamicImport,
} from "../../frontend/shared/releaseDiagnostics.js";

test("operational diagnostics hash workspace scope and retain only bounded dimensions", async () => {
  const workspaceKey = "user-private:organization-private";
  const expectedHash = createHash("sha256").update(workspaceKey).digest("hex").slice(0, 16);

  assert.equal(await hashWorkspaceScope(workspaceKey), expectedHash);
  const diagnostic = await buildOperationalDiagnostic({
    releaseId: "test-release",
    errorName: "Sync.TransportFailure",
    source: "/frontend/app/SyncPushService.js",
    operation: "sync-push",
    phase: "transport",
    retryable: true,
    backendStatus: "transport-error",
    workspaceKey,
    correlationId: "request-123",
    error: new Error("private contractor payload"),
    prompt: "private prompt",
    token: "secret",
  });

  assert.deepEqual(diagnostic, {
    kind: "error",
    releaseId: "test-release",
    errorName: "Sync.TransportFailure",
    source: "/frontend/app/SyncPushService.js",
    line: 0,
    column: 0,
    operation: "sync-push",
    phase: "transport",
    retryable: true,
    backendStatus: "transport-error",
    workspaceHash: expectedHash,
    correlationId: "request-123",
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|prompt|secret/u);
});

test("operational dimensions fail closed to bounded fallback values", async () => {
  const diagnostic = await buildOperationalDiagnostic({
    releaseId: "test-release",
    errorName: "invalid name with spaces",
    source: "/private/document.docx",
    operation: "sync/push",
    phase: "x".repeat(100),
    backendStatus: "bad status",
    correlationId: "private request id",
  });

  assert.equal(diagnostic.errorName, "Operational.Unknown");
  assert.equal(diagnostic.source, "unknown");
  assert.equal(diagnostic.operation, "unknown");
  assert.equal(diagnostic.phase, "unknown");
  assert.equal(diagnostic.backendStatus, "unknown");
  assert.equal("correlationId" in diagnostic, false);
  assert.equal("workspaceHash" in diagnostic, false);
});

test("expired-session telemetry does not invoke the global 403 UI handler", async () => {
  const originalFetch = globalThis.fetch;
  const httpErrors = [];
  let request = null;
  configureApiClient({
    activeOrganization: () => "",
    onHttpError: async (details) => {
      httpErrors.push(details);
      return null;
    },
  });
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      code: "AUTH_REQUIRED",
      error: "Cần đăng nhập để gửi báo cáo lỗi.",
    }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const accepted = await reportReleaseDiagnostic({
      kind: "error",
      releaseId: "test-release",
      errorName: "Session.Revoked",
      source: "/frontend/auth/AuthSessionController.js",
      line: 0,
      column: 0,
    }, 120_000);

    assert.equal(accepted, false);
    assert.equal(request?.url, "/api/client-errors");
    assert.equal(request?.options?.method, "POST");
    assert.deepEqual(httpErrors, []);
  } finally {
    globalThis.fetch = originalFetch;
    configureApiClient({ activeOrganization: () => "", onHttpError: null });
  }
});

test("Vite preload failures trigger one safe reload before rejection", () => {
  const reloads = [];
  const storage = new Map();
  const listeners = new Map();
  const target = {
    location: {
      pathname: "/goi-thau",
      reload: () => reloads.push(true),
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener: (type, callback) => listeners.set(type, callback),
  };
  const stale = new TypeError(
    "Failed to fetch dynamically imported module: /dist/assets/old-chunk-AbCdEf12.js",
  );

  assert.equal(isStaleDynamicImportError(stale), true);
  installReleaseDiagnostics(target);
  let prevented = false;
  listeners.get("vite:preloadError")({
    payload: stale,
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(reloads.length, 1);
  assert.equal(recoverFromStaleDynamicImport({ error: stale, target }), false);
  assert.equal(reloads.length, 1);
  assert.equal(recoverFromStaleDynamicImport({ error: new Error("network"), target }), false);
});
