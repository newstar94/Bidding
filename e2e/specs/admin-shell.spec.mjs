import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ADMIN_DOCUMENT = /^https?:\/\/[^/]+\/admin(?:\/[^?]*)?(?:\?.*)?$/u;
const ADMIN_TEMPLATE = await readFile(new URL("../../views/admin/index.html", import.meta.url), "utf8");
const ADMIN_SESSION = {
  valid: true,
  user: {
    id: "admin-e2e",
    name: "Quản trị E2E",
    username: "admin-e2e",
    platform_role: "super_admin",
  },
};
const OVERVIEW_PAYLOAD = {
  metrics: {
    organizations: { total: 2 },
    users: { total: 7 },
    subscriptions: { active: 1 },
    billing: { verifiedRevenue: 1250000 },
  },
  recentOrganizations: [{ name: "Tổ chức kiểm thử", status: "active" }],
  generatedAt: "2026-09-10T08:00:00Z",
};
const DIRECTORY_PAGE = {
  items: [{
    id: "user-e2e",
    name: "Người dùng kiểm thử",
    username: "e2e-user",
    email: "e2e@example.test",
    role: "user",
    status: "active",
    organizations: [],
    createdAt: "2026-09-01T00:00:00Z",
  }],
  pagination: { page: 1, totalPages: 1, totalRows: 1 },
};
const ORGANIZATION_PAGE = {
  items: [{
    id: "org-e2e",
    name: "Tổ chức kiểm thử",
    status: "active",
    memberCount: 7,
    subscription: { packageId: "internal", status: "active" },
    createdAt: "2026-09-01T00:00:00Z",
  }],
  pagination: { page: 1, totalPages: 1, totalRows: 1 },
};

function directoryPage(items) {
  return { items, pagination: { page: 1, totalPages: 1, totalRows: items.length } };
}

async function authorizedShell() {
  const manifest = JSON.parse(await readFile(
    new URL("../../dist/.vite/manifest.json", import.meta.url),
    "utf8",
  ));
  const adminBundle = manifest["frontend/admin-platform/AdminEntry.js"];
  return ADMIN_TEMPLATE
    .replace("__BF_ADMIN_STYLES__", adminBundle.css.map(
      (asset) => `<link rel="stylesheet" href="/dist/${asset}">`,
    ).join("\n"))
    .replace("__BF_ADMIN_VENDOR_SCRIPT__", "")
    .replace("__BF_ADMIN_ENTRY__", `/dist/${adminBundle.file}`)
    .replace("__BF_ADMIN_SESSION__", JSON.stringify(ADMIN_SESSION).replaceAll("<", "\\u003c"));
}

async function installAuthorizedShell(context) {
  const shell = await authorizedShell();
  await context.route(ADMIN_DOCUMENT, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    headers: {
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
    body: shell,
  }));
}

async function fulfillJson(route, payload, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

async function expectAdminReady(page, title) {
  await expect(page.locator("#admin-app")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
  await expect(page.locator("#admin-main")).toBeFocused();
}

test.beforeEach(async ({ browserName, context }) => {
  if (browserName === "firefox") {
    await context.route("http://local.adguard.org/**", (route) => route.abort("blockedbyclient"));
  }
});

test("server denies a direct admin deep link before returning the shell", async ({ request }) => {
  const response = await request.get("/admin/users", { failOnStatusCode: false });
  expect(response.status()).toBe(403);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.text()).not.toContain("bf-admin-session");
});

test("an expired admin session stops privileged calls and redirects once for reauthentication", async ({ context, page }) => {
  await installAuthorizedShell(context);
  let privilegedCalls = 0;
  await context.route("**/api/admin/overview", async (route) => {
    privilegedCalls += 1;
    await fulfillJson(route, { code: "SESSION_EXPIRED", message: "Phiên đăng nhập đã hết hạn." }, 401);
  });
  await context.route("**/dang-nhap?**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html lang=\"vi\"><title>Đăng nhập lại</title><body><h1>Đăng nhập lại</h1></body></html>",
  }));

  await page.goto("/admin", { waitUntil: "commit" });
  await expect(page).toHaveURL(/\/dang-nhap\?next=%2Fadmin/u);
  await expect(page.getByRole("heading", { name: "Đăng nhập lại" })).toBeVisible();
  expect(privilegedCalls).toBe(1);
  await page.waitForTimeout(250);
  expect(privilegedCalls).toBe(1);
});

