const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!password) throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");

const sheetModule = { exports: {} };
const sheetExports = sheetModule.exports;
const sheetRuntime = fs.readFileSync(
  path.join(root, "views", "vendor", "xlsx", "xlsx.full.min.js"),
  "utf8",
);
Function("module", "exports", "require", sheetRuntime)(sheetModule, sheetExports, require);
const XLSX = Object.keys(sheetModule.exports).length ? sheetModule.exports : sheetExports;

const workbookDirectory = String(
  process.env.BIDDER_GOODS_E2E_WORKBOOK_DIR || "C:\\Users\\newst\\OneDrive - 79401",
);
const workbookCases = [
  {
    key: "no-lot",
    filename: "Dự thầu không phân lô.xlsx",
    hasLots: false,
  },
  {
    key: "lot-one-item",
    filename: "Dự thầu 1 phân lô 1 mặt hàng.xlsx",
    hasLots: true,
  },
  {
    key: "lot-many-items",
    filename: "Dự thầu 1 phân lô nhiều mặt hàng.xlsx",
    hasLots: true,
  },
];

const runId = `bg-e2e-${Date.now()}`;
const organizationId = `__${runId}-org`;
const result = { runId, steps: [] };
const mark = (step, details = {}) => {
  result.steps.push({ step, ...details });
  process.stdout.write(`[BIDDER-GOODS-E2E] ${step}\n`);
};

function runFixture(action, payload) {
  const execution = spawnSync(
    process.env.PYTHON || "python",
    [path.join(root, "scripts", "bidder_goods_e2e_fixture.py"), action],
    {
      cwd: root,
      env: process.env,
      input: JSON.stringify(payload),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (execution.status !== 0) {
    throw new Error(
      `Fixture ${action} failed (${execution.status}): ${execution.stderr || execution.stdout}`,
    );
  }
  return JSON.parse(execution.stdout || "{}");
}

function workbookSheets(filePath) {
  const workbook = XLSX.read(fs.readFileSync(filePath), {
    type: "buffer",
    cellDates: false,
  });
  return workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    }),
  }));
}

async function parseWorkbookCase(definition, packageId, parser) {
  const filePath = path.join(workbookDirectory, definition.filename);
  if (!fs.existsSync(filePath)) throw new Error(`Missing workbook: ${filePath}`);
  const sheets = workbookSheets(filePath);
  const sheet = parser.findBidderGoodsSheet(sheets);
  if (!sheet) throw new Error(`${definition.filename}: Sheet 12.1 was not found`);
  let lots = [];
  if (definition.hasLots) {
    const header = parser.findBidderGoodsHeader(sheet.rows, { requireLots: true });
    if (!header) throw new Error(`${definition.filename}: lot header was not found`);
    const codeIndex = header.fieldByColumn.get("maPhanLoNguon");
    const nameIndex = header.fieldByColumn.get("tenPhanLoNguon");
    const seen = new Set();
    for (const row of sheet.rows.slice(header.rowIndex + 1)) {
      const code = String(row?.[codeIndex] || "").trim();
      const name = String(row?.[nameIndex] || "").trim();
      const key = `${code}\u0000${name}`;
      if ((!code && !name) || seen.has(key)) continue;
      seen.add(key);
      lots.push({
        id: `${packageId}-lot-${lots.length + 1}`,
        maPhanLo: code,
        tenPhanLo: name,
      });
    }
  }
  const parsed = parser.parseBidderGoodsWorkbookSheets(sheets, {
    pkg: {
      linhVuc: "Hàng hóa",
      phanLo: definition.hasLots ? "Có" : "Không",
      phanLoList: lots,
    },
  });
  if (parsed.errors.length) {
    throw new Error(`${definition.filename}: ${JSON.stringify(parsed.errors)}`);
  }
  const unresolvedLots = parsed.rows.filter(
    (row) => definition.hasLots && !row.phanLoId,
  );
  if (unresolvedLots.length) {
    throw new Error(`${definition.filename}: ${unresolvedLots.length} unresolved lot rows`);
  }
  const totalByLot = new Map();
  for (const row of parsed.rows) {
    const key = String(row.phanLoId || "");
    totalByLot.set(key, (totalByLot.get(key) || 0) + Number(row.thanhTienDuThau || 0));
  }
  lots = lots.map((lot, index) => ({
    id: lot.id,
    code: lot.maPhanLo,
    name: lot.tenPhanLo,
    order: index,
    price: totalByLot.get(lot.id) || 0,
  }));
  const openingByLot = new Map();
  if (definition.hasLots) {
    lots.forEach((lot, index) => {
      openingByLot.set(lot.id, {
        id: `${packageId}-opening-${index + 1}`,
        lotCode: lot.code,
        lotName: lot.name,
        bidPrice: totalByLot.get(lot.id) || 0,
      });
    });
  } else {
    openingByLot.set("", {
      id: `${packageId}-opening-1`,
      lotCode: "",
      lotName: "",
      bidPrice: totalByLot.get("") || 0,
    });
  }
  const total = parsed.rows.reduce(
    (sum, row) => sum + Number(row.thanhTienDuThau || 0),
    0,
  );
  return {
    definition,
    filePath,
    parsed,
    lots,
    requirements: parsed.rows.map((row, index) => ({
      id: `${packageId}-requirement-${index + 1}`,
      lotId: row.phanLoId || null,
      code: `${definition.key.toUpperCase()}-${index + 1}`,
      name: row.danhMucHangHoa,
      unit: row.donViTinh,
      quantity: row.khoiLuong,
      order: index,
    })),
    openings: [...openingByLot.values()],
    total,
  };
}

