import assert from "node:assert/strict";
import test from "node:test";

import { createLatestAdminLoader, directoryQuery, directoryResultsMarkup, readDirectoryState } from "../../frontend/admin-platform/AdminDirectory.js";
import {
  executeOrganizationDirectoryAction,
  executeUserDirectoryAction,
  organizationDetailMarkup,
  ORGANIZATION_DIRECTORY,
  userDetailMarkup,
  USER_DIRECTORY,
} from "../../frontend/admin-platform/AdminDirectories.js";

test("directory query keeps only bounded server-side controls", () => {
  const state = readDirectoryState(USER_DIRECTORY, "?page=2&pageSize=50&search=an&role=user&status=active&sortBy=email&sortDir=desc&unknown=x");
  assert.deepEqual(directoryQuery(state, USER_DIRECTORY), {
    page: 2, pageSize: 50, search: "an", sortBy: "email", sortDir: "desc", role: "user", status: "active",
  });
  const invalid = readDirectoryState(USER_DIRECTORY, "?page=-2&pageSize=999&role=manager&sortBy=DROP&sortDir=sideways");
  assert.deepEqual(directoryQuery(invalid, USER_DIRECTORY), {
    page: 1, pageSize: 25, sortBy: "name", sortDir: "asc",
  });
});

test("latest directory request aborts and cannot overwrite newer data", async () => {
  const loader = createLatestAdminLoader();
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const applied = [];
  const oldRun = loader.run(async () => first, { onSuccess: (value) => applied.push(value) });
  const newRun = loader.run(async () => "new", { onSuccess: (value) => applied.push(value) });
  releaseFirst("old");
  await Promise.all([oldRun, newRun]);
  assert.deepEqual(applied, ["new"]);
});

test("user directory renders authorized fields in an accessible responsive table", () => {
  const state = readDirectoryState(USER_DIRECTORY, "");
  const markup = directoryResultsMarkup(USER_DIRECTORY, state, {
    items: [{
      id: "user-1", username: "minhan", name: "Minh An", email: "an@example.test",
      role: "user", status: "active", createdAt: "2026-01-02",
      organizations: [{ name: "Công ty An Bình", role: "manager", employeeName: "Nguyễn An", employeePhone: "0901" }],
    }],
    pagination: { page: 1, totalPages: 2, totalRows: 26 },
  });
  assert.match(markup, /<table[^>]+bf-admin-directory-table/u);
  assert.match(markup, /aria-sort="ascending"/u);
  assert.match(markup, /an@example[.]test/u);
  assert.match(markup, /Nguyễn An · 0901/u);
  assert.match(markup, /data-admin-page="2"/u);
  assert.match(markup, /data-admin-select-all/u);
  assert.match(markup, /data-admin-select-row="user-1"/u);
  assert.match(markup, /data-admin-selection-status/u);
});

test("organization directory renders real subscription values and an empty state", () => {
  const state = readDirectoryState(ORGANIZATION_DIRECTORY, "");
  const markup = directoryResultsMarkup(ORGANIZATION_DIRECTORY, state, {
    items: [{ id: "org-1", name: "Minh An", status: "active", memberCount: 12, subscription: { packageId: "business", status: "active", expiresAt: 4102444800 } }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(markup, /business/u);
  assert.match(markup, />12</u);
  assert.match(directoryResultsMarkup(ORGANIZATION_DIRECTORY, state, { items: [] }), /data-admin-state="empty"/u);
});

test("detail drawers preserve authoritative user, membership and subscription values", () => {
  const userMarkup = userDetailMarkup({
    id: "user-1", username: "minhan", name: "Minh An", email: "an@example.test",
    role: "user", status: "active", createdAt: "2026-01-02", updatedAt: "2026-02-03",
    organizations: [{ name: "Công ty An Bình", role: "manager", employeeName: "Nguyễn An", employeePhone: "0901" }],
  });
  assert.match(userMarkup, /an@example[.]test/u);
  assert.match(userMarkup, /Nguyễn An · 0901/u);
  assert.match(userMarkup, /data-admin-user-form="role"/u);
  assert.match(userMarkup, /data-admin-user-action="deactivate"/u);

  const organizationMarkup = organizationDetailMarkup({
    id: "org-1", name: "Công ty An Bình", status: "active", memberCount: 12,
    subscription: { packageId: "business", status: "active", startsAt: 100, expiresAt: 4102444800, memberQuota: 20 },
  });
  assert.match(organizationMarkup, /business/u);
  assert.match(organizationMarkup, />20</u);
  assert.match(organizationMarkup, /data-admin-organization-action="lock"/u);
  assert.match(organizationMarkup, /data-admin-organization-form="set_package"/u);
});

test("user platform-role action uses the explicit authoritative scope", async () => {
  const requests = [];
  const result = await executeUserDirectoryAction("role", { id: "user-1", name: "Minh An" }, "super_admin", {
    confirmImpl: async () => true,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(result.payload.success, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/auth/users/update-role");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    user_id: "user-1", role: "super_admin", scope: "platform",
  });
  assert.equal(new Headers(requests[0].options.headers).has("X-Active-Org"), false);
});

test("organization command retains one idempotency key across privileged reauthentication", async () => {
  const requests = [];
  let organizationAttempts = 0;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/organizations/subscription" && ++organizationAttempts === 1) {
      return new Response(JSON.stringify({ error: "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm." }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  const result = await executeOrganizationDirectoryAction("set_package", {
    id: "org-1", name: "Công ty An Bình",
  }, "business", {
    fetchImpl,
    confirmImpl: async () => true,
    requestPassword: async () => "correct-password",
    requestIdempotencyKey: "admin-org:set-package:stable-test",
  });
  assert.equal(result.payload.success, true);
  const mutations = requests.filter((item) => item.url === "/api/organizations/subscription");
  assert.deepEqual(mutations.map((item) => JSON.parse(item.options.body)), [
    { organization_id: "org-1", action: "set_package", package_id: "business" },
    { organization_id: "org-1", action: "set_package", package_id: "business" },
  ]);
  assert.deepEqual(mutations.map((item) => new Headers(item.options.headers).get("Idempotency-Key")), [
    "admin-org:set-package:stable-test", "admin-org:set-package:stable-test",
  ]);
  assert.deepEqual(JSON.parse(requests.find((item) => item.url === "/api/auth/privileged-reauth").options.body), {
    password: "correct-password",
  });
});