test("deep links preserve query state and back-forward navigation", async ({ context, page }) => {
  await installAuthorizedShell(context);
  await context.route("**/api/admin/users?**", (route) => fulfillJson(route, DIRECTORY_PAGE));
  await context.route("**/api/admin/organizations?**", (route) => fulfillJson(route, ORGANIZATION_PAGE));

  await page.goto("/admin/users?search=e2e-user&status=active", { waitUntil: "commit" });
  await expectAdminReady(page, "Người dùng");
  await expect(page.locator("#admin-directory-search")).toHaveValue("e2e-user");
  await expect(page.getByText("Người dùng kiểm thử", { exact: true })).toBeVisible();
  await expect(page.locator('[data-admin-link="/admin/users"]')).toHaveAttribute("aria-current", "page");

  const organizationsLink = page.locator('[data-admin-link="/admin/organizations"]');
  await organizationsLink.focus();
  await expect(organizationsLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/organizations\?/u);
  await expectAdminReady(page, "Tổ chức");
  await expect(page.getByText("Tổ chức kiểm thử", { exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/users\?[^#]*search=e2e-user/u);
  await expectAdminReady(page, "Người dùng");
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/organizations\?/u);
  await expectAdminReady(page, "Tổ chức");
});

test("admin data surfaces expose loading, empty, error-retry, and permission states", async ({ context, page }) => {
  await installAuthorizedShell(context);
  let releaseOverview;
  const overviewGate = new Promise((resolve) => { releaseOverview = resolve; });
  let overviewRequests = 0;
  await context.route("**/api/admin/overview", async (route) => {
    overviewRequests += 1;
    if (overviewRequests === 1) {
      await overviewGate;
      await fulfillJson(route, OVERVIEW_PAYLOAD);
      return;
    }
    if (overviewRequests === 2) {
      await fulfillJson(route, { code: "TEMPORARY_FAILURE", message: "Lỗi kiểm thử có thể thử lại." }, 500);
      return;
    }
    await fulfillJson(route, OVERVIEW_PAYLOAD);
  });
  await context.route("**/api/admin/users?**", (route) => fulfillJson(route, {
    items: [], pagination: { page: 1, totalPages: 1, totalRows: 0 },
  }));
  await context.route("**/api/admin/organizations?**", (route) => fulfillJson(route, {
    code: "FORBIDDEN", message: "Không có quyền đọc danh sách này.",
  }, 403));

  await page.goto("/admin", { waitUntil: "commit" });
  await expect(page.getByRole("status")).toContainText("Đang tải tổng quan quản trị");
  releaseOverview();
  await expect(page.locator('[data-admin-metric="users"]')).toHaveText("7");

  await page.locator('[data-admin-link="/admin/users"]').click();
  await expect(page.locator('[data-admin-state="empty"]')).toBeVisible();
  await expect(page.locator('[data-admin-state="empty"]')).toContainText("Không có người dùng phù hợp");

  await page.locator('[data-admin-link="/admin/organizations"]').click();
  await expect(page.locator('[data-admin-state="permission"]')).toBeVisible();
  await expect(page.locator('[data-admin-state="permission"] [data-admin-retry]')).toHaveCount(0);

  await page.locator('[data-admin-link="/admin"]').click();
  await expect(page.locator('[data-admin-state="error"]')).toContainText("Lỗi kiểm thử có thể thử lại");
  await page.locator('[data-admin-state="error"] [data-admin-retry]').click();
  await expect(page.locator('[data-admin-metric="organizations"]')).toHaveText("2");
});

test("legal catalog deep link mounts the existing immutable publication workflow", async ({ context, page }) => {
  await installAuthorizedShell(context);
  await context.route("**/api/legal-versioning/profiles", (route) => fulfillJson(route, []));

  await page.goto("/admin/legal", { waitUntil: "commit" });
  await expectAdminReady(page, "Danh mục pháp lý");
  await expect(page.locator('[data-admin-link="/admin/legal"]')).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Tạo bản nháp văn bản" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo bản nháp hồ sơ" })).toBeVisible();
  await expect(page.getByText("Chưa có hồ sơ pháp lý nào được xuất bản.")).toBeVisible();
});

test("admin shell remains operable at desktop, tablet, and mobile widths", async ({ context, page }) => {
  await installAuthorizedShell(context);
  await context.route("**/api/admin/overview", (route) => fulfillJson(route, OVERVIEW_PAYLOAD));
  await context.route("**/api/admin/users?**", (route) => fulfillJson(route, DIRECTORY_PAGE));
  await page.goto("/admin", { waitUntil: "commit" });
  await expect(page.locator('[data-admin-metric="organizations"]')).toHaveText("2");

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#admin-main")).toBeVisible();
    await expect(page.getByRole("heading", { name: /BiddingFlow/u })).toBeVisible();
    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll, JSON.stringify(viewport)).toBeLessThanOrEqual(widths.client + 1);

    const toggle = page.getByRole("button", { name: "Mở điều hướng" });
    if (viewport.width < 992) {
      await expect(toggle).toBeVisible();
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator('[data-admin-link="/admin/users"]')).toBeVisible();
    } else {
      await expect(toggle).toBeHidden();
      await expect(page.locator('[data-admin-link="/admin/users"]')).toBeVisible();
    }
  }

  const usersLink = page.locator('[data-admin-link="/admin/users"]');
  await usersLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/users\?/u);
  await expect(page.getByRole("heading", { level: 2, name: "Người dùng" })).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
});