function packageFixture(parsedCase, suffix, { twoEnvelope = false } = {}) {
  const packageId = `${runId}-${suffix}`;
  const remapLotId = new Map(
    parsedCase.lots.map((lot, index) => [lot.id, `${packageId}-lot-${index + 1}`]),
  );
  const lots = parsedCase.lots.map((lot, index) => ({
    ...lot,
    id: `${packageId}-lot-${index + 1}`,
  }));
  const openings = parsedCase.openings.map((opening, index) => ({
    ...opening,
    id: `${packageId}-opening-${index + 1}`,
  }));
  return {
    id: packageId,
    code: `${runId.toUpperCase()}-${suffix.toUpperCase()}`,
    name: `${twoEnvelope ? "Gói 1G2T" : "Gói 1G1T"} ${parsedCase.definition.key} ${runId}`,
    method: twoEnvelope
      ? "Một giai đoạn hai túi hồ sơ"
      : "Một giai đoạn một túi hồ sơ",
    twoEnvelope,
    packagePrice: parsedCase.total,
    lots,
    requirements: parsedCase.requirements.map((requirement, index) => ({
      ...requirement,
      id: `${packageId}-requirement-${index + 1}`,
      lotId: requirement.lotId ? remapLotId.get(requirement.lotId) : null,
    })),
    openings,
    expectedCount: parsedCase.parsed.rows.length,
    expectedTotal: parsedCase.total,
    filePath: parsedCase.filePath,
  };
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

async function waitForSuccessToast(page, expectedText) {
  const toast = page.locator(".bf-toast.toast-success")
    .filter({ hasText: expectedText })
    .last();
  try {
    await toast.waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.textContent?.trim()),
      previewVisible: Boolean(document.querySelector(".bidder-goods-preview")),
      previewStored: Boolean(document.querySelector("#btn-bidder-goods-preview-confirm")),
      bidderGoodsRows: document.querySelectorAll("[data-bidder-goods-id]").length,
      activeDialogTitle: document.querySelector("#modal-custom-dialog.active #dialog-title")?.textContent?.trim() || "",
    }));
    throw new Error(
      `Missing success toast ${JSON.stringify(expectedText)}: ${JSON.stringify(diagnostics)}; ${error.message}`,
    );
  }
  const text = (await toast.innerText()).trim();
  const className = await toast.getAttribute("class");
  if (!className?.includes("toast-success") || !text.includes(expectedText)) {
    throw new Error(`Unexpected feedback toast: ${JSON.stringify({ className, text, expectedText })}`);
  }
  await page.waitForTimeout(1_900);
  return text;
}

