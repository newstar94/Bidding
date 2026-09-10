import assert from "node:assert/strict";
import test from "node:test";

import {
  createLatestAdminLoader,
  directoryQuery,
  directoryResultsMarkup,
  readDirectoryState,
} from "../../frontend/admin-platform/AdminDirectory.js";
import {
  AUDIT_DIRECTORY,
  SESSION_DIRECTORY,
  auditDetailMarkup,
  sessionDetailMarkup,
} from "../../frontend/admin-platform/AdminSecurity.js";

test("audit controls stay bounded to server pagination search and allowlisted sorting", () => {
  const state = readDirectoryState(
    AUDIT_DIRECTORY,
    "?page=3&pageSize=50&search=user&sortBy=sequence&sortDir=asc&metadata=secret",
  );

  assert.deepEqual(directoryQuery(state, AUDIT_DIRECTORY), {
    page: 3,
    pageSize: 50,
    search: "user",
    sortBy: "sequence",
    sortDir: "asc",
  });
  assert.equal(readDirectoryState(AUDIT_DIRECTORY, "?sortBy=metadata_json").sortBy, "created_at");
  assert.equal(readDirectoryState(AUDIT_DIRECTORY, "?action=auth.login_success").action, "auth.login_success");
  assert.equal(readDirectoryState(AUDIT_DIRECTORY, "?action=auth.unknown").action, "auth.unknown");
  assert.equal(readDirectoryState(AUDIT_DIRECTORY, "?result=unknown").result, "");
  assert.equal(readDirectoryState(AUDIT_DIRECTORY, "?requestId=req-123").requestId, "req-123");
});

test("audit table renders summary fields without raw metadata hashes or IP data", () => {
  const state = readDirectoryState(AUDIT_DIRECTORY, "");
  const markup = directoryResultsMarkup(AUDIT_DIRECTORY, state, {
    items: [{
      id: 7,
      chainId: "global",
      sequence: 12,
      actorUserId: "admin-1",
      organizationId: "org-1",
      action: "admin.user_updated",
      targetType: "user",
      targetId: "user-2",
      createdAt: "2026-09-10T08:00:00Z",
      result: "success",
      requestId: "req-123",
      details: { reason: "approved correction" },
      metadata: "raw-metadata-secret",
      entryHash: "raw-entry-hash",
      ipAddress: "192.0.2.10",
    }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });

  assert.match(markup, /admin[.]user_updated/u);
  assert.match(markup, /admin-1/u);
  assert.match(markup, /user-2/u);
  assert.match(markup, /data-admin-security-detail-index="0"/u);
  assert.match(markup, /req-123/u);
  assert.doesNotMatch(markup, /raw-metadata-secret|raw-entry-hash|192[.]0[.]2[.]10/u);
});

test("session controls send only supported server filters", () => {
  const state = readDirectoryState(
    SESSION_DIRECTORY,
    "?page=2&pageSize=25&search=an&status=active&sortBy=last_seen_at&sortDir=desc&token=x",
  );

  assert.deepEqual(directoryQuery(state, SESSION_DIRECTORY), {
    page: 2,
    pageSize: 25,
    search: "an",
    sortBy: "last_seen_at",
    sortDir: "desc",
    status: "active",
  });
  assert.equal(readDirectoryState(SESSION_DIRECTORY, "?status=unknown").status, "");
});

test("security table never renders session token device or privileged auth material", () => {
  const state = readDirectoryState(SESSION_DIRECTORY, "");
  const markup = directoryResultsMarkup(SESSION_DIRECTORY, state, {
    items: [{
      sessionId: "session-internal-id",
      user: {
        name: "Minh An",
        email: "an@example.test",
        platformRole: "user",
      },
      status: "active",
      lastSeenAt: 2_000,
      absoluteExpiresAt: 3_000,
      rememberMe: true,
      activeRole: "manager",
      activeRoleOrganizationId: "org-1",
      tokenHash: "token-secret",
      deviceInfo: "raw-device-fingerprint",
      privilegedReauthAt: 1_900,
    }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });

  assert.match(markup, /Minh An/u);
  assert.match(markup, /an@example[.]test/u);
  assert.match(markup, /manager/u);
  assert.match(markup, /data-admin-security-detail-index="0"/u);
  assert.doesNotMatch(markup, /session-internal-id|token-secret|raw-device-fingerprint|1900/u);
});

test("security pages preserve empty state and cancel stale requests", async () => {
  const empty = directoryResultsMarkup(
    SESSION_DIRECTORY,
    readDirectoryState(SESSION_DIRECTORY, ""),
    { items: [], pagination: { page: 1, totalPages: 1, totalRows: 0 } },
  );
  assert.match(empty, /data-admin-state="empty"/u);

  const loader = createLatestAdminLoader();
  let applied = false;
  const pending = loader.run(
    (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve("cancelled"), { once: true })),
    { onSuccess: () => { applied = true; } },
  );
  loader.cancel();
  await pending;
  assert.equal(applied, false);
});

test("audit detail renders safe login and target fields without raw internals", () => {
  const markup = auditDetailMarkup({
    id: 17,
    action: "auth.login_success",
    actorUserId: "admin-1",
    organizationId: null,
    targetType: "session",
    targetId: "account-1",
    chainId: "global",
    sequence: 41,
    createdAt: "2026-09-10T08:00:00Z",
    result: "failure",
    requestId: "req-login-1",
    details: { reason: "invalid_password" },
    metadata: { password: "raw-password", deviceFingerprint: "fingerprint-secret" },
    ipAddress: "192.0.2.44",
    entryHash: "audit-hash-secret",
  });
  assert.match(markup, /auth[.]login_success/u);
  assert.match(markup, /account-1/u);
  assert.match(markup, /Toàn nền tảng/u);
  assert.match(markup, /req-login-1|invalid_password/u);
  assert.doesNotMatch(markup, /raw-password|fingerprint-secret|192[.]0[.]2[.]44|audit-hash-secret/u);
});

test("session detail includes lifecycle dates but excludes identifiers and authentication material", () => {
  const markup = sessionDetailMarkup({
    sessionId: "session-internal-id",
    user: {
      id: "user-internal-id",
      name: "Minh An",
      username: "minhan",
      email: "an@example.test",
      platformRole: "user",
      status: "active",
    },
    status: "active",
    createdAt: 1_000,
    lastSeenAt: 1_900,
    idleExpiresAt: 2_500,
    absoluteExpiresAt: 3_000,
    revokedAt: null,
    rememberMe: true,
    activeRole: "manager",
    activeRoleOrganizationId: "org-1",
    tokenHash: "token-secret",
    deviceInfo: "raw-device-fingerprint",
    privilegedReauthAt: 1_850,
  });
  assert.match(markup, /Minh An/u);
  assert.match(markup, /minhan/u);
  assert.match(markup, /Hết hạn không hoạt động/u);
  assert.match(markup, /manager/u);
  assert.doesNotMatch(markup, /session-internal-id|user-internal-id|token-secret|raw-device-fingerprint|1850/u);
});