test("user and organization details keep keyboard focus and execute authoritative mutations", async ({ context, page }) => {
  await installAuthorizedShell(context);
  const mutations = [];
  await context.route("**/api/admin/users?**", (route) => fulfillJson(route, DIRECTORY_PAGE));
  await context.route("**/api/admin/users/user-e2e", (route) => fulfillJson(route, {
    user: {
      ...DIRECTORY_PAGE.items[0],
      activeSessionCount: 1,
      organizationCount: 0,
      subscription: null,
      usage: null,
      recentAudit: [],
      links: { sessions: "/admin/security?userId=user-e2e", audit: "/admin/audit?actorUserId=user-e2e" },
    },
  }));
  await context.route("**/api/admin/organizations?**", (route) => fulfillJson(route, ORGANIZATION_PAGE));
  await context.route("**/api/admin/organizations/org-e2e", (route) => fulfillJson(route, {
    organization: {
      ...ORGANIZATION_PAGE.items[0],
      owner: { id: "owner-e2e", name: "Chủ sở hữu", email: "owner@example.test" },
      users: [],
      recentAudit: [],
      usage: null,
      links: { users: "/admin/users?organizationId=org-e2e", activity: "/admin/audit?organizationId=org-e2e" },
    },
  }));
  await context.route("**/api/auth/users/update-metadata", async (route) => {
    mutations.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    await fulfillJson(route, { ok: true });
  });
  await context.route("**/api/organizations/subscription", async (route) => {
    mutations.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()["idempotency-key"],
    });
    await fulfillJson(route, { ok: true });
  });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/admin/users", { waitUntil: "commit" });
  await expectAdminReady(page, "Người dùng");
  await page.getByRole("button", { name: "Xem và thao tác" }).click();
  const userDrawer = page.locator("[data-admin-detail-drawer]");
  await expect(userDrawer).toBeVisible();
  await expect(userDrawer.getByLabel("Đóng")).toBeFocused();
  await userDrawer.getByLabel("Tên hiển thị").fill("Tên đã cập nhật");
  await userDrawer.getByRole("button", { name: "Cập nhật tên" }).click();
  await expect.poll(() => mutations.length).toBe(1);
  expect(mutations[0]).toEqual({
    path: "/api/auth/users/update-metadata",
    body: { user_id: "user-e2e", field: "name", value: "Tên đã cập nhật" },
  });

  await page.locator('[data-admin-link="/admin/organizations"]').click();
  await expectAdminReady(page, "Tổ chức");
  await page.getByRole("button", { name: "Xem và thao tác" }).click();
  const organizationDrawer = page.locator("[data-admin-detail-drawer]");
  await expect(organizationDrawer.getByLabel("Đóng")).toBeFocused();
  await organizationDrawer.getByRole("button", { name: "Khóa đăng ký" }).click();
  await expect.poll(() => mutations.length).toBe(2);
  expect(mutations[1].path).toBe("/api/organizations/subscription");
  expect(mutations[1].body).toEqual({ organization_id: "org-e2e", action: "lock" });
  expect(mutations[1].idempotencyKey).toMatch(/^admin-org:lock:/u);
});

test("commercial plans and payments send versioned and audited mutations", async ({ context, page }) => {
  await installAuthorizedShell(context);
  const commercialOverview = {
    currentRelease: { id: "release-v1", versionLabel: "PRO v1", mode: "ACTIVE", scopeKey: "global", nonSellable: false },
    scheduledRelease: null,
    drafts: [],
  };
  const draft = { id: "draft-e2e", revision: 1, status: "DRAFT", document: { plans: [] } };
  const requests = [];
  await context.route("**/api/commercial/admin/overview", (route) => fulfillJson(route, commercialOverview));
  await context.route("**/api/commercial/drafts", async (route) => {
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    await fulfillJson(route, draft);
  });
  const payment = {
    publicId: "ORDER-E2E", operation: "purchase", owner: { kind: "organization", name: "Tổ chức kiểm thử" },
    amounts: { totalMinor: 1250000, currency: "VND" }, provider: { name: "payOS", reference: "safe-reference" },
    paymentState: "unverified", activationState: "pending", checkoutState: "created", transactions: [], createdAt: "2026-09-10T00:00:00Z",
  };
  await context.route("**/api/admin/payments?**", (route) => fulfillJson(route, directoryPage([payment])));
  await context.route("**/api/billing/admin/orders/ORDER-E2E/review", async (route) => {
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    await fulfillJson(route, { ok: true });
  });

  await page.goto("/admin/plans", { waitUntil: "commit" });
  await expectAdminReady(page, "Gói dịch vụ");
  await page.getByRole("button", { name: "Tạo bản nháp" }).click();
  await expect(page.locator("#admin-commercial-editor")).toHaveAttribute("data-draft-id", "draft-e2e");
  expect(requests[0]).toEqual({ path: "/api/commercial/drafts", body: {} });

  await page.locator('[data-admin-link="/admin/payments"]').click();
  await expectAdminReady(page, "Thanh toán");
  await page.getByRole("button", { name: "Kiểm tra" }).click();
  const reasonDialog = page.getByRole("dialog");
  await reasonDialog.getByLabel("Lý do").fill("Đối soát thủ công E2E");
  page.once("dialog", (dialog) => dialog.accept());
  await reasonDialog.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page.locator('[data-admin-payment-status="ORDER-E2E"]')).toContainText("Đã chuyển đơn hàng");
  expect(requests[1]).toEqual({
    path: "/api/billing/admin/orders/ORDER-E2E/review",
    body: { reason: "Đối soát thủ công E2E" },
  });
});