async function loginAndSelectWorkspace(page, targetOrganizationId) {
  await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.waitForFunction(() => (
    getComputedStyle(document.getElementById("auth-overlay")).display === "none"
  ), null, { timeout: 20_000 });
  const roleResult = await page.evaluate(async (orgId) => {
    localStorage.setItem("bf_active_org", orgId);
    sessionStorage.setItem("bf_active_org", orgId);
    const csrfToken = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("csrf_token="))
      ?.slice("csrf_token=".length) || "";
    const response = await fetch("/api/auth/active-role", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Active-Org": encodeURIComponent(orgId),
        "X-CSRF-Token": decodeURIComponent(csrfToken),
      },
      body: JSON.stringify({ active_role: "manager" }),
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }, targetOrganizationId);
  if (!roleResult.ok) {
    throw new Error(`Cannot activate manager role: ${JSON.stringify(roleResult)}`);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.getByText("Chế độ: Quản lý", { exact: true }).waitFor({ state: "visible" });
}

async function openPackageEvaluation(page, packageData, workflowTab) {
  const response = await page.goto(
    `${baseURL}/goi-thau`,
    { waitUntil: "domcontentloaded" },
  );
  if (!response?.ok()) {
    throw new Error(`${packageData.code}: package route returned ${response?.status()}`);
  }
  await waitForApp(page);
  const search = page.locator("#search-goithau");
  await search.waitFor({ state: "visible", timeout: 20_000 });
  await search.fill(packageData.code);
  const packageLink = page
    .locator('#goithau-table a[data-bf-action="show-package"]')
    .filter({ hasText: packageData.code });
  try {
    await packageLink.waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(async (packageCode) => {
      const response = await fetch(
        `/api/paginate?table=goithau&page=1&pageSize=10&search=${encodeURIComponent(packageCode)}`,
        { credentials: "same-origin" },
      );
      return {
        url: location.href,
        activeOrgLocal: localStorage.getItem("bf_active_org"),
        activeOrgSession: sessionStorage.getItem("bf_active_org"),
        filters: {
          status: document.getElementById("filter-goithau-trangthai")?.value || "",
          method: document.getElementById("filter-goithau-hinhthuc")?.value || "",
          year: document.getElementById("filter-goithau-nam")?.value || "",
          month: document.getElementById("filter-goithau-thang")?.value || "",
        },
        tableText: document.querySelector("#goithau-table tbody")?.textContent?.trim() || "",
        links: [...document.querySelectorAll('#goithau-table [data-bf-action="show-package"]')]
          .map((item) => ({ text: item.textContent?.trim() || "", id: item.dataset.id || "" })),
        paginateStatus: response.status,
        paginateBody: await response.text(),
      };
    }, packageData.code);
    throw new Error(
      `${packageData.code}: package link was not visible: ${JSON.stringify(diagnostics)}; ${error.message}`,
    );
  }
  await packageLink.click();
  await page.locator("#detail-workflow-title").filter({ hasText: packageData.name }).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  const tab = page.locator(`[data-workflow-tab="${workflowTab}"]`);
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await tab.click();
  await page.locator("#btn-danhgiahsdt-detail").waitFor({ state: "visible", timeout: 20_000 });
}

async function openBidderGoodsDetail(page) {
  await page.locator("#btn-danhgiahsdt-detail").click();
  const goodsTab = page.locator('[data-detailed-evaluation-group="bidder_goods"]');
  await goodsTab.waitFor({ state: "visible", timeout: 20_000 });
  await goodsTab.click();
  await page.locator(".bidder-goods-panel").waitFor({ state: "visible", timeout: 20_000 });
}

async function saveCurrentScopeOfficial(page) {
  const saveButton = page.locator("#btn-bidder-goods-save-official");
  await saveButton.waitFor({ state: "visible", timeout: 20_000 });
  const syncResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/sync"
  ), { timeout: 20_000 });
  await saveButton.click();
  const syncResponse = await syncResponsePromise;
  if (!syncResponse.ok()) {
    throw new Error(`Official bidder-goods sync failed: ${syncResponse.status()} ${await syncResponse.text()}`);
  }
  const savedState = page.locator(".bidder-goods-operation-state.text-success")
    .filter({ hasText: "Đã lưu lúc" });
  await savedState.waitFor({ state: "visible", timeout: 20_000 });
}

