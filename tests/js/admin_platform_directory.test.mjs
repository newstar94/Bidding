import assert from "node:assert/strict";
import test from "node:test";

import { createLatestAdminLoader, directoryBrowserQuery, directoryQuery, directoryResultsMarkup, readDirectoryState } from "../../frontend/admin-platform/AdminDirectory.js";
import {
  executeDirectoryBulkAction,
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
    recentSessions: [{
      status: "active", createdAt: 100, lastSeenAt: 200,
      activeRole: "employee", activeRoleOrganizationId: "org-1", rememberMe: true,
    }],
    recentAudit: [{ action: "user.updated", createdAt: "2026-03-01", targetType: "user", targetId: "user-1" }],
    links: { sessions: "/admin/security?userId=user-1", audit: "/admin/audit?actorUserId=user-1" },
    availablePackages: [{ id: "personal", name: "Cá nhân" }, { id: "business", name: "Doanh nghiệp" }],
    organizations: [{
      id: "org-1", name: "Công ty An Bình", role: "manager",
      employeeName: "Nguyễn An", employeePhone: "0901",
      subscription: { packageId: "business", status: "active" },
      entitlements: { wordExport: true },
      documentCapabilities: { financial: true, identity: true, signature: true },
    }],
  });
  assert.match(userMarkup, /an@example[.]test/u);
  assert.match(userMarkup, /Nguyễn An · 0901/u);
  assert.match(userMarkup, /data-admin-user-form="access_settings"/u);
  assert.match(userMarkup, /name="platform_role"/u);
  assert.match(userMarkup, /name="account_package_id"/u);
  assert.match(userMarkup, /name="organization_id"/u);
  assert.match(userMarkup, /name="organization_role"/u);
  assert.match(userMarkup, /name="organization_package_id"/u);
  assert.match(userMarkup, /name="document_capability_financial"/u);
  assert.match(userMarkup, /name="document_capability_identity"/u);
  assert.match(userMarkup, /name="document_capability_signature"/u);
  assert.match(userMarkup, />Doanh nghiệp</u);
  assert.match(userMarkup, /data-admin-user-action="deactivate"/u);
  assert.match(userMarkup, /Phiên hoạt động/u);
  assert.match(userMarkup, />2</u);
  assert.match(userMarkup, /personal/u);
  assert.match(userMarkup, /user[.]updated/u);
  assert.match(userMarkup, /Hoạt động đăng nhập/u);
  assert.match(userMarkup, /employee · org-1/u);
  assert.match(userMarkup, /Ghi nhớ đăng nhập/u);
  assert.match(userMarkup, /href="\/admin\/security[?]userId=user-1"/u);
  assert.doesNotMatch(userMarkup, /data-admin-link=/u);

  const organizationMarkup = organizationDetailMarkup({
    id: "org-1", name: "Công ty An Bình", status: "active", memberCount: 12,
    primaryContact: { name: "Nguyễn Quản lý", email: "manager@example.test" },
    users: [{ name: "Nhân viên", email: "employee@example.test", role: "employee", lastActiveAt: 250 }],
    usage: { eventCount: 12, lastSeenAt: 250 }, security: { activeSessionCount: 3 },
    recentAudit: [{ action: "subscription.changed", createdAt: "2026-03-02", targetType: "organization", targetId: "org-1" }],
    invoices: [{
      id: "invoice-1", status: "issued", providerReference: "provider-1",
      orderPublicId: "order-1", amounts: { totalMinor: 330000, currency: "VND" },
      createdAt: "2026-02-03", href: "/admin/invoices/invoice-1",
    }],
    links: { users: "/admin/users?organizationId=org-1", invoices: "/admin/invoices?ownerKind=organization&search=org-1", activity: "/admin/audit?organizationId=org-1", security: "/admin/security" },
    subscription: { packageId: "business", status: "active", startsAt: 100, expiresAt: 4102444800, memberQuota: 20 },
  });
  assert.match(organizationMarkup, /business/u);
  assert.match(organizationMarkup, />20</u);
  assert.match(organizationMarkup, /data-admin-organization-action="lock"/u);
  assert.match(organizationMarkup, /data-admin-organization-form="set_package"/u);
  assert.match(organizationMarkup, /Nguyễn Quản lý/u);
  assert.match(organizationMarkup, /employee@example[.]test/u);
  assert.match(organizationMarkup, /subscription[.]changed/u);
  assert.match(organizationMarkup, /Hóa đơn gần đây/u);
  assert.match(organizationMarkup, /invoice-1/u);
  assert.match(organizationMarkup, /330[.]000/u);
  assert.match(organizationMarkup, /href="\/admin\/invoices\/invoice-1"/u);
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