test("analytics renders bounded chart fallbacks and preserves filter query state", async ({ context, page }) => {
  await installAuthorizedShell(context);
  const usage = {
    summary: {
      coverage: { hasData: true }, onlineNow: 3, activeUsers: 9,
      workActivityCount: 12, wordExportCount: 4,
      topFeatures: [{ label: "Xuất Word", count: 4, uniqueUsers: 2 }],
    },
  };
  const product = {
    dashboard: {
      hasData: true,
      kpis: [{ label: "Kế hoạch đã tạo", value: 5, change: 1 }],
      series: [{ label: "Kế hoạch", points: [{ date: "2026-09-10", value: 5, status: "available" }] }],
      viewCharts: [{ label: "Không có chuỗi", series: [] }],
      table: [{ metric: "sync_mutations", value: 12, status: "available" }],
    },
  };
  await context.route("**/api/admin/usage-analytics/summary?**", (route) => fulfillJson(route, usage));
  await context.route("**/api/admin/product-analytics/dashboard?**", (route) => fulfillJson(route, product));

  await page.goto("/admin/analytics?preset=7d&view=overview", { waitUntil: "commit" });
  await expectAdminReady(page, "Phân tích");
  await expect(page.getByText("Kế hoạch đã tạo", { exact: true })).toBeVisible();
  await expect(page.locator("#admin-chart-0")).toHaveText("Kế hoạch");
  await expect(page.getByText("Chưa có chuỗi dữ liệu cho biểu đồ này.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "2026-09-10" })).toBeVisible();
  await page.getByRole("button", { name: "90 ngày" }).click();
  await expect(page).toHaveURL(/preset=90d/u);
  await expect(page.getByRole("button", { name: "90 ngày" })).toHaveAttribute("aria-pressed", "true");
});

test("operational admin routes render sanitized data and safe detail focus", async ({ context, page }) => {
  await installAuthorizedShell(context);
  const pages = {
    "/api/admin/audit": directoryPage([{ createdAt: "2026-09-10T00:00:00Z", action: "auth.login_failed", targetType: "user", targetId: "user-e2e", actorUserId: "system", organizationId: "org-e2e", chainId: "chain-e2e", sequence: 1 }]),
    "/api/admin/security/sessions": directoryPage([{ status: "active", lastSeenAt: "2026-09-10T00:00:00Z", absoluteExpiresAt: "2026-09-11T00:00:00Z", activeRole: "super_admin", rememberMe: false, user: { name: "Quản trị E2E", email: "admin@example.test", platformRole: "super_admin" } }]),
    "/api/admin/system/jobs": directoryPage([{ id: "job-e2e", operation: "document", recordType: "export", organizationId: "org-e2e", status: "processing", progress: { completedItems: 1, totalItems: 2, phase: "render" }, attemptCount: 1, updatedAt: "2026-09-10T00:00:00Z" }]),
    "/api/admin/system/sync": directoryPage([{ id: 7, eventType: "broadcast", organizationId: "org-e2e", status: "pending", attemptCount: 0, availableAt: "2026-09-10T00:00:00Z" }]),
  };
  for (const [path, payload] of Object.entries(pages)) {
    await context.route(`**${path}?**`, (route) => fulfillJson(route, payload));
  }
  await context.route("**/api/admin/environment", (route) => fulfillJson(route, {
    runtime: { environment: "production", frontendAssetMode: "manifest", debugEnabled: false, secureCookies: true },
    features: { aiEnabled: true, legalVersioningEnabled: true, versionComparisonEnabled: true, paymentCheckoutEnabled: true },
    secretStatus: { DATABASE_URL: { configured: true }, PAYOS_API_KEY: { configured: true } },
  }));
  await context.route("**/api/admin/health", (route) => fulfillJson(route, {
    status: "ready", application: { startupComplete: true, ready: true, eventLoopLagMs: 2 },
    database: { status: "ready", schemaVersion: 42 }, operations: { documentWorker: { active: 1 }, websocket: { activeConnections: 2 } },
  }));
  await context.route("**/api/admin/system/version", (route) => fulfillJson(route, {
    applicationVersion: "2.0.0", releaseId: "release-safe", frontendBundleVersion: "bundle-safe",
    schemaVersion: 42, expectedSchemaVersion: 42, schemaStatus: "ready",
  }));

  const checks = [
    ["/admin/audit", "Nhật ký", "auth.login_failed"],
    ["/admin/security", "Bảo mật", "Quản trị E2E"],
    ["/admin/system/jobs", "Tác vụ", "job-e2e"],
    ["/admin/system/sync", "Đồng bộ", "broadcast"],
    ["/admin/settings", "Cài đặt", "Feature Flags"],
    ["/admin/environment", "Môi trường", "Cấu hình bí mật"],
    ["/admin/health", "Vận hành", "Cơ sở dữ liệu"],
    ["/admin/system/version", "Phiên bản", "release-safe"],
  ];
  for (const [path, title, evidence] of checks) {
    await page.goto(path, { waitUntil: "commit" });
    await expectAdminReady(page, title);
    await expect(page.getByText(evidence, { exact: false }).first()).toBeVisible();
  }

  await page.goto("/admin/audit", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Xem" }).click();
  await expect(page.locator("[data-admin-security-detail]")).toBeFocused();
  await expect(page.locator("[data-admin-security-detail]")).not.toContainText("DATABASE_URL=");
});

test("local admin settings save through privileged reauthentication", async ({ context, page }) => {
  await installAuthorizedShell(context);
  const mutations = [];
  await context.route("**/api/admin/environment", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        runtime: { environment: "development", frontendAssetMode: "bundle", debugEnabled: false, secureCookies: false },
        features: { aiEnabled: false, legalVersioningEnabled: true, versionComparisonEnabled: true, paymentCheckoutEnabled: false },
        secretStatus: {},
        configuration: { writable: true, restartRequired: true, source: "local_env" },
      });
      return;
    }
    mutations.push(route.request().postDataJSON());
    if (mutations.length === 1) {
      await fulfillJson(route, { message: "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm." }, 403);
      return;
    }
    await fulfillJson(route, { success: true, restartRequired: true });
  });
  await context.route("**/api/auth/privileged-reauth", (route) => fulfillJson(route, { success: true }));

  await page.goto("/admin/settings", { waitUntil: "commit" });
  await expectAdminReady(page, "Cài đặt");
  await page.locator('[data-admin-feature="aiEnabled"]').check();
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await page.getByLabel("Mật khẩu hiện tại").fill("correct-password");
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  await expect(page.locator("[data-admin-settings-status]")).toContainText("Cần khởi động lại");
  expect(mutations).toHaveLength(2);
  expect(mutations[1].features.aiEnabled).toBe(true);
});

