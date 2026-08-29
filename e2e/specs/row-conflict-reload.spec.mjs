import { expect, test } from "@playwright/test";

import { createE2ETestClock } from "../../scripts/e2e_test_clock.mjs";

const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
const clock = createE2ETestClock();

test.use({ serviceWorkers: "block" });
test.setTimeout(300_000);

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  });
}

async function waitForInitialReconciliation(page) {
  await page.waitForFunction(() => (
    document.getElementById("btn-force-sync")?.dataset.syncState === "server-saved"
  ));
}

async function isolateHostInjectedScripts(context) {
  // Some developer machines inject AdGuard userscripts into every document.
  // This scenario intentionally performs many cold navigations, so keep its
  // manually-created contexts as isolated as Playwright's standard fixtures.
  await context.route("http://local.adguard.org/**", (route) => route.abort("blockedbyclient"));
}

async function login(page) {
  const response = await page.context().request.post("/api/auth/login", {
    data: { username, password, remember: false },
  });
  expect(response.ok(), await response.text().catch(() => "")).toBe(true);
}

async function gotoReady(page, route) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await waitForInitialReconciliation(page);
}

async function gotoCleanupReady(page, route) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForFunction(() => {
    const state = document.getElementById("btn-force-sync")?.dataset.syncState;
    return state === "server-saved" || state === "conflict";
  });
}

async function openCreateModal(page, route, buttonSelector, modalSelector) {
  await gotoReady(page, route);
  await page.locator(buttonSelector).click();
  await expect(page.locator(`${modalSelector}.active`)).toBeVisible();
}

async function submitModal(page, formSelector, modalSelector) {
  await page.locator(`${formSelector} button[type='submit']`).click();
  if (formSelector === "#form-goithau") {
    await expect(page.locator(modalSelector)).toHaveAttribute(
      "data-editor-state",
      "closed",
      { timeout: 20_000 },
    );
  }
  await expect(page.locator(`${modalSelector}.active`)).toBeHidden({ timeout: 20_000 });
}

async function selectFirstAddress(page, provinceSelector, wardSelector) {
  await page.locator(provinceSelector).selectOption({ index: 1 }, { force: true });
  await page.waitForFunction((selector) => {
    const ward = document.querySelector(selector);
    return ward && !ward.disabled && ward.options.length > 1;
  }, wardSelector);
  await page.locator(wardSelector).selectOption({ index: 1 }, { force: true });
}

