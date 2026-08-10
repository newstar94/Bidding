import { expect, test } from "@playwright/test";


const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
const planCode = String(process.env.E2E_PROCUREMENT_PLAN_CODE || "PL2600000001");


async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  });
}


async function login(page) {
  await page.goto("/dang-nhap", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForFunction(
    () => typeof document.getElementById("form-auth-login")?.onsubmit === "function",
  );
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await expect(page.locator("#login-username")).toBeHidden();
}


test("fixture KHLCNT previews packages and applies only after confirmation", async ({ page }) => {
  await login(page);
  await page.goto("/ke-hoach/tao-moi", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.getByRole("button", { name: "Thêm Kế hoạch mới" }).click();
  await expect(page.locator("#modal-kehoach.active")).toBeVisible();
  await page.locator("#kh-ma").fill(planCode);
  await page.locator("#btn-open-procurement-import").click();
  const modal = page.locator("#modal-procurement-import");
  await expect(modal).toHaveClass(/active/);
  await modal.locator("[data-procurement-code]").fill(planCode);
  await modal.getByRole("combobox", { name: "Phạm vi phiên bản" }).click();
  await page.locator(".bf-combobox-list:not([hidden])").getByRole(
    "option", { name: "Toàn bộ lịch sử" },
  ).click();
  await modal.locator("[data-procurement-prepare]").click();
  await expect(modal.locator("[data-procurement-packages] tr").first()).toBeVisible();
  await expect(modal.locator("[data-procurement-status]")).toContainText("Preview");
  await modal.getByRole("combobox", { name: "Chủ đầu tư BiddingFlow" }).click();
  await page.locator(".bf-combobox-list:not([hidden])").getByRole("option").filter(
    { hasNotText: "-- Chọn" },
  ).first().click();
  await expect(modal.locator("[data-procurement-apply]")).toBeEnabled();
  await modal.locator("[data-procurement-apply]").click();
  await expect(modal).not.toHaveClass(/active/);
  await expect(page.locator("#kehoach-table tbody")).toContainText(planCode);
});
