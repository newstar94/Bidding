import test from "node:test";
import assert from "node:assert/strict";

import {
  RELEASE_ID,
  buildReleaseDiagnostic,
  installReleaseDiagnostics,
  reportReleaseDiagnostic,
} from "../../frontend/shared/releaseDiagnostics.js";

test("release diagnostics expose build identity without raw error content", () => {
  const diagnostic = buildReleaseDiagnostic({
    error: { name: "TypeError", message: "user@example.com 012345678901" },
    filename: "https://example.test/dist/assets/app-safe123.js?token=secret",
    lineno: 12,
    colno: 7,
  });

  assert.deepEqual(diagnostic, {
    kind: "error",
    releaseId: RELEASE_ID,
    errorName: "TypeError",
    source: "/dist/assets/app-safe123.js",
    line: 12,
    column: 7,
  });
  assert.equal(JSON.stringify(diagnostic).includes("user@example.com"), false);
  assert.equal(JSON.stringify(diagnostic).includes("012345678901"), false);
  assert.equal(JSON.stringify(diagnostic).includes("token=secret"), false);
});

test("client reporting sends only the pre-normalized diagnostic payload", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response("{}", { status: 202, headers: { "Content-Type": "application/json" } });
  };
  const diagnostic = buildReleaseDiagnostic({
    error: { name: "TypeError", message: "must-not-leave-browser@example.com" },
    filename: "/dist/assets/app-safe123.js",
  });

  try {
    assert.equal(await reportReleaseDiagnostic(diagnostic, 100_000), true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/client-errors");
  assert.deepEqual(JSON.parse(requests[0].options.body), diagnostic);
  assert.equal(requests[0].options.body.includes("must-not-leave-browser@example.com"), false);
});

test("release diagnostics install once and publish an immutable release id", () => {
  const listeners = [];
  const target = { addEventListener: (...args) => listeners.push(args) };

  installReleaseDiagnostics(target);
  installReleaseDiagnostics(target);

  assert.equal(target.__BIDDINGFLOW_RELEASE__, RELEASE_ID);
  assert.equal(listeners.length, 2);
  assert.deepEqual(listeners.map(([name]) => name), ["error", "unhandledrejection"]);
  assert.equal(Object.getOwnPropertyDescriptor(target, "__BIDDINGFLOW_RELEASE__").writable, false);
});