async function checkMountedCheckbox(locator) {
  await locator.evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function dismissOptionalDialog(page) {
  const dialog = page.locator("#modal-custom-dialog.active");
  const visible = await dialog.waitFor({ state: "visible", timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  const ok = page.locator("#btn-dialog-ok");
  if (await ok.count()) await ok.click();
  else await page.locator("#btn-dialog-close").click();
  await expect(dialog).toBeHidden();
}

async function savePlanBreakdown(page, timeout = 30_000) {
  await page.locator("#btn-save-plan-breakdown").click();
  await expect(page.locator("#modal-plan-breakdown.active")).toBeHidden({ timeout });
  await dismissOptionalDialog(page);
}

async function selectVisibleVersion(packageRow, label) {
  const nativeSelect = packageRow.locator('select[data-bf-change="change-package-version"]');
  const option = nativeSelect.locator("option").filter({ hasText: label });
  await expect(option).toHaveCount(1);
  const selectedId = await option.getAttribute("value");
  expect(selectedId).toBeTruthy();
  // Version changes rerender the row and regenerate combobox ids. Drive the
  // stable delegated change seam, then assert the replacement accessible UI.
  await nativeSelect.selectOption(selectedId, { force: true });
  await expect(packageRow.locator('select[data-bf-change="change-package-version"]'))
    .toHaveValue(selectedId);
  await expect(packageRow.getByRole("combobox", {
    name: /Chọn phiên bản gói thầu/i,
  })).toHaveValue(label);
}

async function searchPackageRow(page, packageCode) {
  const normalizedCode = String(packageCode).toLowerCase();
  const input = page.locator("#search-goithau");
  if ((await input.inputValue()).toLowerCase() !== normalizedCode) {
    const responsePromise = page.waitForResponse((response) => {
      if (response.request().method() !== "GET") return false;
      const url = new URL(response.url());
      return url.pathname === "/api/paginate"
        && url.searchParams.get("table") === "goithau"
        && String(url.searchParams.get("search") || "").toLowerCase() === normalizedCode;
    });
    await input.fill(packageCode);
    const response = await responsePromise;
    expect(response.ok(), await response.text().catch(() => "")).toBe(true);
  }
  const row = page.locator("#goithau-table tbody tr").filter({ hasText: packageCode }).first();
  await expect(row).toBeVisible();
  return row;
}

async function createOwner(page, { code, name }) {
  await openCreateModal(page, "/chu-dau-tu", "#btn-add-chudautu", "#modal-chudautu");
  await page.locator("#cdt-ma").fill(code);
  await page.locator("#cdt-ten").fill(name);
  await page.locator("#cdt-ngayapdung").fill(clock.date(-60));
  await page.locator("#cdt-danhxung").fill("Ông");
  await page.locator("#cdt-daidiencdt").fill("Nguyễn Văn Kiểm Thử");
  await page.locator("#cdt-chucvunguoidungdau").fill("Giám đốc");
  await page.locator("#cdt-chucvudaidien").fill("Giám đốc");
  await selectFirstAddress(page, "#cdt-tinh", "#cdt-xa");
  await page.locator("#cdt-diachichitiet").fill("01 Đường kiểm thử xung đột");
  await submitModal(page, "#form-chudautu", "#modal-chudautu");
}

async function createExpert(page, { name, suffix }) {
  await openCreateModal(page, "/chuyen-gia", "#btn-add-chuyengia", "#modal-chuyengia");
  await page.locator("#cg-hoten").fill(name);
  await page.locator("#cg-socccd").fill(`07${String(Date.now()).slice(-9)}1`);
  await page.locator("#cg-ngaycapcccd").fill(clock.date(-3_650));
  await page.locator("#cg-noicapcccd").fill("Cục Cảnh sát QLHC về TTXH");
  await page.locator("#cg-sochungchi").fill(`${suffix}-CC`);
  await page.locator("#cg-ngaycapchungchi").fill(clock.date(-3_600));
  await page.locator("#cg-donvicapchungchi").fill("Cục Quản lý Đấu thầu");
  await submitModal(page, "#form-chuyengia", "#modal-chuyengia");
}

async function createPlan00(page, { code, name, ownerName }) {
  await openCreateModal(page, "/ke-hoach", "#btn-add-kehoach", "#modal-kehoach");
  await page.locator("#kh-ma").fill(code);
  await page.locator("#kh-ten").fill(name);
  await page.locator("#kh-loaihinh").selectOption({ label: "Dự toán mua sắm" }, { force: true });
  await page.locator("#kh-pheduyet").selectOption({ value: "Dự toán và kế hoạch" }, { force: true });
  await page.locator("#kh-duan").fill(`Dự toán ${name}`);
  await page.locator("#kh-chudautuid").selectOption({ label: ownerName }, { force: true });
  await page.locator("#kh-sototrinhdutoankehoach").fill(`${code}/TTR`);
  await page.locator("#kh-ngaytrinhkehoach").fill(clock.date(-33));
  await page.locator("#kh-quyetdinh").fill(`${code}/QD`);
  await page.locator("#kh-ngaypheduyet").fill(clock.date(-32));
  await page.locator("#kh-thoigiandang").fill(clock.dateTime(-31, "08:00"));
  await page.locator("#kh-tongmuc").fill("1000000000");
  await page.locator("#form-kehoach button[type='submit']").click();
  await expect(page.locator("#modal-plan-breakdown.active")).toBeVisible();
  await savePlanBreakdown(page);
}

async function createPackage00(page, {
  code, name, planName, baselineExpertName, appraisalExpertName,
}) {
  await openCreateModal(page, "/goi-thau", "#btn-add-goithau", "#modal-goithau");
  await page.locator("#gt-ma").fill(code);
  await page.locator("#gt-kehoachid").selectOption({ label: planName }, { force: true });
  await page.locator("#gt-ten").fill(name);
  await page.locator("#gt-gia").fill("500000000");
  await page.locator("#gt-thoigian").fill("90 ngày");
  await page.locator("#gt-linhvuc").selectOption({ label: "Hàng hóa" }, { force: true });
  await page.locator("#gt-hinhthuc").selectOption({ label: "Đấu thầu rộng rãi" }, { force: true });
  await page.locator("#gt-phuongthuc").selectOption({ label: "Một giai đoạn một túi hồ sơ" }, { force: true });
  await page.locator("#gt-phuongphapdanhgia").selectOption({ label: "Giá thấp nhất" }, { force: true });
  await page.locator("#gt-phanlo").selectOption({ label: "Không" }, { force: true });
  await page.locator("#gt-nguonvon").fill("Ngân sách nhà nước");
  await page.locator("#gt-thoigiantochuc").fill("45 ngày");
  await page.locator("#gt-thoigianbatdautochuc").fill(clock.quarter());
  await page.locator("#gt-nhanvienphutrach").selectOption({ index: 1 }, { force: true });
  const specialist = page.locator("#to-chuyengia-tbody tr").filter({ hasText: baselineExpertName }).first();
  const appraisal = page.locator("#to-thamdinh-tbody tr").filter({ hasText: appraisalExpertName }).first();
  await expect(specialist).toHaveCount(1);
  await expect(appraisal).toHaveCount(1);
  await checkMountedCheckbox(specialist.locator('input[name="tochuyengia-select"]'));
  await checkMountedCheckbox(appraisal.locator('input[name="tothamdinh-select"]'));
  await submitModal(page, "#form-goithau", "#modal-goithau");
}

async function createPlan01(page, { planCode }) {
  await gotoReady(page, "/ke-hoach");
  await page.locator("#search-kehoach").fill(planCode);
  const sourceRow = page.locator("#kehoach-table tbody tr").filter({ hasText: planCode }).first();
  await expect(sourceRow).toBeVisible();
  await sourceRow.locator('[data-bf-action="show-plan"]').click();
  await expect(page.locator("#fullpage-kh-version-select")).toBeAttached();
  const historicalPlanId = await page.locator("#fullpage-kh-version-select").inputValue();
  expect(historicalPlanId).toBeTruthy();

  await page.locator("#btn-edit-kehoach-fullpage").click();
  await expect(page.locator("#modal-kehoach.active")).toBeVisible();
  await page.locator("#kh-thoigiandang").fill(clock.dateTime(-30, "08:00"));
  await page.locator("#form-kehoach button[type='submit']").click();
  await expect(page.locator("#modal-plan-breakdown.active")).toBeVisible();
  const versionResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/versioning/aggregate"
  ));
  await savePlanBreakdown(page);
  const versionResponse = await versionResponsePromise;
  expect(versionResponse.ok(), await versionResponse.text().catch(() => "")).toBe(true);
  const versionCommand = versionResponse.request().postDataJSON();
  expect(versionCommand.kind).toBe("plan");
  expect(String(versionCommand.sourceId)).toBe(String(historicalPlanId));

  await gotoReady(page, "/ke-hoach");
  await page.locator("#search-kehoach").fill(planCode);
  const latestRow = page.locator("#kehoach-table tbody tr").filter({ hasText: planCode }).first();
  await expect(latestRow).toBeVisible();
  await latestRow.locator('[data-bf-action="show-plan"]').click();
  await expect(page.locator("#fullpage-kh-version-select")).toBeAttached();
  const versions = await page.locator("#fullpage-kh-version-select").evaluate((element) => ({
    selected: element.value,
    options: [...element.options].map((option) => ({ value: option.value, text: option.textContent.trim() })),
  }));
  expect(versions.options).toHaveLength(2);
  const historical = versions.options.find((option) => option.value !== versions.selected);
  expect(historical?.value).toBeTruthy();
  expect(historical.value).toBe(historicalPlanId);
  expect(versions.selected).not.toBe(historicalPlanId);
  return { historicalPlanId: historical.value, latestPlanId: versions.selected };
}

async function openLatestPackageForEdit(page, packageCode) {
  await gotoReady(page, "/goi-thau");
  const row = await searchPackageRow(page, packageCode);
  await row.locator('[data-bf-action="edit-package"]').click();
  const editor = page.locator('#modal-goithau.active[data-editor-state="ready"]');
  await expect(editor).toBeVisible();
  await expect(page.locator('#form-goithau[data-submit-state="ready"]')).toBeVisible();
  const packageId = await page.locator("#form-goithau-id").inputValue();
  return packageId;
}

async function createPackageVersion01(page, {
  sourcePackageId, planId, packageCode, packageName,
}) {
  const source = (await readServerRows(page, { table: "goithau" }))
    .find((row) => String(row.id) === String(sourcePackageId));
  expect(Number.isInteger(source?.rowVersion)).toBe(true);
  const responseBody = await page.evaluate(async (command) => {
    const csrfToken = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("csrf_token="))
      ?.slice("csrf_token=".length) || "";
    const response = await fetch("/api/versioning/aggregate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": command.clientMutationId,
        ...(csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {}),
      },
      body: JSON.stringify(command),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`aggregate version failed: ${response.status} ${JSON.stringify(body)}`);
    return body;
  }, {
    kind: "package",
    sourceId: sourcePackageId,
    expectedRowVersion: source.rowVersion,
    changes: { tenGoiThau: packageName },
    clientMutationId: `e2e-package-version-${crypto.randomUUID()}`,
  });
  const createdPackageId = (responseBody.rowVersions || []).find((entry) => (
    ["goithau", "goi_thau"].includes(entry.table)
      && String(entry.id) !== String(sourcePackageId)
  ))?.id || "";
  expect(createdPackageId).toBeTruthy();
  await gotoReady(page, "/goi-thau");
  await searchPackageRow(page, packageCode);
  const latest = (await readServerRows(page, {
    table: "goithau",
    filters: { keHoachId: planId },
  })).find((row) => String(row.id) === String(createdPackageId));
  return {
    authoritative: true,
    id: latest?.id || createdPackageId,
    rootId: latest?.rootId || latest?.id || "",
    version: latest?.phienBan ?? "",
  };
}

