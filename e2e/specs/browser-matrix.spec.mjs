import { expect, test } from "@playwright/test";

const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!password) throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  });
}

async function expectFilterDropdownToOpen(page, route, selectId) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await waitForApp(page);

  const combobox = page.locator(`${selectId}-combobox`);
  await expect(combobox).toBeVisible();
  await expect(combobox).toHaveAttribute("data-bf-auto-scroll", "off");
  await combobox.click();
  await expect(combobox).toHaveAttribute("aria-expanded", "true");

  const listboxId = await combobox.getAttribute("aria-controls");
  expect(listboxId).toBeTruthy();
  await expect(page.locator(`#${listboxId}`)).toBeVisible();
}

test("required browser renders public routes, shell, and filter dropdowns", async ({ page }) => {
  const landing = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(landing?.ok()).toBe(true);
  await expect(page.locator('[data-bf-shell="landing"]')).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((body) => body.clientWidth));

  const legal = await page.goto("/legal", { waitUntil: "domcontentloaded" });
  expect(legal?.ok()).toBe(true);
  await expect(page.locator('[data-bf-shell="legal"]')).toBeVisible();

  await page.goto("/dang-nhap", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.locator("#auth-overlay").waitFor({ state: "hidden" });
  await waitForApp(page);

  await page.goto("/tong-quan", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  const profile = page.locator("#header-profile-trigger");
  await expect(profile).toBeVisible();
  await profile.click();
  await expect(page.locator("#profile-dropdown-menu")).toHaveClass(/active/);

  await expectFilterDropdownToOpen(page, "/goi-thau", "#filter-goithau-trangthai");
  await expectFilterDropdownToOpen(page, "/ke-hoach", "#filter-kehoach-nam");
  await expectFilterDropdownToOpen(page, "/hop-dong", "#filter-hopdong-nam");
});