test("local environment replaces a secret only after explicit confirmation and reauthentication", async ({ context, page }) => {
  await installAuthorizedShell(context);
  const mutations = [];
  await context.route("**/api/admin/environment", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        runtime: { environment: "development", frontendAssetMode: "bundle", debugEnabled: false, secureCookies: false },
        features: { aiEnabled: false, legalVersioningEnabled: true, versionComparisonEnabled: true, paymentCheckoutEnabled: false },
        secretStatus: {
          OTP_HMAC_KEY: {
            configured: true, writable: true, restartRequired: true,
            source: "local_env", lastUpdated: null,
          },
        },
        configuration: { writable: true, restartRequired: true, source: "local_env" },
      });
      return;
    }
    mutations.push(route.request().postDataJSON());
    await fulfillJson(
      route,
      mutations.length === 1
        ? { message: "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm." }
        : { success: true, restartRequired: true },
      mutations.length === 1 ? 403 : 200,
    );
  });
  await context.route("**/api/auth/privileged-reauth", (route) => fulfillJson(route, { success: true }));

  await page.goto("/admin/environment", { waitUntil: "commit" });
  await expectAdminReady(page, "Môi trường");
  await page.getByRole("button", { name: "Thay thế" }).click();
  await page.getByLabel("Nhập OTP_HMAC_KEY để xác nhận").fill("SAI_KHOA");
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page.locator("[data-admin-environment-status]")).toContainText("Đã hủy thao tác");
  expect(mutations).toHaveLength(0);

  await page.getByRole("button", { name: "Thay thế" }).click();
  await page.getByLabel("Nhập OTP_HMAC_KEY để xác nhận").fill("OTP_HMAC_KEY");
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const secretInput = page.getByLabel("Khóa xác thực OTP");
  await expect(secretInput).toHaveAttribute("type", "password");
  await secretInput.fill("s".repeat(32));
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByLabel("Mật khẩu hiện tại").fill("correct-password");
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  await expect(page.locator("[data-admin-environment-status]")).toContainText("Cần khởi động lại");
  expect(mutations).toHaveLength(2);
  expect(mutations[1]).toEqual({ secrets: { OTP_HMAC_KEY: "s".repeat(32) } });
  await expect(page.locator("body")).not.toContainText("s".repeat(32));
});