async function confirmDeleteAll(page) {
  const dialog = page.locator("#modal-custom-dialog.active");
  await expect(dialog).toBeVisible();
  if (await page.locator("#btn-dialog-opt2").count()) {
    await page.locator("#btn-dialog-opt2").click();
  } else {
    await page.locator("#btn-dialog-ok").click();
  }
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

async function readServerRows(page, { table, filters = {} }) {
  return page.evaluate(async ({ tableName, queryFilters }) => {
    const rows = [];
    const seenCursors = new Set();
    let cursor = "";
    do {
      if (seenCursors.has(cursor)) throw new Error(`pagination cursor repeated for ${tableName}`);
      seenCursors.add(cursor);
      const query = new URLSearchParams({
        table: tableName,
        pageSize: "200",
        pagination: "cursor",
        sortBy: "id",
        sortOrder: "asc",
        ...queryFilters,
      });
      if (cursor) query.set("cursor", cursor);
      let response = null;
      let transportError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await fetch(`/api/paginate?${query}`);
          transportError = null;
          break;
        } catch (error) {
          transportError = error;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
          }
        }
      }
      if (!response) throw transportError || new Error(`${tableName} cleanup request failed`);
      if (!response.ok) {
        throw new Error(`${tableName} cleanup pagination failed: ${response.status}`);
      }
      const body = await response.json();
      rows.push(...(body.items || []));
      const nextCursor = String(body.nextCursor || "");
      if (!body.hasMore || !nextCursor) break;
      cursor = nextCursor;
    } while (true);
    return rows;
  }, { tableName: table, queryFilters: filters });
}

