import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildOperationalDiagnostic,
  hashWorkspaceScope,
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
