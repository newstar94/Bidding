import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");

async function waitForApp(page) {
  await page.locator("#system-init-loader").waitFor({ state: "hidden", timeout: 20_000 });
}

test("AUTH-SMOKE-001 login, dashboard, keyboard validation and accessibility", async ({ page }) => {
  test.skip(!password, "E2E_PASSWORD or ADMIN_PASSWORD is required for the authenticated smoke test");

  const consoleErrors = [];
  const pageErrors = [];
  const networkFailures = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("GSI_LOGGER") || message.text().includes("accounts.google.com")) return;
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => networkFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));

  await page.goto("/dang-nhap", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  const dialog = page.getByRole("dialog", { name: "Đăng nhập hệ thống", exact: true });
  await expect(dialog).toBeVisible();

  const usernameBox = dialog.getByRole("textbox", { name: "Tên đăng nhập / Email *", exact: true });
  const passwordBox = dialog.getByRole("textbox", { name: "Mật khẩu *", exact: true });
  await usernameBox.focus();
  await usernameBox.press("Tab");
  await expect(passwordBox).toBeFocused();
  await passwordBox.press("Enter");
  await expect(usernameBox).toBeFocused();

  await usernameBox.fill(username);
  await passwordBox.fill(password);
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Tổng quan hệ thống", exact: true })).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const seriousViolations = accessibility.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
  expect(seriousViolations, JSON.stringify(seriousViolations, null, 2)).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(networkFailures).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("A11Y-SMOKE-002 landing page has named navigation and no horizontal overflow", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Quản lý đấu thầu liền mạch, từ kế hoạch đến hợp đồng.", exact: true })).toBeVisible();
  const metrics = await page.evaluate(() => ({
    language: document.documentElement.lang,
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.language).toBe("vi");
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(await page.getByRole("link", { name: "Đăng nhập", exact: true }).count()).toBeGreaterThan(0);
});