test("user access-settings action preserves the legacy authoritative contract", async () => {
  const requests = [];
  const value = {
    platform_role: "user",
    account_package_id: "personal",
    organization_id: "org-1",
    organization_role: "employee",
    organization_package_id: "business",
    document_capabilities: { financial: true, identity: false, signature: true },
  };
  const result = await executeUserDirectoryAction(
    "access_settings",
    { id: "user-1", name: "Minh An" },
    value,
    {
      confirmImpl: async () => true,
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({ success: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      },
    },
  );

  assert.equal(result.payload.success, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/auth/users/access-settings");
  assert.equal(requests[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(requests[0].options.body), { user_id: "user-1", ...value });
  assert.equal(Object.hasOwn(JSON.parse(requests[0].options.body), "permissions"), false);
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

const REAUTH_REQUIRED = "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm.";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

test("selectable directories render disabled bulk actions next to the selection status", () => {
  const state = readDirectoryState(USER_DIRECTORY, "");
  const markup = directoryResultsMarkup(USER_DIRECTORY, state, {
    items: [{ id: "user-1", name: "Minh An", status: "active" }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(markup, /data-admin-bulk-action="deactivate" disabled>Ngừng hoạt động</u);
  assert.match(markup, /data-admin-bulk-action="reactivate" disabled>Kích hoạt lại</u);
  assert.match(markup, /data-admin-bulk-result hidden/u);
  const organizations = directoryResultsMarkup(ORGANIZATION_DIRECTORY, readDirectoryState(ORGANIZATION_DIRECTORY, ""), {
    items: [{ id: "org-1", name: "An Bình" }], pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(organizations, /data-admin-bulk-action="lock"/u);
  assert.match(organizations, /data-admin-bulk-action="unlock"/u);
});

test("bulk user reactivation reuses one step-up and continues past a rejected record", async () => {
  const requests = [];
  let prompts = 0;
  let reauthenticated = false;
  const fetchImpl = async (url, options) => {
    requests.push({ url, method: options.method });
    if (url === "/api/auth/privileged-reauth") { reauthenticated = true; return json({ success: true }); }
    if (!reauthenticated) return json({ error: REAUTH_REQUIRED }, 403);
    if (url.includes("user-2")) return json({ error: "Người dùng không tồn tại." }, 404);
    if (url.includes("user-3")) return json({ success: true, changed: false });
    return json({ success: true, changed: true });
  };
  const result = await executeDirectoryBulkAction("user", "reactivate", [
    { id: "user-1", name: "An" }, { id: "user-2", name: "Bình" }, { id: "user-3", name: "Chi" },
  ], {
    fetchImpl,
    confirmImpl: async (message) => { assert.match(message, /Kích hoạt lại 3 tài khoản/u); return true; },
    requestPassword: async () => { prompts += 1; return "secret"; },
  });
  assert.equal(prompts, 1);
  assert.deepEqual(requests.filter((item) => item.method === "POST" && item.url !== "/api/auth/privileged-reauth").map((item) => item.url), [
    "/api/auth/users/user-1/reactivate", "/api/auth/users/user-1/reactivate",
    "/api/auth/users/user-2/reactivate", "/api/auth/users/user-3/reactivate",
  ]);
  assert.equal(result.changed, 1);
  assert.equal(result.unchanged, 1);
  assert.deepEqual(result.failures, ["Bình: Người dùng không tồn tại."]);
  assert.match(result.summary, /Đã kích hoạt lại 1\/3 bản ghi/u);
});

test("bulk user deactivation calls the single-record endpoint and stops when step-up is cancelled", async () => {
  const requests = [];
  const result = await executeDirectoryBulkAction("user", "deactivate", [{ id: "user-1" }, { id: "user-2" }], {
    fetchImpl: async (url, options) => { requests.push({ url, method: options.method }); return json({ error: REAUTH_REQUIRED }, 403); },
    confirmImpl: async () => true,
    requestPassword: async () => null,
  });
  assert.deepEqual(requests, [{ url: "/api/auth/users/user-1", method: "DELETE" }]);
  assert.equal(result.stopped, true);
  assert.match(result.summary, /2 bản ghi chưa xử lý/u);
  const cancelled = await executeDirectoryBulkAction("user", "deactivate", [{ id: "user-1" }], {
    fetchImpl: async () => { throw new Error("must not send"); }, confirmImpl: async () => false,
  });
  assert.equal(cancelled.cancelled, true);
});

test("bulk organization lock sends one idempotent subscription command per organization", async () => {
  const bodies = [];
  let key = 0;
  const result = await executeDirectoryBulkAction("organization", "lock", [{ id: "org-1" }, { id: "org-2" }], {
    fetchImpl: async (url, options) => {
      if (url === "/api/organizations/subscription") {
        bodies.push({ body: JSON.parse(options.body), key: new Headers(options.headers).get("Idempotency-Key") });
      }
      return json({ success: true, changed: true });
    },
    confirmImpl: async () => true,
    createIdempotencyKey: (action) => `admin-org:${action}:${++key}`,
  });
  assert.deepEqual(bodies, [
    { body: { organization_id: "org-1", action: "lock" }, key: "admin-org:lock:1" },
    { body: { organization_id: "org-2", action: "lock" }, key: "admin-org:lock:2" },
  ]);
  assert.equal(result.changed, 2);
  await assert.rejects(executeDirectoryBulkAction("organization", "renew", [{ id: "org-1" }], {}), TypeError);
});