async function acceptPendingDialog(page) {
  const modal = page.locator("#modal-custom-dialog.active");
  if (!await modal.isVisible()) return null;
  const title = (await page.locator("#dialog-title").innerText()).trim();
  const message = (await page.locator("#dialog-message").innerText()).trim();
  await page.locator("#btn-dialog-ok").click();
  await modal.waitFor({ state: "hidden", timeout: 20_000 });
  await page.waitForTimeout(100);
  return { title, message };
}

async function importAndPersist(page, packageData, workflowTab) {
  await openPackageEvaluation(page, packageData, workflowTab);
  const summary = page.locator("#danhgiahsdt-summary-view");
  if (await summary.locator('[data-detailed-evaluation-group="bidder_goods"]').count()) {
    throw new Error(`${packageData.code}: bidder goods leaked into the general report`);
  }
  await openBidderGoodsDetail(page);
  const fileInput = page.locator("#bidder-goods-excel-input");
  await fileInput.setInputFiles(packageData.filePath);
  const preview = page.locator(".bidder-goods-preview");
  await preview.waitFor({ state: "visible", timeout: 30_000 }).catch(async (error) => {
    const diagnostics = await page.evaluate(() => ({
      dialogTitle: document.querySelector("#modal-custom-dialog.active #dialog-title")?.textContent?.trim() || "",
      dialogMessage: document.querySelector("#modal-custom-dialog.active #dialog-message")?.textContent?.trim() || "",
      operationState: document.querySelector(".bidder-goods-operation-state")?.textContent?.trim() || "",
      panelText: document.querySelector(".bidder-goods-panel")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 800) || "",
      loadingTitle: document.querySelector("#excel-import-loading-title")?.textContent?.trim() || "",
      loadingMessage: document.querySelector("#excel-import-loading-message")?.textContent?.trim() || "",
    }));
    throw new Error(`${packageData.code}: bidder-goods preview did not render: ${JSON.stringify(diagnostics)}; ${error.message}`);
  });
  const previewCount = await preview.locator("tbody tr").count();
  if (previewCount !== packageData.expectedCount) {
    throw new Error(
      `${packageData.code}: preview ${previewCount}, expected ${packageData.expectedCount}`,
    );
  }
  const previewText = await preview.innerText();
  if (!previewText.includes("0 lỗi/cảnh báo")) {
    throw new Error(`${packageData.code}: preview contains errors: ${previewText}`);
  }
  await page.locator("#btn-bidder-goods-preview-confirm").click();
  await waitForSuccessToast(page, "Nhập dữ liệu thành công");

  const bidSelect = page.locator("#detailed-evaluation-bid-select");
  const bidValues = await bidSelect.locator("option").evaluateAll((options) => (
    options.map((option) => option.value).filter(Boolean)
  ));
  await saveCurrentScopeOfficial(page);
  const firstValue = await bidSelect.inputValue();
  for (const bidValue of bidValues) {
    if (bidValue === firstValue) continue;
    if (!await page.locator(".bidder-goods-panel").isVisible()) {
      await openBidderGoodsDetail(page);
    }
    const currentSelect = page.locator("#detailed-evaluation-bid-select");
    const selectState = await currentSelect.evaluate((select, targetValue) => ({
      disabled: select.disabled,
      value: select.value,
      options: [...select.options].map((option) => ({
        value: option.value,
        disabled: option.disabled,
        selected: option.selected,
      })),
      targetValue,
    }), bidValue);
    if (selectState.disabled || selectState.options.find(
      (option) => option.value === bidValue,
    )?.disabled) {
      throw new Error(`${packageData.code}: bid selector is unexpectedly disabled ${JSON.stringify(selectState)}`);
    }
    await currentSelect.selectOption(bidValue, { force: true });
    await acceptPendingDialog(page);
    await page.locator(".bidder-goods-panel").waitFor({ state: "visible", timeout: 20_000 });
    await saveCurrentScopeOfficial(page);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator(`[data-workflow-tab="${workflowTab}"]`).click();
  await openBidderGoodsDetail(page);
  const tableHeader = await page.locator(".bidder-goods-table thead").innerText();
  for (const expectedHeader of [
    "Ưu đãi",
    "Đơn giá sau ưu đãi",
    "Thành tiền sau ưu đãi",
  ]) {
    if (!tableHeader.includes(expectedHeader)) {
      throw new Error(`${packageData.code}: missing goods column ${expectedHeader}`);
    }
  }
  try {
    await page.locator(
      '[data-detailed-evaluation-group="financial"]',
    ).waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const currentBidId = String(
        document.querySelector("#detailed-evaluation-bid-select")?.value || "",
      );
      return {
        currentBidId,
        tabs: [...document.querySelectorAll("[data-detailed-evaluation-group]")]
          .map((tab) => ({ group: tab.dataset.detailedEvaluationGroup, hidden: tab.hidden })),
        renderedRows: [...document.querySelectorAll(".bidder-goods-table tbody tr")]
          .map((row) => row.textContent?.trim() || ""),
      };
    });
    throw new Error(`${packageData.code}: financial group stayed locked after reload: ${JSON.stringify(diagnostics)}; ${error.message}`);
  }
  const persistedRowsForSelectedBid = await page.locator(
    ".bidder-goods-table tbody tr[data-bidder-goods-id]",
  ).count();
  if (!persistedRowsForSelectedBid) {
    throw new Error(`${packageData.code}: no bidder goods remained after reload`);
  }
  return {
    previewCount,
    bidScopes: bidValues.length,
    persistedRowsForSelectedBid,
    financialUnlocked: true,
  };
}

