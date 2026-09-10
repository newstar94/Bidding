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
      metadata: "raw-metadata-secret",
      entryHash: "raw-entry-hash",
      ipAddress: "192.0.2.10",
    }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });

  assert.match(markup, /admin[.]user_updated/u);
  assert.match(markup, /admin-1/u);
  assert.match(markup, /user-2/u);
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
