import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";


const fixtureReady = Boolean(process.env.VNEPS_VIOLATION_FIXTURE_PATH);

test.skip(
  !fixtureReady,
  "Requires the isolated violation fixture provider.",
);

function fixture(script, action, payload) {
  const result = spawnSync(process.env.PYTHON || "python", [script, action], {
    input: JSON.stringify(payload), encoding: "utf8", windowsHide: true, env: process.env,
  });
  if (result.status !== 0) throw new Error(`Violation fixture ${action} failed: ${result.stderr}`);
}

test.beforeEach(async ({ page, browserName }) => {
  const runId = `violation-${Date.now()}-${browserName}`;
  const payload = { runId, organizationId: `${runId}-org`, contractors: [
    { id: `${runId}-contractor-1`, code: "vn000000001", taxCode: "0000000001", name: "Nhà thầu vi phạm fixture" },
    { id: `${runId}-contractor-2`, code: "vn000000002", taxCode: "0000000002", name: "Thành viên đứng đầu liên danh fixture" },
    { id: `${runId}-contractor-3`, code: "vn000000003", taxCode: "0000000003", name: "Thành viên vi phạm fixture" },
  ],
    account: { id: `${runId}-user`, username: runId, name: runId, email: `${runId}@example.invalid` },
    password: `Aa!9${randomBytes(12).toString("hex")}`,
    package: { id: `${runId}-package`, code: runId.toUpperCase(), name: runId, price: 900000000 },
    fixtureDates: { ownerEffective: "2026-01-01", contractorEffective: "2026-01-01",
      planApproval: "2026-01-02", packageStart: "Quý I/2026",
      packagePublishedAt: "2026-02-01 08:00:00", packageClosingAt: "2026-03-01 09:00:00",
      packageOpeningAt: "2026-03-01 10:00:00" } };
  fixture("scripts/joint_venture_e2e_fixture.py", "setup", payload);
  page.__violationFixture = payload;
});

test.afterEach(async ({ page }) => {
  if (page.__violationFixture) fixture("scripts/lifecycle_e2e_fixture.py", "cleanup", page.__violationFixture);
});


async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  });
}


async function login(page) {
  const { account: { username }, password } = page.__violationFixture;
  await page.goto("/dang-nhap", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await expect(page.locator("#auth-overlay")).toBeHidden();
  await page.waitForFunction(() => (
    document.getElementById("btn-force-sync")?.dataset.startupReconciliationPhase === "RECONCILED"
  ));
}


async function openOpening(page) {
  const packageId = page.__violationFixture.package.id;
  await page.goto("/goi-thau", {
    waitUntil: "domcontentloaded",
  });
  await waitForApp(page);
  await page.waitForFunction(() => (
    document.getElementById("btn-force-sync")?.dataset.startupReconciliationPhase === "RECONCILED"
  ));
  await page.locator(
    `[data-bf-action="show-package"][data-id="${packageId}"]`,
  ).first().click();
  await expect(page.locator("#tab-goithau-detail.active")).toBeVisible();
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
  const saveResponse = page.waitForResponse(response => (
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/sync"
  ));
  await page.locator("#btn-mothau-save").click();
  const response = await saveResponse;
  const payload = await response.json();
  const sentPackage = response.request().postDataJSON()?.goithau?.[0];
  expect(response.ok(), JSON.stringify({ code: payload.code,
    expectedPackageCode: page.__violationFixture.package.code,
    submittedPackageCode: sentPackage?.maGoiThau,
    errors: (payload.errors || payload.fields?.errors || []).map(error => ({
      table: error.table, field: error.field, code: error.code, message: error.message,
    })),
  })).toBe(true);
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