async function readServerRecords(page, { table, field, value = null }) {
  return (await readServerRows(page, { table })).flatMap((row) => {
    const fieldValue = String(row?.[field] || "");
    return value === null || fieldValue.toLowerCase() === String(value).toLowerCase()
      ? [{ id: row.id, rowVersion: row.rowVersion, value: fieldValue }]
      : [];
  });
}

async function deleteSearchedEntity(page, {
  route, searchSelector, tableSelector, expectedText, table, exactField,
}) {
  // This scenario intentionally creates a durable conflict draft. Cleanup must
  // remain operable while the sync pill advertises that expected conflict.
  await gotoCleanupReady(page, route);
  const before = await readServerRecords(page, { table, field: exactField, value: expectedText });
  if (before.length === 0) return { alreadyAbsent: true };
  await page.locator(searchSelector).fill(expectedText);
  const row = page.locator(`${tableSelector} tbody tr`).filter({ hasText: expectedText }).first();
  await expect(row, `${table}:${expectedText} exists on the server but is missing from cleanup UI`).toBeVisible();
  await row.locator('[data-bf-action^="delete-"]').click();
  await confirmDeleteAll(page);
  await expect.poll(
    async () => (await readServerRecords(page, {
      table,
      field: exactField,
      value: expectedText,
    })).length,
    { timeout: 30_000, message: `${table}:${expectedText} remained after cleanup` },
  ).toBe(0);
  return { deleted: before.length };
}

