import assert from "node:assert/strict";
import test from "node:test";

import { createLatestAdminLoader, directoryBrowserQuery, directoryQuery, directoryResultsMarkup, readDirectoryState } from "../../frontend/admin-platform/AdminDirectory.js";
import {
  executeOrganizationDirectoryAction,
  executeUserDirectoryAction,
  loadDirectoryDetail,
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

test("directory deep-link state stays in browser URL and never reaches list API", () => {
  const state = readDirectoryState(USER_DIRECTORY, "?detail=user-1&organizationId=org-1&packageId=business");
  assert.equal(state.detail, "user-1");
  assert.equal(directoryQuery(state, USER_DIRECTORY).detail, undefined);
  assert.deepEqual(directoryBrowserQuery(state, USER_DIRECTORY), {
    page: 1, pageSize: 25, sortBy: "name", sortDir: "asc",
    organizationId: "org-1", packageId: "business", detail: "user-1",
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

test("directory renders an optional authoritative summary for populated and empty pages", () => {
  const config = {
    ...USER_DIRECTORY,
    summaryMarkup: (summary) => `<aside data-summary>${summary?.total ?? "N/A"}</aside>`,
  };
  const state = readDirectoryState(config, "");
  assert.match(directoryResultsMarkup(config, state, {
    summary: { total: 12 }, items: [], pagination: {},
  }), /data-summary>12/u);
  assert.match(directoryResultsMarkup(config, state, {
    summary: { total: 12 }, items: [{ id: "user-1" }], pagination: {},
  }), /data-summary>12/u);
});

test("user directory renders authorized fields in an accessible responsive table", () => {
  const state = readDirectoryState(USER_DIRECTORY, "");
  const markup = directoryResultsMarkup(USER_DIRECTORY, state, {
    items: [{
      id: "user-1", username: "minhan", name: "Minh An", email: "an@example.test",
      role: "user", status: "active", createdAt: "2026-01-02",
      lastActiveAt: 4102444800, subscription: { packageId: "personal" },
      organizations: [{ name: "Công ty An Bình", role: "manager", employeeName: "Nguyễn An", employeePhone: "0901" }],
    }],
    pagination: { page: 1, totalPages: 2, totalRows: 26 },
  });
  assert.match(markup, /<table[^>]+bf-admin-directory-table/u);
  assert.match(markup, /aria-sort="ascending"/u);
  assert.match(markup, /an@example[.]test/u);
  assert.match(markup, /Nguyễn An · 0901/u);
  assert.match(markup, /personal/u);
  assert.match(markup, /Hoạt động gần nhất/u);
  assert.match(markup, /data-admin-page="2"/u);
  assert.match(markup, /data-admin-select-all/u);
  assert.match(markup, /data-admin-select-row="user-1"/u);
  assert.match(markup, /data-admin-selection-status/u);
});

test("organization directory renders real subscription values and an empty state", () => {
  const state = readDirectoryState(ORGANIZATION_DIRECTORY, "");
  const markup = directoryResultsMarkup(ORGANIZATION_DIRECTORY, state, {
    items: [{ id: "org-1", name: "Minh An", status: "active", memberCount: 12, lastActiveAt: 4102444800, primaryContact: { name: "Chủ sở hữu", email: "owner@example.test" }, subscription: { packageId: "business", status: "active", expiresAt: 4102444800 } }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(markup, /business/u);
  assert.match(markup, />12</u);
  assert.match(markup, /owner@example[.]test/u);
  assert.match(directoryResultsMarkup(ORGANIZATION_DIRECTORY, state, { items: [] }), /data-admin-state="empty"/u);
});

test("detail drawers preserve authoritative user, membership and subscription values", () => {
  const userMarkup = userDetailMarkup({
    id: "user-1", username: "minhan", name: "Minh An", email: "an@example.test",
    role: "user", status: "active", createdAt: "2026-01-02", updatedAt: "2026-02-03",
    lastActiveAt: 200, activeSessionCount: 2, organizationCount: 1,
    subscription: { packageId: "personal", status: "active" },
    usage: { eventCount: 8, lastSeenAt: 210 },
    recentAudit: [{ action: "user.updated", createdAt: "2026-03-01", targetType: "user", targetId: "user-1" }],
    links: { sessions: "/admin/security?userId=user-1", audit: "/admin/audit?actorUserId=user-1" },
    organizations: [{ name: "Công ty An Bình", role: "manager", employeeName: "Nguyễn An", employeePhone: "0901" }],
  });
  assert.match(userMarkup, /an@example[.]test/u);
  assert.match(userMarkup, /Nguyễn An · 0901/u);
  assert.match(userMarkup, /data-admin-user-form="role"/u);
  assert.match(userMarkup, /data-admin-user-action="deactivate"/u);
  assert.match(userMarkup, /Phiên hoạt động/u);
  assert.match(userMarkup, />2</u);
  assert.match(userMarkup, /personal/u);
  assert.match(userMarkup, /user[.]updated/u);
  assert.match(userMarkup, /href="\/admin\/security[?]userId=user-1"/u);
  assert.doesNotMatch(userMarkup, /data-admin-link=/u);

  const organizationMarkup = organizationDetailMarkup({
    id: "org-1", name: "Công ty An Bình", status: "active", memberCount: 12,
    primaryContact: { name: "Nguyễn Quản lý", email: "manager@example.test" },
    users: [{ name: "Nhân viên", email: "employee@example.test", role: "employee", lastActiveAt: 250 }],
    usage: { eventCount: 12, lastSeenAt: 250 }, security: { activeSessionCount: 3 },
    recentAudit: [{ action: "subscription.changed", createdAt: "2026-03-02", targetType: "organization", targetId: "org-1" }],
    links: { users: "/admin/users?organizationId=org-1", activity: "/admin/audit?organizationId=org-1", security: "/admin/security" },
    subscription: { packageId: "business", status: "active", startsAt: 100, expiresAt: 4102444800, memberQuota: 20 },
  });
  assert.match(organizationMarkup, /business/u);
  assert.match(organizationMarkup, />20</u);
  assert.match(organizationMarkup, /data-admin-organization-action="lock"/u);
  assert.match(organizationMarkup, /data-admin-organization-form="set_package"/u);
  assert.match(organizationMarkup, /Nguyễn Quản lý/u);
  assert.match(organizationMarkup, /employee@example[.]test/u);
  assert.match(organizationMarkup, /subscription[.]changed/u);
  assert.match(organizationMarkup, /Bảo mật/u);

  const suspendedSubscription = organizationDetailMarkup({
    id: "org-2", name: "Tổ chức 2", status: "active",
    subscription: { packageId: "business", status: "suspended" },
  });
  assert.match(suspendedSubscription, /data-admin-organization-action="unlock"/u);
  assert.doesNotMatch(suspendedSubscription, /data-admin-organization-action="lock"/u);
});

test("detail drawers escape untrusted aggregate values and link attributes", () => {
  const markup = userDetailMarkup({
    id: '<img src=x onerror="alert(1)">',
    name: '<script>alert(1)</script>',
    links: { sessions: '" onmouseover="alert(1)' },
    recentAudit: [{ action: "<svg/onload=alert(1)>", targetType: "user", targetId: "<bad>" }],
  });
  assert.doesNotMatch(markup, /<script>|<svg|data-admin-link=/u);
  assert.match(markup, /&lt;script&gt;/u);
  assert.match(markup, /&quot; onmouseover=&quot;/u);
});

test("directory details load from dedicated encoded aggregate endpoints", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const key = url.includes('/users/') ? 'user' : 'organization';
    return new Response(JSON.stringify({ [key]: { id: `${key}-detail` } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  assert.deepEqual(await loadDirectoryDetail('user', 'user/with space', { fetchImpl }), { id: 'user-detail' });
  assert.deepEqual(await loadDirectoryDetail('organization', 'org&scope=all', { fetchImpl }), { id: 'organization-detail' });
  assert.deepEqual(requests, [
    '/api/admin/users/user%2Fwith%20space',
    '/api/admin/organizations/org%26scope%3Dall',
  ]);
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