test("overview renders authoritative charts, table fallbacks, activity, and actionable alerts", async ({ context, page }) => {
  await installAuthorizedShell(context);
  await context.route("**/api/admin/overview", (route) => fulfillJson(route, {
    metrics: {
      organizations: 12,
      activeOrganizations: 9,
      newOrganizations30Days: 2,
      users: 40,
      activeAccounts: 31,
      activeUsers: 8,
      newUsers30Days: 5,
      activeSubscriptions: 10,
      verifiedRevenue: 1250000,
      mrr: 3000000,
      arr: 36000000,
      unpaidInvoices: 1,
      overdueInvoices: 1,
      pendingJobs: 2,
    },
    recentOrganizations: [{
      name: "Công ty Sao Mai", memberCount: 4, status: "active", subscriptionStatus: "active",
    }],
    activityFeed: [{
      title: "Công ty Sao Mai", memberCount: 4, subscriptionStatus: "active",
      occurredAt: "2026-09-10T08:00:00Z",
    }],
    alerts: [{
      title: "Hóa đơn quá hạn", message: "Có 1 mục cần rà soát.", count: 1,
      href: "/admin/organizations?subscriptionStatus=expired",
    }],
    generatedAt: "2026-09-10T08:00:00Z",
  }));

  await page.goto("/admin", { waitUntil: "commit" });
  await expectAdminReady(page, "Tổng quan");
  await expect(page.getByRole("img", { name: /Hoạt động: 9 trên tổng số 12/u })).toBeVisible();
  const organizationFallback = page.getByRole("table", { name: "Dữ liệu dạng bảng của Tình trạng tổ chức" });
  await expect(organizationFallback.getByRole("rowheader", { name: "Hoạt động", exact: true })).toBeVisible();
  await expect(organizationFallback.getByRole("cell", { name: "9" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Hoạt động nền tảng gần đây" })).toContainText("Công ty Sao Mai");
  const alert = page.locator("article.alert-warning").filter({ hasText: "Hóa đơn quá hạn" });
  await expect(alert).toContainText("Có 1 mục cần rà soát");
  await expect(alert.getByRole("link", { name: "Xem 1" })).toHaveAttribute(
    "href", "/admin/organizations?subscriptionStatus=expired",
  );
});

test("user and organization query deep links hydrate drawers and preserve focus containment", async ({ context, page }) => {
  await installAuthorizedShell(context);
  await context.route("**/api/admin/users?**", (route) => fulfillJson(route, DIRECTORY_PAGE));
  await context.route("**/api/admin/users/user-e2e", (route) => fulfillJson(route, {
    user: {
      ...DIRECTORY_PAGE.items[0], activeSessionCount: 1, organizationCount: 0,
      organizations: [], recentAudit: [], subscription: null, usage: null, links: {},
    },
  }));
  await context.route("**/api/admin/organizations?**", (route) => fulfillJson(route, ORGANIZATION_PAGE));
  await context.route("**/api/admin/organizations/org-e2e", (route) => fulfillJson(route, {
    organization: {
      ...ORGANIZATION_PAGE.items[0], users: [], recentAudit: [], usage: null, links: {},
      security: { activeSessionCount: 0 },
    },
  }));

  await page.goto("/admin/users?detail=user-e2e", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 2, name: "Người dùng", exact: true })).toBeVisible();
  const userDrawer = page.locator("[data-admin-detail-drawer]");
  await expect(userDrawer).toHaveAttribute("role", "dialog");
  await expect(userDrawer).toHaveAttribute("aria-modal", "true");
  await expect(userDrawer.getByRole("heading", { name: "Người dùng kiểm thử" })).toBeVisible();
  await expect(userDrawer.getByLabel("Đóng")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(userDrawer.getByRole("button", { name: "Ngừng hoạt động tài khoản" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(userDrawer).toHaveCount(0);
  await expect(page).not.toHaveURL(/detail=user-e2e/u);

  await page.goto("/admin/organizations?detail=org-e2e", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 2, name: "Tổ chức", exact: true })).toBeVisible();
  const organizationDrawer = page.locator("[data-admin-detail-drawer]");
  await expect(organizationDrawer.getByRole("heading", { name: "Tổ chức kiểm thử" })).toBeVisible();
  await expect(organizationDrawer.getByLabel("Đóng")).toBeFocused();
});

test("invoice and failed-job journeys load sanitized details and require explicit retry confirmation", async ({ context, page }) => {
  await installAuthorizedShell(context);
  const jobId = "0123456789abcdef0123456789abcdef";
  const retryBodies = [];
  const invoice = {
    id: "invoice-e2e", status: "issued", attemptCount: 1,
    owner: { kind: "organization", id: "org-e2e", name: "Tổ chức kiểm thử" },
    orderPublicId: "ORDER-E2E",
    amounts: { orderTotalMinor: 1250000, verifiedPaidMinor: 1250000, currency: "VND" },
    paymentTransaction: { id: "txn-e2e", providerTransactionId: "safe-provider-id", status: "verified", createdAt: "2026-09-10T00:00:00Z" },
    provider: { name: "payOS", environment: "production", invoiceReference: "INV-SAFE" },
    documentAvailable: false, createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T01:00:00Z",
  };
  await context.route("**/api/admin/invoices?**", (route) => fulfillJson(route, directoryPage([invoice])));
  await context.route("**/api/admin/invoices/invoice-e2e", (route) => fulfillJson(route, {
    invoiceRequest: invoice,
    notice: "Yêu cầu có thẩm quyền; không phải tài liệu hóa đơn được tạo giả.",
  }));
  await context.route("**/api/admin/subscriptions?**", (route) => fulfillJson(route, directoryPage([{
    owner: { kind: "organization", id: "org-e2e", name: "Tổ chức kiểm thử" },
    packageId: "internal", planVersionId: "plan-v1", status: "active", source: "order",
    sourceOrderPublicId: "ORDER-E2E", memberQuota: 20, revision: 2,
    createdAt: "2026-09-01T00:00:00Z", startsAt: "2026-09-01T00:00:00Z",
    expiresAt: "2027-09-01T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z",
  }])));
  const failedJob = {
    id: jobId, operation: "document", recordType: "export", organizationId: "org-e2e",
    status: "failed", retryAllowed: true, attemptCount: 2,
    progress: { completedItems: 0, totalItems: 1, phase: "failed" },
    error: { code: "RENDER_FAILED", message: "Lỗi dựng tài liệu đã khử nhạy cảm." },
    lastErrorCode: "RENDER_FAILED", createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T01:00:00Z",
  };
  await context.route("**/api/admin/system/jobs?**", (route) => fulfillJson(route, {
    ...directoryPage([failedJob]), summary: { total: 1, byStatus: { failed: 1 } },
  }));
  await context.route(`**/api/admin/system/jobs/${jobId}`, (route) => fulfillJson(route, { job: failedJob }));
  await context.route(`**/api/admin/system/jobs/${jobId}/retry`, async (route) => {
    retryBodies.push(route.request().postDataJSON());
    await fulfillJson(route, { success: true });
  });

  await page.goto("/admin/invoices/invoice-e2e", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 2, name: "Hóa đơn", exact: true })).toBeVisible();
  const invoiceDrawer = page.locator("[data-admin-billing-detail-drawer]");
  await expect(invoiceDrawer.getByRole("heading", { name: "invoice-e2e" })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/invoices\/invoice-e2e(?:\?|$)/u);
  await expect(invoiceDrawer).toContainText("INV-SAFE");
  await expect(invoiceDrawer).toContainText("Chưa có mô hình tài liệu hóa đơn");
  await expect(invoiceDrawer).not.toContainText("DATABASE_URL=");
  await invoiceDrawer.getByLabel("Đóng").click();
  await expect(page).toHaveURL(/\/admin\/invoices(?:\?|$)/u);

  await page.getByRole("button", { name: "Xem" }).click();
  await expect(page).toHaveURL(/\/admin\/invoices\/invoice-e2e(?:\?|$)/u);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/invoices(?:\?|$)/u);
  await expect(invoiceDrawer).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/invoices\/invoice-e2e(?:\?|$)/u);
  await expect(page.locator("[data-admin-billing-detail-drawer]")).toContainText("INV-SAFE");
  await page.locator("[data-admin-billing-detail-drawer]").getByLabel("Đóng").click();

  await page.locator('[data-admin-link="/admin/subscriptions"]').click();
  await expectAdminReady(page, "Đăng ký");
  await page.getByRole("button", { name: "Xem" }).click();
  const subscriptionDrawer = page.locator("[data-admin-billing-detail-drawer]");
  await expect(subscriptionDrawer.getByRole("heading", { name: "Tổ chức kiểm thử" })).toBeVisible();
  await expect(subscriptionDrawer).toContainText("plan-v1");
  await expect(subscriptionDrawer).toContainText("ORDER-E2E");
  await page.keyboard.press("Shift+Tab");
  await expect(subscriptionDrawer.getByLabel("Đóng")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(subscriptionDrawer).toHaveCount(0);

  await page.locator('[data-admin-link="/admin/system/jobs"]').click();
  await expectAdminReady(page, "Tác vụ");
  await page.getByRole("button", { name: "Xem và thao tác" }).click();
  const jobDrawer = page.locator("[data-admin-job-detail]");
  await expect(jobDrawer.getByLabel("Đóng")).toBeFocused();
  await expect(jobDrawer).toContainText("Lỗi dựng tài liệu đã khử nhạy cảm");
  await page.keyboard.press("Shift+Tab");
  await expect(jobDrawer.getByRole("button", { name: "Chạy lại tác vụ" })).toBeFocused();
  await jobDrawer.getByRole("button", { name: "Chạy lại tác vụ" }).click();
  const confirmation = page.getByRole("dialog", { name: "Xác nhận chạy lại tác vụ" });
  await confirmation.getByLabel(`Nhập ${jobId} để xác nhận`).fill(jobId);
  await confirmation.getByRole("button", { name: "Tiếp tục" }).click();
  await expect.poll(() => retryBodies.length).toBe(1);
  expect(retryBodies[0]).toEqual({});
});

