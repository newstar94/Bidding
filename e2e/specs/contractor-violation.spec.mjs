import { expect, test } from "@playwright/test";


const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
const packageId = String(process.env.E2E_CONTRACTOR_VIOLATION_PACKAGE_ID || "");
const fixtureReady = Boolean(
  password
  && packageId
  && process.env.VNEPS_VIOLATION_FIXTURE_PATH
);

test.skip(
  !fixtureReady,
  "Requires E2E password, contractor package ID and violation fixture.",
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
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById("auth-overlay")).display === "none",
  );
}


async function openOpening(page) {
  await page.goto("/goi-thau", {
    waitUntil: "domcontentloaded",
  });
  await waitForApp(page);
  await page.locator(
    `[data-bf-action="show-package"][data-id="${packageId}"]`,
  ).first().click();
  const openingTab = page.locator(
    'button[data-workflow-tab="opening"], button[data-workflow-tab="opening_tech"]',
  ).first();
  await openingTab.click();
  await page.locator("#mothau-table-tbody").waitFor({ state: "visible" });
}


async function fillCommonOpeningFields(row) {
  const fields = [
    [[".mt-gia-du-thau"], "780000000"],
    [[".mt-ty-le-giam-gia"], "0"],
    [[".mt-hieu-luc-hsdt", ".mt-hieu-luc-hsdxt"], "90"],
    [[".mt-gia-tri-dam-bao", ".mt-dam-bao-du-thau"], "10000000"],
    [[".mt-hieu-luc-bao-dam-ngay", ".mt-hieu-luc-dam-bao"], "120"],
    [[".mt-thoi-gian-thuc-hien"], "90 ngày"],
  ];
  for (const [selectors, value] of fields) {
    for (const selector of selectors) {
      const input = row.locator(selector);
      if (await input.count() && await input.isEditable()) {
        await input.fill(value);
        break;
      }
    }
  }
}


test("confirmed contractor and exact joint-venture members stay red after reload", async ({ page }) => {
  await login(page);
  await openOpening(page);
  const rows = page.locator("#mothau-table-tbody tr");
  while (await rows.count() < 2) await page.locator("#btn-mothau-add-bid").click();

  const independent = rows.first();
  await independent.locator(".mt-ma-nha-thau").fill("vn000000001");
  await independent.locator(".mt-ten-nha-thau").fill("Nhà thầu vi phạm fixture");
  await fillCommonOpeningFields(independent);
  await independent.locator(".mt-ma-nha-thau").press("Enter");
  await expect(independent.locator(".mt-ten-nha-thau")).toHaveClass(
    /bidder-name--violator/,
  );

  const venture = rows.nth(1);
  await venture.locator(".mt-loai-nha-thau").evaluate((select) => {
    select.value = "Liên danh";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await venture.locator(".mt-ma-nha-thau").fill("vn000000002");
  await venture.locator(".mt-ten-nha-thau").fill("Liên danh fixture");
  await fillCommonOpeningFields(venture);
  await venture.locator(".mt-ma-nha-thau").press("Enter");
  await expect(venture.locator(".mt-ten-nha-thau")).toHaveClass(
    /bidder-name--violator/,
  );

  await venture.locator(".mt-btn-manage-members").click();
  await page.locator("#jv-input-lead-name").fill("Liên danh fixture");
  const members = page.locator("#mothau-jv-members-list .mothau-jv-member-row");
  while (await members.count() < 2) await page.locator("#btn-add-mothau-jv-member").click();
  const member = members.first();
  await member.locator(".jv-input-mst").fill("vn000000003");
  await member.locator(".jv-input-ten").fill("Thành viên vi phạm fixture");
  await member.locator(".jv-input-mst").blur();
  await expect(member.locator(".jv-input-ten")).toHaveClass(/bidder-name--violator/);
  const cleanMember = members.nth(1);
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
  await expect(page.locator('[data-workflow-tab="eval_tech"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#danhgiahsdt-so-baocao")).toBeVisible();

  await openOpening(page);
  const reloadedRows = page.locator("#mothau-table-tbody tr");
  const reloadedIndependent = reloadedRows.filter({ hasText: "vn000000001" });
  const reloadedVenture = reloadedRows.filter({ hasText: "vn000000002" });
  await expect(reloadedIndependent.locator(".mt-ten-nha-thau")).toHaveClass(
    /bidder-name--violator/,
  );
  await expect(reloadedVenture.locator(".mt-ten-nha-thau")).toHaveClass(
    /bidder-name--violator/,
  );
  await reloadedVenture.locator(".mt-jv-view-link").click();
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