(async () => {
  const { isExpectedSyncReset, isExpectedTelemetryBackpressure } = await import("./lib/e2eHttpErrors.mjs");
  const parser = await import(pathToFileURL(
    path.join(root, "frontend", "packages", "BidderGoodsExcel.js"),
  ));
  const parsedCases = {};
  for (const definition of workbookCases) {
    parsedCases[definition.key] = await parseWorkbookCase(
      definition,
      `${runId}-${definition.key}-source`,
      parser,
    );
  }
  const packages = [
    packageFixture(parsedCases["no-lot"], "1g1t-no-lot"),
    packageFixture(parsedCases["lot-one-item"], "1g1t-lot-one-item"),
    packageFixture(parsedCases["lot-many-items"], "1g1t-lot-many-items"),
    packageFixture(parsedCases["no-lot"], "1g2t-no-lot", { twoEnvelope: true }),
    packageFixture(parsedCases["lot-many-items"], "1g2t-lot-many-items", { twoEnvelope: true }),
  ];
  const fixturePayload = {
    runId,
    organizationId,
    username,
    packages: packages.map(({ filePath, ...packageData }) => packageData),
  };
  let fixtureCreated = false;
  let browser;
  try {
    const setup = runFixture("setup", fixturePayload);
    fixtureCreated = true;
    mark("fixture-created", setup);

    const launchOptions = { headless: true };
    if (process.env.STARTUP_BROWSER_CHANNEL) {
      launchOptions.channel = process.env.STARTUP_BROWSER_CHANNEL;
    }
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
    });
    page.setDefaultTimeout(20_000);
    const pageErrors = [];
    const httpErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("response", async (response) => {
      if (
        response.status() < 400
        || !response.url().includes("/api/")
        || isExpectedTelemetryBackpressure(response)
      ) return;
      let body = "";
      try { body = await response.text(); } catch {}
      if (isExpectedSyncReset(response, body)) return;
      httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()} ${body}`);
      process.stderr.write(`[HTTP ERROR] ${httpErrors.at(-1)}\n`);
    });

    await loginAndSelectWorkspace(page, organizationId);
    mark("login-and-workspace-selected");

    const singleResults = [];
    for (const packageData of packages.filter((item) => !item.twoEnvelope)) {
      const imported = await importAndPersist(page, packageData, "eval_tech");
      singleResults.push({ code: packageData.code, ...imported });
      mark("single-envelope-workbook-persisted", { code: packageData.code, ...imported });
    }

    const financialResults = [];
    for (const twoEnvelope of packages.filter((item) => item.twoEnvelope)) {
      await openPackageEvaluation(page, twoEnvelope, "eval_tech");
      await page.locator("#btn-danhgiahsdt-detail").click();
      const technicalGoodsTabs = await page.locator(
        '[data-detailed-evaluation-group="bidder_goods"]',
      ).count();
      if (technicalGoodsTabs !== 0) {
        throw new Error(`${twoEnvelope.code}: 1G2T technical report exposes bidder goods`);
      }
      mark("two-envelope-technical-hidden", { code: twoEnvelope.code });

      const financialImported = await importAndPersist(page, twoEnvelope, "eval_fin");
      financialResults.push({ code: twoEnvelope.code, ...financialImported });
      mark("two-envelope-financial-workbook-persisted", {
        code: twoEnvelope.code,
        ...financialImported,
      });
    }

    const verified = runFixture("verify", fixturePayload);
    mark("postgres-verified", verified);

    const secondContext = await browser.newContext({
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
    });
    const secondPage = await secondContext.newPage();
    secondPage.setDefaultTimeout(20_000);
    await loginAndSelectWorkspace(secondPage, organizationId);
    const syncPackage = packages[0];
    await openPackageEvaluation(secondPage, syncPackage, "eval_tech");
    await openBidderGoodsDetail(secondPage);
    const secondContextRows = await secondPage.locator(
      ".bidder-goods-table tbody tr[data-bidder-goods-id]",
    ).count();
    if (secondContextRows !== syncPackage.expectedCount) {
      throw new Error(
        `${syncPackage.code}: second browser context loaded ${secondContextRows}, expected ${syncPackage.expectedCount}`,
      );
    }
    mark("second-browser-context-synced", {
      code: syncPackage.code,
      rows: secondContextRows,
    });
    const realtimeRow = secondPage.locator(
      ".bidder-goods-table tbody tr[data-bidder-goods-id]",
    ).first();
    await realtimeRow.locator("[data-bidder-goods-edit]").click();
    const unitPriceInput = realtimeRow.locator(
      '[data-bidder-goods-field="donGiaDuThau"]',
    );
    await unitPriceInput.fill("");
    const realtimeSnapshots = [];
    for (const digit of "11111") {
      await unitPriceInput.press(digit);
      realtimeSnapshots.push(await realtimeRow.evaluate((row) => ({
        unitPrice: row.querySelector('[data-bidder-goods-field="donGiaDuThau"]')?.value || "",
        total: row.querySelector('[data-bidder-goods-derived="thanhTienDuThau"]')?.textContent?.trim() || "",
        preferredUnitPrice: row.querySelector('[data-bidder-goods-derived="giaDuThauSauUuDai"]')?.textContent?.trim() || "",
        preferredTotal: row.querySelector('[data-bidder-goods-derived="thanhTienSauUuDai"]')?.textContent?.trim() || "",
        summaryTotal: [...document.querySelectorAll(".bidder-goods-summary-primary > div")]
          .find((item) => item.textContent?.includes("Tổng thành tiền"))?.textContent?.trim() || "",
        summaryComparison: [...document.querySelectorAll(".bidder-goods-summary-primary > div")]
          .find((item) => item.textContent?.includes("Đối chiếu giá dự thầu"))?.textContent?.trim() || "",
      })));
    }
    const expectedFormattedPrices = ["1", "11", "111", "1.111", "11.111"];
    if (JSON.stringify(realtimeSnapshots.map((item) => item.unitPrice)) !== JSON.stringify(expectedFormattedPrices)) {
      throw new Error(`Realtime unit-price formatting failed: ${JSON.stringify(realtimeSnapshots)}`);
    }
    for (const field of [
      "total", "preferredUnitPrice", "preferredTotal", "summaryTotal", "summaryComparison",
    ]) {
      const values = realtimeSnapshots.map((item) => item[field]);
      if (values.some((value) => !value || value.includes("—")) || new Set(values).size !== values.length) {
        throw new Error(`Realtime ${field} calculation failed: ${JSON.stringify(realtimeSnapshots)}`);
      }
    }
    mark("realtime-unit-price-preview", {
      code: syncPackage.code,
      snapshots: realtimeSnapshots,
    });
    await secondContext.close();
    if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
    if (httpErrors.length) throw new Error(`HTTP errors: ${httpErrors.join(" | ")}`);
    result.singleResults = singleResults;
    result.financialResults = financialResults;
    result.database = verified;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (browser) await browser.close();
    if (fixtureCreated && process.env.BIDDER_GOODS_E2E_KEEP_DATA !== "1") {
      const cleanup = runFixture("cleanup", fixturePayload);
      mark("fixture-removed", cleanup);
    }
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