test("settings categories, secret masking, charts, and primary journeys meet automated accessibility checks", async ({ context, page }) => {
  await installAuthorizedShell(context);
  await context.route("**/api/admin/environment", (route) => fulfillJson(route, {
    runtime: { environment: "production", frontendAssetMode: "manifest", debugEnabled: false, secureCookies: true },
    features: { aiEnabled: true, legalVersioningEnabled: true, versionComparisonEnabled: true, paymentCheckoutEnabled: true },
    secretStatus: {
      DATABASE_URL: { configured: true, writable: false, source: "deployment" },
      PAYOS_API_KEY: { configured: false, writable: false, source: "deployment" },
    },
    configuration: { writable: false, source: "deployment" },
  }));
  await context.route("**/api/admin/usage-analytics/summary?**", (route) => fulfillJson(route, {
    summary: { coverage: { hasData: true }, onlineNow: 3, activeUsers: 9, workActivityCount: 12, wordExportCount: 4, topFeatures: [] },
  }));
  await context.route("**/api/admin/product-analytics/dashboard?**", (route) => fulfillJson(route, {
    dashboard: {
      hasData: true, kpis: [], table: [],
      series: [{ label: "Kế hoạch", points: [{ date: "2026-09-10", value: 5, status: "available" }] }],
    },
  }));
  await context.route("**/api/admin/health", (route) => fulfillJson(route, {
    operations: {
      analytics: {
        http: { scope: "current_process", requests: 120, clientErrors: 4, serverErrors: 2, averageLatencyMs: 12.5 },
        database: { scope: "current_process", requests: 80, failures: 1, averageLatencyMs: 8.2 },
      },
      documentWorker: { failed: 3, rejected: 1, averageQueueWaitMs: 7.5 },
      backgroundJobs: [{ status: "pending", count: 5 }, { status: "retry", count: 2 }],
    },
  }));

  await page.goto("/admin/settings", { waitUntil: "commit" });
  await expectAdminReady(page, "Cài đặt");
  for (const category of ["Application", "Registration", "Localization", "Billing", "Documents", "Notifications", "Storage", "Sync"]) {
    await expect(page.getByRole("rowheader", { name: category })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Lưu cấu hình" })).toBeDisabled();
  let accessibility = await new AxeBuilder({ page })
    .include("#admin-app")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.locator('[data-admin-link="/admin/environment"]').click();
  await expectAdminReady(page, "Môi trường");
  await expect(page.locator('[data-admin-secret-status="DATABASE_URL"]')).toHaveText("Đã cấu hình");
  await expect(page.locator('[data-admin-secret-status="PAYOS_API_KEY"]')).toHaveText("Thiếu cấu hình");
  await expect(page.getByRole("button", { name: "Thay thế" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/postgres(?:ql)?:\/\//u);

  await page.locator('[data-admin-link="/admin/analytics"]').click();
  await expectAdminReady(page, "Phân tích");
  const chart = page.getByRole("img", { name: "Kế hoạch", exact: true });
  await expect(chart).toBeVisible();
  await expect(page.getByRole("table", { name: "Dữ liệu dạng bảng cho Kế hoạch" })).toContainText("2026-09-10");
  accessibility = await new AxeBuilder({ page })
    .include("#admin-app")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByLabel("Chế độ xem").selectOption("operations");
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await expect(page.getByText("Yêu cầu API")).toBeVisible();
  await expect(page.getByText("120", { exact: true })).toBeVisible();
  await expect(page.getByText(/N\/A — hệ thống chưa lưu chuỗi thời gian/u)).toBeVisible();
});