function cleanupTargetsForSuffix(suffix) {
  return [
    {
      route: "/goi-thau", searchSelector: "#search-goithau",
      tableSelector: "#goithau-table", expectedText: `F5-${suffix}-GT`,
      table: "goithau", exactField: "maGoiThau",
    },
    {
      route: "/ke-hoach", searchSelector: "#search-kehoach",
      tableSelector: "#kehoach-table", expectedText: `F5-${suffix}-KH`,
      table: "kehoach", exactField: "maKeHoach",
    },
    {
      route: "/chuyen-gia", searchSelector: "#search-chuyengia",
      tableSelector: "#chuyengia-table", expectedText: `Chuyên gia thêm F5 ${suffix}`,
      table: "chuyengia", exactField: "hoTen",
    },
    {
      route: "/chuyen-gia", searchSelector: "#search-chuyengia",
      tableSelector: "#chuyengia-table", expectedText: `Chuyên gia nền F5 ${suffix}`,
      table: "chuyengia", exactField: "hoTen",
    },
    {
      route: "/chu-dau-tu", searchSelector: "#search-chudautu",
      tableSelector: "#chudautu-table", expectedText: `F5-${suffix}-CDT`,
      table: "chudautu", exactField: "maChuDauTu",
    },
  ];
}

async function cleanupCreatedEntities(page, targets) {
  const failures = [];
  for (const target of targets) {
    // Each delete can finish with a late route restoration from the modal that
    // owned it. Retire that document after the target is verified so it cannot
    // interrupt navigation for the next, unrelated cleanup target.
    const targetPage = await page.context().newPage();
    try {
      await deleteSearchedEntity(targetPage, target);
    } catch (error) {
      failures.push(new Error(
        `${target.table}:${target.expectedText}: ${error?.message || error}`,
        { cause: error },
      ));
    } finally {
      await targetPage.close().catch(() => undefined);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "E2E fixture cleanup was not complete");
  }
}

async function cleanupStaleRowConflictFixtures(page, {
  excludeSuffix,
  minimumAgeMs = 5 * 60 * 1_000,
} = {}) {
  await gotoReady(page, "/chu-dau-tu");
  const owners = await readServerRecords(page, {
    table: "chudautu",
    field: "maChuDauTu",
  });
  const staleSuffixes = owners.flatMap((owner) => {
    const match = /^F5-(\d+)-(chromium|firefox|webkit)-CDT$/.exec(owner.value);
    if (!match) return [];
    const suffix = `${match[1]}-${match[2]}`;
    const age = Date.now() - Number(match[1]);
    return suffix !== excludeSuffix && age >= minimumAgeMs ? [suffix] : [];
  });
  for (const suffix of [...new Set(staleSuffixes)]) {
    await cleanupCreatedEntities(page, cleanupTargetsForSuffix(suffix));
  }
  return staleSuffixes.length;
}

