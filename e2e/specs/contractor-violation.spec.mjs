import { expect, test } from "@playwright/test";


const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
const packageId = String(process.env.E2E_CONTRACTOR_VIOLATION_PACKAGE_ID || "");


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
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById("auth-overlay")).display === "none",
  );
}


async function openOpening(page) {
  await page.goto(`/goi-thau?evaluationPackage=${encodeURIComponent(packageId)}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForApp(page);
  const openingTab = page.locator(
    'button[data-workflow-tab="opening"], button[data-workflow-tab="opening_tech"]',
  ).first();
  await openingTab.click();
  await page.locator("#mothau-table-tbody").waitFor({ state: "visible" });
}


async function fillCommonOpeningFields(row) {
  const values = new Map([
    [".mt-gia-du-thau", "780000000"],
    [".mt-ty-le-giam-gia", "0"],
    [".mt-hieu-luc-hsdt", "90"],
    [".mt-hieu-luc-hsdxt", "90"],
    [".mt-gia-tri-dam-bao", "10000000"],
    [".mt-dam-bao-du-thau", "10000000"],
    [".mt-hieu-luc-bao-dam-ngay", "120"],
    [".mt-hieu-luc-dam-bao", "120"],
    [".mt-thoi-gian-thuc-hien", "90 ngày"],
  ]);
  for (const [selector, value] of values) {
    const input = row.locator(selector);
    if (await input.count() && await input.isEditable()) await input.fill(value);
  }
}


test("confirmed contractor and exact joint-venture members stay red after reload", async ({ page }) => {
  test.skip(!password || !packageId, "Requires E2E credentials and an editable opening package fixture");
  test.skip(
    !process.env.VNEPS_VIOLATION_FIXTURE_PATH,
    "The server must use the recorded VNEPS provider; live VNEPS is forbidden in CI",
  );

  await login(page);
  await openOpening(page);
  const rows = page.locator("#mothau-table-tbody tr");
  if (await rows.count() === 0) await page.locator("#btn-mothau-add-bid").click();

  const independent = rows.first();
  await independent.locator(".mt-ma-nha-thau").fill("vn000000001");
  await independent.locator(".mt-ten-nha-thau").fill("Nhà thầu vi phạm fixture");
  await fillCommonOpeningFields(independent);
  await independent.locator(".mt-ma-nha-thau").press("Enter");
  await expect(independent.locator(".mt-ten-nha-thau")).toHaveClass(
    /bidder-name--violator/,
  );

  await page.locator("#btn-mothau-add-bid").click();
  const venture = rows.last();
  await venture.locator(".mt-loai-nha-thau").selectOption({ label: "Liên danh" });
  await venture.locator(".mt-ma-nha-thau").fill("vn000000002");
  await venture.locator(".mt-ten-nha-thau").fill("Liên danh fixture");
  await fillCommonOpeningFields(venture);
  await venture.locator(".mt-ma-nha-thau").press("Enter");
  await expect(venture.locator(".mt-ten-nha-thau")).toHaveClass(
    /bidder-name--violator/,
  );

  await venture.locator(".mt-btn-manage-members").click();
  const member = page.locator("#mothau-jv-members-list .mothau-jv-member-row").first();
  await member.locator(".jv-input-mst").fill("vn000000001");
  await member.locator(".jv-input-ten").fill("Thành viên vi phạm fixture");
  await member.locator(".jv-input-mst").blur();
  await expect(member.locator(".jv-input-ten")).toHaveClass(/bidder-name--violator/);
  await page.locator("#btn-add-mothau-jv-member").click();
  const cleanMember = page.locator("#mothau-jv-members-list .mothau-jv-member-row").last();
  await cleanMember.locator(".jv-input-mst").fill("vn000000099");
  await cleanMember.locator(".jv-input-ten").fill("Thành viên không vi phạm");
  await cleanMember.locator(".jv-input-mst").blur();
  await expect(cleanMember.locator(".jv-input-ten")).not.toHaveClass(
    /bidder-name--violator/,
  );
  await page.locator("#btn-save-mothau-jv").click();

  await expect(page.getByText("Có vi phạm", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-violation-badge], [data-violation-tooltip]')).toHaveCount(0);
  await page.locator("#btn-mothau-save").click();
  const successDialog = page.locator("#modal-custom-dialog.active");
  if (await successDialog.count()) await page.locator("#btn-dialog-ok").click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  const openingTab = page.locator(
    'button[data-workflow-tab="opening"], button[data-workflow-tab="opening_tech"]',
  ).first();
  await openingTab.click();
  const reloadedRows = page.locator("#mothau-table-tbody tr");
  await expect(reloadedRows.first().locator(".mt-ten-nha-thau")).toHaveClass(
    /bidder-name--violator/,
  );
  await expect(reloadedRows.last().locator(".mt-ten-nha-thau")).toHaveClass(
    /bidder-name--violator/,
  );
  await reloadedRows.last().locator(".mt-jv-view-link").click();
  await expect(
    page.locator("#modal-mothau-jv-view .bidder-name--violator").filter({
      hasText: "Thành viên vi phạm fixture",
    }),
  ).toHaveCount(1);
  await expect(
    page.locator("#modal-mothau-jv-view .bidder-name--violator").filter({
      hasText: "Thành viên không vi phạm",
    }),
  ).toHaveCount(0);
});
