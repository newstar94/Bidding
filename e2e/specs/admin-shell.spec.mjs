import { readFile } from "node:fs/promises";
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

function authorizedShell() {
  return ADMIN_TEMPLATE
    .replace("__BF_ADMIN_STYLES__", '<link rel="stylesheet" href="/vendor/tabler/tabler.min.css">\n<link rel="stylesheet" href="/frontend/admin-platform/admin.css">')
    .replace("__BF_ADMIN_VENDOR_SCRIPT__", '<script src="/vendor/tabler/tabler.min.js" defer></script>')
    .replace("__BF_ADMIN_ENTRY__", "/frontend/admin-platform/AdminApp.js")
    .replace("__BF_ADMIN_SESSION__", JSON.stringify(ADMIN_SESSION).replaceAll("<", "\\u003c"));
}

async function installAuthorizedShell(context) {
  await context.route(ADMIN_DOCUMENT, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    headers: {
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
    body: authorizedShell(),
  }));
}

async function fulfillJson(route, payload, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

async function expectAdminReady(page, title) {
  await expect(page.locator("#admin-app")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
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