test("plan 01 breakdown is one commit, historical stays view-only, and real package conflict reloads server state", async ({ browser }) => {
  // Contexts provide the required client/storage isolation. Reuse the project
  // browser process so Firefox does not run two traced browser runtimes in the
  // same single-worker job after the preceding matrix scenarios.
  const contextA = await browser.newContext({ serviceWorkers: "block" });
  await isolateHostInjectedScripts(contextA);
  await contextA.routeWebSocket("**/ws/sync", async (webSocket) => {
    await webSocket.close({ code: 1000, reason: "Deterministic conflict test isolation" });
  });
  const pageA = await contextA.newPage();
  let contextB = null;
  let pageB = null;
  const suffix = `${Date.now()}-${test.info().project.name}`;
  const ownerCode = `F5-${suffix}-CDT`;
  const ownerName = `Chủ đầu tư F5 ${suffix}`;
  const baselineExpertName = `Chuyên gia nền F5 ${suffix}`;
  const expertName = `Chuyên gia thêm F5 ${suffix}`;
  const planCode = `F5-${suffix}-KH`;
  const planName00 = `Kế hoạch F5 ${suffix}`;
  const planName01 = `Kế hoạch F5 01 ${suffix}`;
  const packageCode = `F5-${suffix}-GT`;
  const packageName00 = `Gói F5 00 ${suffix}`;
  const packageName01 = `Gói F5 01 ${suffix}`;
  const packageNameB = `Gói F5 Server B ${suffix}`;
  let cleanupEnabled = false;

  try {
    await login(pageA);
    await cleanupStaleRowConflictFixtures(pageA, { excludeSuffix: suffix });
    await createOwner(pageA, { code: ownerCode, name: ownerName });
    cleanupEnabled = true;
    await createExpert(pageA, { name: baselineExpertName, suffix: `${suffix}-BASE` });
    await createExpert(pageA, { name: expertName, suffix: `${suffix}-ADD` });
    await createPlan00(pageA, { code: planCode, name: planName00, ownerName });
    await createPackage00(pageA, {
      code: packageCode,
      name: packageName00,
      planName: planName00,
      baselineExpertName,
      appraisalExpertName: expertName,
    });

    const { historicalPlanId, latestPlanId } = await createPlan01(pageA, { planCode });
    const planSnapshot = await pageA.evaluate(async ({ oldPlanId, newPlanId, packageCode: code }) => {
      const readPackages = async (planId) => {
        const query = new URLSearchParams({ table: "goithau", pageSize: "500", keHoachId: planId });
        const response = await fetch(`/api/paginate?${query}`);
        if (!response.ok) throw new Error(`package pagination failed: ${response.status}`);
        const body = await response.json();
        return (body.items || []).filter((row) => (
          String(row.maGoiThau || "").toLowerCase() === String(code).toLowerCase()
        ));
      };
      const [historicalPackages, latestPackages] = await Promise.all([
        readPackages(oldPlanId),
        readPackages(newPlanId),
      ]);
      return {
        historicalPackageId: historicalPackages[0]?.id || "",
        latestPackageId: latestPackages.find((row) => row.isLatest == 1)?.id || "",
      };
    }, { oldPlanId: historicalPlanId, newPlanId: latestPlanId, packageCode });
    expect(planSnapshot.historicalPackageId).toBeTruthy();
    expect(planSnapshot.latestPackageId).toBeTruthy();
    expect(planSnapshot.latestPackageId).not.toBe(planSnapshot.historicalPackageId);

    await pageA.locator("#btn-edit-kehoach-fullpage").click();
    await expect(pageA.locator("#modal-kehoach.active")).toBeVisible();
    await pageA.locator("#kh-ten").fill(planName01);
    await pageA.locator("#form-kehoach button[type='submit']").click();
    await expect(pageA.locator("#modal-plan-breakdown.active")).toBeVisible();
    await pageA.locator('[data-breakdown-tab="goithau"]').click();
    const breakdownRow = pageA.locator("#tbody-breakdown-goithau tr").filter({ hasText: packageCode }).first();
    await expect(breakdownRow).toBeVisible();
    await breakdownRow.locator('[data-bf-action="edit-package"]').click();
    await expect(pageA.locator("#modal-goithau.active")).toBeVisible();
    await pageA.locator("#gt-ten").fill(packageName01);
    const expertRow = pageA.locator("#to-chuyengia-tbody tr").filter({ hasText: expertName }).first();
    await expect(expertRow).toHaveCount(1);
    await checkMountedCheckbox(expertRow.locator('input[name="tochuyengia-select"]'));
    const draftPackageId = await pageA.locator("#form-goithau-id").inputValue();
    expect(draftPackageId).toBeTruthy();

    let captureBreakdownSync = true;
    const breakdownSyncRequests = [];
    pageA.on("request", (request) => {
      if (!captureBreakdownSync) return;
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/sync") {
        breakdownSyncRequests.push(request);
      }
    });
    await pageA.locator("#form-goithau button[type='submit']").click();
    await expect(pageA.locator("#modal-goithau")).toHaveAttribute(
      "data-editor-state",
      "closed",
    );
    await expect(pageA.locator("#modal-goithau.active")).toBeHidden();
    await expect(pageA.locator("#modal-plan-breakdown.active")).toBeVisible();
    expect(breakdownSyncRequests, "package/expert assignment save must remain memory-only").toHaveLength(0);

    const draftPackage = {
      id: draftPackageId,
      rootId: draftPackageId,
      version: "00",
    };
    expect(draftPackage.id).toBeTruthy();
    expect(draftPackage.id).toBe(planSnapshot.latestPackageId);
    expect(Number.parseInt(draftPackage.version, 10)).toBe(0);

    const planCommitPromise = pageA.waitForResponse((response) => (
      response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/sync"
    ));
    await pageA.locator("#btn-save-plan-breakdown").click();
    const planCommitResponse = await planCommitPromise;
    expect(planCommitResponse.ok(), await planCommitResponse.text().catch(() => "")).toBe(true);
    await expect(pageA.locator("#modal-plan-breakdown.active")).toBeHidden({ timeout: 30_000 });
    captureBreakdownSync = false;
    expect(breakdownSyncRequests, "plan breakdown must emit one logical /api/sync commit").toHaveLength(1);
    const planCommitPayload = breakdownSyncRequests[0].postDataJSON();
    const committedPlanIds = (planCommitPayload.kehoach || []).map((row) => String(row.id));
    const committedPackageIds = (planCommitPayload.goithau || []).map((row) => String(row.id));
    expect(committedPlanIds).toContain(String(latestPlanId));
    expect(committedPlanIds).not.toContain(String(historicalPlanId));
    expect(committedPackageIds).toContain(String(draftPackage.id));
    expect(committedPackageIds).not.toContain(String(planSnapshot.historicalPackageId));
    const committedDraftPackage = (planCommitPayload.goithau || [])
      .find((row) => String(row.id) === String(draftPackage.id));
    expect(committedDraftPackage?.tenGoiThau).toBe(packageName01);
    expect((committedDraftPackage?.toChuyenGia || []).some((row) => (
      String(row?.chuyenGiaId || "")
        && String(row?.chuyenGiaId || "") !== String((committedDraftPackage?.toChuyenGia || [])[0]?.chuyenGiaId || "")
    ))).toBe(true);
    expect((planCommitPayload.assignments || []).filter((row) => (
      row.type === "goithau" && String(row.targetId) === String(draftPackage.id)
    ))).toHaveLength(0);
    const planCommitBody = await planCommitResponse.json();
    const committedPackageVersion = (planCommitBody.rowVersions || []).find((entry) => (
      entry.table === "goithau" && String(entry.id) === String(draftPackage.id)
    ))?.rowVersion;
    expect(Number.isInteger(committedPackageVersion)).toBe(true);
    await dismissOptionalDialog(pageA);
    await expect.poll(async () => (
      (await readServerRows(pageA, { table: "goithau" }))
        .find((row) => String(row.id) === String(draftPackage.id))?.rowVersion
    )).toBe(committedPackageVersion);
    const latestPackage = await createPackageVersion01(pageA, {
      sourcePackageId: draftPackage.id,
      planId: latestPlanId,
      packageCode,
      packageName: packageName01,
    });
    expect(latestPackage.authoritative).toBe(true);
    expect(latestPackage.id).toBeTruthy();
    expect(latestPackage.id).not.toBe(draftPackage.id);
    expect(Number.parseInt(latestPackage.version, 10)).toBe(1);

    await gotoReady(pageA, "/goi-thau");
    let packageRow = await searchPackageRow(pageA, packageCode);
    await expect(packageRow).toContainText(packageName01);
    await expect(packageRow.locator('[data-bf-action="edit-package"]')).toHaveCount(1);
    await expect(packageRow.locator('[data-bf-action="delete-package"]')).toHaveCount(1);
    const versionSelect = packageRow.locator('select[data-bf-change="change-package-version"]');
    await expect(versionSelect.locator("option")).toHaveCount(2);
    await selectVisibleVersion(packageRow, "00");
    packageRow = pageA.locator("#goithau-table tbody tr").filter({ hasText: packageCode }).first();
    await expect(packageRow.locator('[data-bf-action="edit-package"]')).toHaveCount(0);
    await expect(packageRow.locator('[data-bf-action="delete-package"]')).toHaveCount(0);
    await expect(packageRow.locator('.action-btn[data-bf-action="show-package"]')).toHaveCount(1);
    await selectVisibleVersion(packageRow, "01");
    packageRow = pageA.locator("#goithau-table tbody tr").filter({ hasText: packageCode }).first();
    await expect(packageRow.locator('[data-bf-action="edit-package"]')).toHaveCount(1);
    await expect(packageRow.locator('[data-bf-action="delete-package"]')).toHaveCount(1);

    await pageA.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(pageA);
    await waitForInitialReconciliation(pageA);
    packageRow = await searchPackageRow(pageA, packageCode);
    await expect(packageRow.locator('select[data-bf-change="change-package-version"]')).toHaveValue(latestPackage.id);
    await expect(packageRow.locator('[data-bf-action="edit-package"]')).toHaveCount(1);
    await expect(packageRow.locator('[data-bf-action="delete-package"]')).toHaveCount(1);

    contextB = await browser.newContext({
      serviceWorkers: "block",
      storageState: await contextA.storageState(),
    });
    await isolateHostInjectedScripts(contextB);
    pageB = await contextB.newPage();
    const packageIdA = await openLatestPackageForEdit(pageA, packageCode);
    const packageIdB = await openLatestPackageForEdit(pageB, packageCode);
    expect(packageIdA).toBe(latestPackage.id);
    expect(packageIdB).toBe(latestPackage.id);
    await pageA.route("**/api/sync/delta**", (route) => route.abort());

    await pageB.locator("#gt-ten").fill(packageNameB);
    const clientBResponsePromise = pageB.waitForResponse((response) => (
      response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/sync"
        && response.ok()
        && (response.request().postDataJSON()?.goithau || []).some((row) => (
          String(row.id) === String(latestPackage.id) && row.tenGoiThau === packageNameB
        ))
    ));
    await pageB.locator("#form-goithau button[type='submit']").click();
    const clientBResponse = await clientBResponsePromise;
    const clientBBody = await clientBResponse.json();
    expect((clientBBody.rowVersions || []).some((entry) => (
      entry.table === "goithau" && String(entry.id) === String(latestPackage.id)
    ))).toBe(true);
    await expect(pageB.locator("#modal-goithau")).toHaveAttribute(
      "data-editor-state",
      "closed",
    );
    await expect(pageB.locator("#modal-goithau.active")).toBeHidden();

    await pageA.locator("#gt-nguonvon").fill("Nguồn vốn Local A");
    const conflictResponsePromise = pageA.waitForResponse((response) => (
      response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/sync"
        && response.status() === 409
        && (response.request().postDataJSON()?.goithau || []).some((row) => (
          String(row.id) === String(latestPackage.id) && row.nguonVon === "Nguồn vốn Local A"
        ))
    ));
    await pageA.locator("#form-goithau button[type='submit']").click();
    const conflictResponse = await conflictResponsePromise;
    const conflictBody = await conflictResponse.json();
    expect(conflictBody.errors.some((error) => (
      error.code === "ROW_VERSION_CONFLICT"
        && ["goithau", "goi_thau"].includes(error.table)
        && String(error.id) === String(latestPackage.id)
    ))).toBe(true);
    await expect(pageA.locator("#modal-goithau.active")).toBeVisible();
    await expect(pageA.locator('#form-goithau[data-submit-state="ready"]')).toBeVisible();
    await expect(pageA.locator("#form-goithau button[type='submit']")).toBeEnabled();
    await expect(pageA.locator("#modal-custom-dialog.active")).toHaveCount(0);
    await expect(pageA.locator(".bf-toast").filter({ hasText: "Nhấn F5" }).last()).toBeVisible();

    await pageA.unroute("**/api/sync/delta**");
    await pageA.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(pageA);
    await waitForInitialReconciliation(pageA);
    await expect(pageA.locator("#modal-custom-dialog.active")).toHaveCount(0);
    await gotoReady(pageA, "/goi-thau");
    packageRow = await searchPackageRow(pageA, packageCode);
    await expect(packageRow).toContainText(packageNameB);
    await expect(packageRow.locator('[data-bf-action="edit-package"]')).toHaveCount(1);
    await expect(packageRow.locator('[data-bf-action="delete-package"]')).toHaveCount(1);
    await expect(packageRow.locator('select[data-bf-change="change-package-version"]'))
      .toHaveValue(latestPackage.id);
    await expect(pageA.locator("#modal-custom-dialog.active")).toHaveCount(0);
  } finally {
    let cleanupFailure = null;
    await contextB?.close().catch(() => undefined);
    contextB = null;
    if (cleanupEnabled) {
      const cleanupPage = await contextA.newPage();
      try {
        await cleanupCreatedEntities(cleanupPage, cleanupTargetsForSuffix(suffix));
      } catch (error) {
        cleanupFailure = error;
      } finally {
        await cleanupPage.close().catch(() => undefined);
      }
    }
    await contextA.close().catch(() => undefined);
    if (cleanupFailure) throw cleanupFailure;
  }
});
