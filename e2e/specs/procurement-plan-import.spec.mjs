import { expect, test } from "@playwright/test";


const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
const planCode = String(process.env.E2E_PROCUREMENT_PLAN_CODE || "PL2600000001");
const fixtureReady = Boolean(
  password
  && String(process.env.VNEPS_PROCUREMENT_IMPORT_ENABLED || "").toLowerCase() === "true"
  && String(process.env.VNEPS_PROCUREMENT_PROVIDER || "").toLowerCase() === "fixture"
  && process.env.VNEPS_PROCUREMENT_FIXTURE_PATH
);

test.skip(
  !fixtureReady,
  "Requires the approved fixture-backed legacy procurement import environment.",
);


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


async function serverHasPlan(page, code) {
  return page.evaluate(async (planCode) => {
    const response = await fetch(
      `/api/paginate?table=kehoach&page=1&pageSize=10&search=${encodeURIComponent(planCode)}`,
      { credentials: "same-origin" },
    );
    if (!response.ok) throw new Error(`Plan lookup returned ${response.status}`);
    return (await response.text()).includes(planCode);
  }, code);
}


test("fixture KHLCNT stays draft-only until the final inline-import confirmation", async ({ page }) => {
  await login(page);
  await page.goto("/ke-hoach/tao-moi", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.getByRole("button", { name: "Thêm Kế hoạch mới" }).click();
  await expect(page.locator("#modal-kehoach.active")).toBeVisible();
  await page.locator("#kh-ma").fill(planCode);
  await page.locator("#kh-chudautuid").evaluate((select) => {
    const option = [...select.options].find((candidate) => (
      candidate.value && candidate.value !== "__NEW_INVESTOR__"
    ));
    if (!option) throw new Error("Fixture workspace has no existing investor");
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator("#procurement-lookup-plan-enabled").check();

  const status = page.locator("#procurement-lookup-plan-status");
  await expect(status).toHaveAttribute("data-state", "success");
  await expect(status).toContainText("Dữ liệu chưa được lưu");
  await expect(page.locator("#kh-ten")).toHaveValue(
    "Kế hoạch mua sắm thiết bị năm 2026",
  );
  await expect.poll(() => serverHasPlan(page, planCode)).toBe(false);

  await page.locator("#form-kehoach button[type='submit']").click();
  const breakdown = page.locator("#modal-plan-breakdown.active");
  await expect(breakdown).toBeVisible();
  await breakdown.locator('[data-breakdown-tab="goithau"]').click();
  await expect(breakdown.locator("#tbody-breakdown-goithau")).toContainText("Gói A");
  await expect.poll(() => serverHasPlan(page, planCode)).toBe(false);

  await breakdown.locator("#btn-save-plan-version-draft").click();
  const continueDialog = page.locator("#modal-custom-dialog.active");
  await expect(continueDialog).toContainText("còn phiên bản 01");
  await continueDialog.locator("#btn-dialog-ok").click();

  const nextPlanModal = page.locator("#modal-kehoach.active");
  await expect(nextPlanModal).toBeVisible();
  await expect(nextPlanModal.locator("#kh-quyetdinh")).toHaveValue("02/QĐ-FIXTURE");
  await expect.poll(() => serverHasPlan(page, planCode)).toBe(false);
  await nextPlanModal.locator("#form-kehoach button[type='submit']").click();

  await expect(breakdown).toBeVisible();
  await expect(breakdown.locator("#btn-save-plan-breakdown")).toBeVisible();
  await breakdown.locator("#btn-save-plan-breakdown").click();
  await expect(breakdown).toBeHidden();
  await expect.poll(() => serverHasPlan(page, planCode)).toBe(true);
  await expect(page.locator("#kehoach-table tbody")).toContainText(planCode);
});
