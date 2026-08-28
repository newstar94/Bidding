import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { configureApiClient } from "../../frontend/shared/apiClient.js";
import {
  buildReleaseDiagnostic,
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

test("stale bundle recovery does not reload when the once-only storage guard is blocked", async () => {
  const stale = new TypeError(
    "Failed to fetch dynamically imported module: /dist/assets/old-chunk-AbCdEf12.js",
  );
  const reloads = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const diagnostics = await import(
      `../../frontend/shared/releaseDiagnostics.js?blocked-storage-attempt=${attempt}`
    );
    const target = {
      location: {
        href: "https://demo.hosodauthau.online/goi-thau",
        origin: "https://demo.hosodauthau.online",
        reload: () => reloads.push(attempt),
      },
      get sessionStorage() {
        throw new DOMException("Storage is blocked", "SecurityError");
      },
    };

    assert.equal(
      diagnostics.recoverFromStaleDynamicImport({ error: stale, target }),
      false,
    );
  }
  assert.deepEqual(reloads, []);
});

test("stale bundle recovery refreshes and consumes a poisoned same-origin lazy chunk before reload", async () => {
  const diagnostics = await import(
    "../../frontend/shared/releaseDiagnostics.js?poisoned-lazy-chunk-recovery"
  );
  const storage = new Map();
  const requests = [];
  const reloads = [];
  let bodyConsumed = false;
  let releaseBody;
  let resolveReload;
  const bodyGate = new Promise(resolve => { releaseBody = resolve; });
  const reloaded = new Promise(resolve => { resolveReload = resolve; });
  const target = {
    location: {
      href: "https://demo.hosodauthau.online/goi-thau",
      origin: "https://demo.hosodauthau.online",
      reload: () => {
        reloads.push({ bodyConsumed });
        resolveReload();
      },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        arrayBuffer: async () => {
          await bodyGate;
          bodyConsumed = true;
          return new ArrayBuffer(0);
        },
      };
    },
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  const stale = new TypeError(
    "Failed to fetch dynamically imported module: "
      + "https://demo.hosodauthau.online/dist/assets/current-chunk-AbCdEf12.js",
  );

  assert.equal(diagnostics.recoverFromStaleDynamicImport({ error: stale, target }), true);
  assert.deepEqual(requests, [{
    url: "https://demo.hosodauthau.online/dist/assets/current-chunk-AbCdEf12.js",
    options: {
      cache: "reload",
      credentials: "same-origin",
    },
  }]);
  assert.deepEqual(reloads, []);

  releaseBody();
  await reloaded;
  assert.deepEqual(reloads, [{ bodyConsumed: true }]);
});

test("stale bundle recovery reloads Safari failures that do not expose an asset URL", async () => {
  const diagnostics = await import(
    "../../frontend/shared/releaseDiagnostics.js?safari-url-less-recovery"
  );
  const storage = new Map();
  const requests = [];
  const reloads = [];
  const target = {
    location: {
      href: "https://demo.hosodauthau.online/goi-thau",
      origin: "https://demo.hosodauthau.online",
      reload: () => reloads.push(true),
    },
    fetch: async (...args) => {
      requests.push(args);
      return new Response();
    },
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
  };

  assert.equal(diagnostics.recoverFromStaleDynamicImport({
    error: new Error("Importing a module script failed."),
    target,
  }), true);
  assert.deepEqual(requests, []);
  assert.deepEqual(reloads, [true]);
});

test("stale bundle recovery rejects unsafe and cross-origin asset URLs", async () => {
  const blockedUrls = [
    "https://attacker.example/dist/assets/current-chunk-AbCdEf12.js",
    "https://demo.hosodauthau.online/api/private-data",
    "javascript:alert(1)",
  ];

  for (const [index, blockedUrl] of blockedUrls.entries()) {
    const diagnostics = await import(
      `../../frontend/shared/releaseDiagnostics.js?blocked-recovery-url=${index}`
    );
    const storage = new Map();
    const requests = [];
    const reloads = [];
    const target = {
      location: {
        href: "https://demo.hosodauthau.online/goi-thau",
        origin: "https://demo.hosodauthau.online",
        reload: () => reloads.push(true),
      },
      fetch: async (...args) => {
        requests.push(args);
        return new Response();
      },
      sessionStorage: {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
      },
    };

    assert.equal(diagnostics.recoverFromStaleDynamicImport({
      error: new TypeError(`Failed to fetch dynamically imported module: ${blockedUrl}`),
      target,
    }), false);
    assert.deepEqual(requests, []);
    assert.deepEqual(reloads, []);
    assert.equal(storage.size, 0);
  }
});

test("Vite preload failures trigger one safe reload before rejection", () => {
  const reloads = [];
  const storage = new Map();
  const listeners = new Map();
  const target = {
    location: {
      href: "https://demo.hosodauthau.online/goi-thau",
      origin: "https://demo.hosodauthau.online",
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

test("stale bundle detection covers Chromium, Firefox, Safari and Vite CSS wording", () => {
  const staleMessages = [
    new TypeError("Failed to fetch dynamically imported module: /dist/assets/old-AbCdEf12.js"),
    new TypeError("error loading dynamically imported module: https://example.test/dist/assets/old-AbCdEf12.js"),
    new Error("Importing a module script failed."),
    new Error("Unable to preload CSS for /dist/assets/old-AbCdEf12.css"),
    new Error("Failed to load module script: Expected a JavaScript-or-Wasm module script"),
  ];

  for (const error of staleMessages) assert.equal(isStaleDynamicImportError(error), true);
  assert.equal(isStaleDynamicImportError(new Error("ordinary API network failure")), false);
  assert.equal(isStaleDynamicImportError(new SyntaxError("Unexpected token")), false);
});

test("stale bundle diagnostics retain only the safe failed asset path", () => {
  const diagnostic = buildReleaseDiagnostic({
    error: new TypeError(
      "Failed to fetch dynamically imported module: https://example.test/dist/assets/old-AbCdEf12.js?token=secret",
    ),
  });

  assert.equal(diagnostic.errorName, "StaleBundle.LoadFailure");
  assert.equal(diagnostic.source, "/dist/assets/old-AbCdEf12.js");
  assert.doesNotMatch(JSON.stringify(diagnostic), /token|secret|example\.test/u);
});
