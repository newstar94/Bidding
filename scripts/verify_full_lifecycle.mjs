import process from "node:process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { chromium } from "@playwright/test";
import { createE2ETestClock } from "./e2e_test_clock.mjs";
import { isExpectedSyncReset, isExpectedTelemetryBackpressure } from "./lib/e2eHttpErrors.mjs";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const testClock = createE2ETestClock();
const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!password) throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");

const runId = `E2E-${Date.now()}`;
const runDigits = String(Date.now()).slice(-9);
const result = { runId, steps: [] };
  const pageErrors = [];
  const httpErrors = [];
const recentApiTraffic = [];
process.stdout.write(`[E2E] run ${runId}\n`);

function loadSheetJs() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    readFileSync(resolve("views", "vendor", "xlsx", "xlsx.full.min.js"), "utf8"),
    context,
    { filename: "views/vendor/xlsx/xlsx.full.min.js" },
  );
  if (!context.XLSX?.utils || !context.XLSX?.write) {
    throw new Error("Vendored SheetJS runtime is unavailable for lifecycle E2E fixtures.");
  }
  return context.XLSX;
}

function createLifecycleExcelFixtures() {
  const directory = mkdtempSync(join(tmpdir(), "biddingflow-lifecycle-e2e-"));
  const XLSX = loadSheetJs();
  const cases = {
    noLot: {
      filename: "no-lot.xlsx",
      rows: [
        ["STT", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
        ["1", "Máy tính xách tay", "Bộ", 2, 10_000_000, 20_000_000],
        ["2", "Màn hình", "Cái", 3, 5_000_000, 15_000_000],
      ],
    },
    oneLotOneItem: {
      filename: "one-lot-one-item.xlsx",
      rows: [
        ["STT", "Mã phần lô", "Tên phần lô", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
        ["1", "PP2600224818", "Lô 01", "Máy in", "Cái", 1, 8_000_000, 8_000_000],
      ],
    },
    oneLotManyItems: {
      filename: "one-lot-many-items.xlsx",
      rows: [
        ["STT", "Mã phần lô", "Tên phần lô", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
        ["1", "PL1", "Lô 1", "Máy chủ", "Bộ", 1, 50_000_000, 50_000_000],
        ["2", "PL1", "Lô 1", "Switch mạng", "Cái", 2, 10_000_000, 20_000_000],
      ],
    },
  };
  const paths = {};
  for (const [name, definition] of Object.entries(cases)) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(definition.rows),
      "Mẫu số 12.1B. Bảng giá dự thầu",
    );
    const path = join(directory, definition.filename);
    writeFileSync(path, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    paths[name] = path;
  }
  return { directory, paths };
}

const configuredExcelFixtures = {
  noLot: String(process.env.E2E_PACKAGE_GOODS_NO_LOT || "").trim(),
  oneLotOneItem: String(process.env.E2E_PACKAGE_GOODS_ONE_LOT_ONE_ITEM || "").trim(),
  oneLotManyItems: String(process.env.E2E_PACKAGE_GOODS_ONE_LOT_MANY_ITEMS || "").trim(),
};
const generatedExcelFixtures = Object.values(configuredExcelFixtures).every(Boolean)
  ? null
  : createLifecycleExcelFixtures();
const excelFixtures = Object.fromEntries(Object.entries(configuredExcelFixtures).map(([name, path]) => [
  name,
  path || generatedExcelFixtures.paths[name],
]));
if (generatedExcelFixtures) {
  process.stdout.write(`[E2E] Generated CI Excel fixtures in ${generatedExcelFixtures.directory}\n`);
}
// The lifecycle suite exercises every major workflow through a small number of
// browser sessions. Chromium's Windows headless renderer can retain several
// gigabytes across the full sequence and eventually stop servicing Playwright
// even though the application and HTTP server remain healthy. This suite does
// not test hardware GPU compositing, so disable GPU acceleration while retaining
// Chromium's software rasterizer for deterministic hit-testing. Restart only at
// server-persisted workflow boundaries.
const launchOptions = {
  headless: true,
  args: [
    "--disable-gpu",
    "--no-proxy-server",
  ],
};
if (process.env.E2E_BROWSER_CHANNEL || process.env.STARTUP_BROWSER_CHANNEL) {
  launchOptions.channel = process.env.E2E_BROWSER_CHANNEL || process.env.STARTUP_BROWSER_CHANNEL;
}
let browser = null;
let browserServer = null;
let context = null;
let page = null;

const mark = (step, details = {}) => {
  result.steps.push({ step, ...details });
  process.stdout.write(`[E2E] ${step}\n`);
};

const waitForPageCondition = (page, predicate, argument = null, options = {}) => (
  page.waitForFunction(predicate, argument, { polling: 100, ...options })
);

const waitForApp = async (page) => {
  try {
    await waitForPageCondition(page, () => {
      const loader = document.getElementById("system-init-loader");
      return loader?.getAttribute("aria-busy") === "false"
        && getComputedStyle(loader).visibility === "hidden";
    }, null, { timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const loader = document.getElementById("system-init-loader");
      const sync = document.getElementById("btn-force-sync");
      return {
        url: location.href,
        readyState: document.readyState,
        loader: loader ? {
          busy: loader.getAttribute("aria-busy"),
          text: loader.textContent?.trim() || "",
          display: getComputedStyle(loader).display,
          visibility: getComputedStyle(loader).visibility,
          opacity: getComputedStyle(loader).opacity,
        } : null,
        reconciliation: sync?.dataset.startupReconciliationPhase || "",
        authVisible: Boolean(document.getElementById("auth-overlay")?.getClientRects().length),
        bodyClasses: document.body.className,
      };
    }).catch(() => ({ url: page.url(), rendererUnresponsive: true }));
    throw new Error(`Application loader did not settle: ${JSON.stringify({ diagnostics, pageErrors: pageErrors.slice(-8), httpErrors: httpErrors.slice(-8) })}`, { cause: error });
  }
};

async function openBrowserSession(storageState = undefined) {
  if (!browser) {
    browserServer = await chromium.launchServer(launchOptions);
    browser = await chromium.connect({ wsEndpoint: browserServer.wsEndpoint() });
  }
  context = await browser.newContext({
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    serviceWorkers: "block",
    storageState,
  });
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);
  const blockInjectedScript = (route) => route.abort("blockedbyclient");
  await page.route(
    /^https?:\/\/local\.adguard\.org(?::\d+)?(?:\/|$)/i,
    blockInjectedScript,
  );
  await page.route(/[?&]type=content-script(?:&|$)/i, blockInjectedScript);
  await page.route(/[?&]name=AdGuard[^&]*(?:&|$)/i, blockInjectedScript);
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("request", (request) => {
    if (!request.url().includes("/api/")) return;
    recentApiTraffic.push(`-> ${request.method()} ${new URL(request.url()).pathname}`);
    if (recentApiTraffic.length > 30) recentApiTraffic.shift();
  });
  page.on("response", async (response) => {
    if (response.url().includes("/api/")) {
      recentApiTraffic.push(`<-${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
      if (recentApiTraffic.length > 30) recentApiTraffic.shift();
    }
    if (response.status() >= 400 && response.url().includes("/api/")
      && !isExpectedTelemetryBackpressure(response)) {
      let body = "";
      try { body = await response.text(); } catch {}
      if (isExpectedSyncReset(response, body)) return;
      httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()} ${body}`);
    }
  });
}

async function renewBrowserSession() {
  const storageState = await context.storageState({ indexedDB: true });
  const previousContext = context;
  context = null;
  page = null;
  await previousContext.close();
  await openBrowserSession(storageState);
  mark("browser-session-renewed");
}

async function restartBrowserSession() {
  const storageState = await context.storageState({ indexedDB: true });
  const previousServer = browserServer;
  context = null;
  page = null;
  browser = null;
  browserServer = null;
  previousServer.process().kill();
  await openBrowserSession(storageState);
  mark("browser-session-restarted");
}

const waitForInitialReconciliation = async (page) => {
  await waitForPageCondition(page, () => (
    document.getElementById("btn-force-sync")?.dataset.startupReconciliationPhase === "RECONCILED"
  ), null, { timeout: 20_000 });
};

const waitForRenderedWorkflowTab = async (page, tab) => {
  await waitForPageCondition(page, (expectedTab) => {
    const wrapper = document.getElementById("detail-workflow-content-wrapper");
    return wrapper?.dataset.renderedWorkflowTab === expectedTab
      && wrapper.dataset.renderedRenderVersion === wrapper.dataset.pendingRenderVersion;
  }, tab, { timeout: 20_000 });
};

const waitForVisibleContentEnhancements = async (page) => {
  await waitForPageCondition(page, () => {
    const wrapper = document.getElementById("detail-workflow-content-wrapper");
    if (!wrapper) return false;
    const paginatedTables = [...wrapper.querySelectorAll('table[data-row-pagination="true"]')];
    return paginatedTables.length === 3
      && paginatedTables.every((table) => table.__bfRowPaginationContainer?.isConnected);
  }, null, { timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => {
      const wrapper = document.getElementById("detail-workflow-content-wrapper");
      return {
        enhanceFramePending: Boolean(globalThis.app?.view?._enhanceFrame),
        renderedTab: wrapper?.dataset.renderedWorkflowTab || "",
        tables: [...(wrapper?.querySelectorAll('table[data-row-pagination="true"]') || [])]
          .map((table) => ({
            id: table.id,
            rowCount: table.tBodies?.[0]?.rows?.length || 0,
            paginationConnected: Boolean(table.__bfRowPaginationContainer?.isConnected),
          })),
      };
    }).catch(() => ({ rendererUnresponsive: true }));
    throw new Error(`Visible content enhancements did not settle: ${JSON.stringify({ state, pageErrors: pageErrors.slice(-8) })}`, { cause: error });
  });
};

const waitForVisibleRowText = async (page, rowSelector, expectedText, timeout = 15_000) => {
  await waitForPageCondition(page, ({ selector, text }) => (
    [...document.querySelectorAll(selector)].some((row) => (
      row.textContent?.includes(text) && row.getClientRects().length > 0
    ))
  ), { selector: rowSelector, text: expectedText }, { timeout });
};

const gotoReady = async (page, url) => {
  if (page.url() !== "about:blank") {
    await page.goto("about:blank", { waitUntil: "commit" });
  }
  const response = await page.goto(url, { waitUntil: "commit" });
  if (!response?.ok()) {
    throw new Error(`${url} returned HTTP ${response?.status() || "unknown"}`);
  }
  await waitForApp(page);
  return response;
};

const reloadReady = async (page) => {
  const currentUrl = page.url();
  await gotoReady(page, currentUrl);
};

const openPackageWorkflow = async (title, tab = null) => {
  await gotoReady(page, `${baseURL}/goi-thau`);
  await waitForApp(page);
  await page.locator("#search-goithau").fill(title);
  await page.getByText(title, { exact: true }).click();
  if (tab) {
    await page.locator(`button[data-workflow-tab="${tab}"]`).click();
    await waitForRenderedWorkflowTab(page, tab);
  }
};

const openCreateModal = async (page, route, buttonSelector, modalSelector) => {
  const currentPath = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
  const targetPath = new URL(route, baseURL).pathname.replace(/\/$/, "") || "/";
  if (currentPath === targetPath) {
    await waitForApp(page);
  } else {
    await gotoReady(page, `${baseURL}${route}`);
  }
  await waitForInitialReconciliation(page);
  await page.locator(buttonSelector).click();
  await page.locator(`${modalSelector}.active`).waitFor({ state: "visible", timeout: 10_000 });
};

const submitModal = async (page, formSelector, modalSelector, { diagnostics = null } = {}) => {
  await page.locator(`${formSelector} button[type='submit']`).click({
    force: true,
    noWaitAfter: true,
  });
  try {
    await page.locator(`${modalSelector}.active`).waitFor({ state: "hidden", timeout: 15_000 });
  } catch (error) {
    if (!diagnostics) throw error;
    const browserState = await page.evaluate(({ formSelector: form, modalSelector: modal }) => {
      const formElement = document.querySelector(form);
      const activeDialog = document.querySelector("#modal-custom-dialog.active");
      const activeToasts = [...document.querySelectorAll(".bf-toast:not(.toast-hiding)")];
      const invalidControls = [...(formElement?.querySelectorAll(":invalid, .invalid input, .invalid select, .invalid textarea") || [])];
      const packageId = document.querySelector("#form-goithau-id")?.value || "";
      const packageRecord = globalThis.app?.model?.state?.goithau?.find?.(
        (item) => String(item.id) === String(packageId),
      ) || null;
      return {
        modalActive: document.querySelector(modal)?.classList.contains("active") || false,
        dialog: activeDialog ? {
          title: activeDialog.querySelector("#dialog-title")?.textContent?.trim() || "",
          message: activeDialog.querySelector("#dialog-message")?.textContent?.trim() || "",
        } : null,
        toasts: activeToasts.map((toast) => toast.textContent?.trim() || ""),
        invalidControls: invalidControls.map((control) => ({
          id: control.id || "",
          name: control.getAttribute("name") || "",
          value: control.value || "",
          validationMessage: control.validationMessage || "",
        })),
        packageId,
        packageRecord: packageRecord ? {
          id: packageRecord.id,
          rootId: packageRecord.rootId,
          rowVersion: packageRecord.rowVersion,
          phienBan: packageRecord.phienBan,
          isLatest: packageRecord.isLatest,
          keHoachId: packageRecord.keHoachId,
          tenGoiThau: packageRecord.tenGoiThau,
        } : null,
        fields: {
          planId: document.querySelector("#gt-kehoachid")?.value || "",
          code: document.querySelector("#gt-ma")?.value || "",
          name: document.querySelector("#gt-ten")?.value || "",
          status: document.querySelector("#gt-trangthai")?.value || "",
        },
      };
    }, { formSelector, modalSelector });
    throw new Error(`${diagnostics} submit failed: ${JSON.stringify({
      browserState,
      recentHttpErrors: httpErrors.slice(-8),
    })}; ${error.message}`);
  }
};

const select = (page, selector, option) => page.locator(selector).selectOption(option, { force: true });

const ensureSelectedValue = async (page, selector, value) => {
  const control = page.locator(selector);
  if (await control.inputValue() === value) return;
  await control.selectOption({ value }, { force: true });
};

const waitForOpeningSaveCompletion = async (page) => {
  await waitForPageCondition(page, () => {
    const button = document.getElementById("btn-mothau-save");
    return !button || (button.dataset.openingSaveBusy !== "1" && !button.disabled);
  }, null, { timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => {
      const app = globalThis.app;
      const button = document.getElementById("btn-mothau-save");
      const owner = app?._autoSyncOwner;
      return {
        button: button ? {
          busy: button.dataset.openingSaveBusy || "",
          disabled: button.disabled,
          text: button.textContent?.trim() || "",
        } : null,
        activeSync: owner ? {
          workspaceToken: owner.workspaceToken || "",
          queued: Boolean(owner.queued),
          hasPromise: Boolean(owner.promise),
        } : null,
        autoSyncQueued: Boolean(app?._autoSyncQueued),
        pendingMutations: Number(app?._pendingMutationCount || 0),
        syncState: document.getElementById("btn-force-sync")?.dataset || null,
        tabs: [...document.querySelectorAll("[data-workflow-tab]")]
          .map((tab) => tab.getAttribute("data-workflow-tab")),
      };
    }).catch(() => ({ rendererUnresponsive: true }));
    throw new Error(`Opening save did not settle: ${JSON.stringify({ state, recentApiTraffic: recentApiTraffic.slice(-20), httpErrors: httpErrors.slice(-8), pageErrors: pageErrors.slice(-8) })}`, { cause: error });
  });
};

  const confirmDialog = async (page) => {
    await page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
    await page.locator("#btn-dialog-ok").click();
    await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  };

  const selectFirstAddress = async (page, provinceSelector, wardSelector) => {
  await select(page, provinceSelector, { index: 1 });
  await waitForPageCondition(page, (selector) => {
    const ward = document.querySelector(selector);
    return ward && !ward.disabled && ward.options.length > 1;
  }, wardSelector, { timeout: 10_000 });
  await select(page, wardSelector, { index: 1 });
};

try {
  await openBrowserSession();

  await gotoReady(page, `${baseURL}/dang-nhap`);
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.locator("#auth-overlay").waitFor({ state: "hidden", timeout: 15_000 });
  mark("login");

  await openCreateModal(page, "/chu-dau-tu", "#btn-add-chudautu", "#modal-chudautu");
  await page.locator("#cdt-ma").fill(`${runId}-CDT`);
  await page.locator("#cdt-ten").fill(`Chủ đầu tư ${runId}`);
  await page.locator("#cdt-ngayapdung").fill(testClock.date(-39));
  await page.locator("#cdt-danhxung").fill("Ông");
  await page.locator("#cdt-daidiencdt").fill("Nguyễn Văn Đại Diện");
  await page.locator("#cdt-chucvunguoidungdau").fill("Giám đốc");
  await page.locator("#cdt-chucvudaidien").fill("Giám đốc");
  await selectFirstAddress(page, "#cdt-tinh", "#cdt-xa");
  await page.locator("#cdt-diachichitiet").fill("01 Đường Kiểm thử E2E");
  await submitModal(page, "#form-chudautu", "#modal-chudautu", {
    diagnostics: "investor",
  });
  await page.locator("#search-chudautu").fill(`Chủ đầu tư ${runId}`);
  await waitForVisibleRowText(page, "#chudautu-table tbody tr", `Chủ đầu tư ${runId}`);
  mark("owner-created");
  await renewBrowserSession();

  await openCreateModal(page, "/nha-thau", "#btn-add-nhathau", "#modal-nhathau");
  await page.locator("#nt-ma").fill(`${runId}-NT`);
  await page.locator("#nt-ten").fill(`Nhà thầu ${runId}`);
  await page.locator("#nt-ngayapdung").fill(testClock.date(-39));
  await page.locator("#nt-danhxung").fill("Bà");
  await page.locator("#nt-nguoidaidien").fill("Trần Thị Nhà Thầu");
  await page.locator("#nt-chucvudaidien").fill("Giám đốc");
  await selectFirstAddress(page, "#nt-tinh", "#nt-xa");
  await page.locator("#nt-diachichitiet").fill("02 Đường Kiểm thử E2E");
  await submitModal(page, "#form-nhathau", "#modal-nhathau", {
    diagnostics: "contractor",
  });
  await page.locator("#search-nhathau").fill(`Nhà thầu ${runId}`);
  await waitForVisibleRowText(page, "#nhathau-table tbody tr", `Nhà thầu ${runId}`);
  mark("contractor-created");
  await renewBrowserSession();

  const createExpert = async (ordinal) => {
    await openCreateModal(page, "/chuyen-gia", "#btn-add-chuyengia", "#modal-chuyengia");
    await page.locator("#cg-hoten").fill(`Chuyên gia ${ordinal} ${runId}`);
    await page.locator("#cg-socccd").fill(`07${runDigits}${ordinal}`);
    await page.locator("#cg-ngaycapcccd").fill(testClock.date(-3_650));
    await page.locator("#cg-noicapcccd").fill("Cục Cảnh sát QLHC về TTXH");
    await page.locator("#cg-sochungchi").fill(`${runId}-CC-${ordinal}`);
    await page.locator("#cg-ngaycapchungchi").fill(testClock.date(-3_600));
    await page.locator("#cg-donvicapchungchi").fill("Cục Quản lý Đấu thầu");
    await submitModal(page, "#form-chuyengia", "#modal-chuyengia", {
      diagnostics: `expert ${ordinal}`,
    });
    await page.locator("#search-chuyengia").fill(`Chuyên gia ${ordinal} ${runId}`);
    await waitForVisibleRowText(page, "#chuyengia-table tbody tr", `Chuyên gia ${ordinal} ${runId}`);
  };
  await createExpert(1);
  await createExpert(2);
  mark("experts-created", { count: 2 });
  await renewBrowserSession();

  await openCreateModal(page, "/ke-hoach", "#btn-add-kehoach", "#modal-kehoach");
  await page.locator("#kh-ma").fill(`${runId}-KH`);
  await page.locator("#kh-ten").fill(`Kế hoạch ${runId}`);
  await select(page, "#kh-loaihinh", { label: "Dự toán mua sắm" });
  await select(page, "#kh-pheduyet", { value: "Dự toán và kế hoạch" });
  await page.locator("#kh-duan").fill(`Dự toán ${runId}`);
  await select(page, "#kh-chudautuid", { label: `Chủ đầu tư ${runId}` });
  await page.locator("#kh-sototrinhdutoankehoach").fill(`${runId}/TTR`);
  await page.locator("#kh-ngaytrinhkehoach").fill(testClock.date(-39));
  await page.locator("#kh-quyetdinh").fill(`${runId}/QD-KH`);
  await page.locator("#kh-ngaypheduyet").fill(testClock.date(-38));
  await page.locator("#kh-thoigiandang").fill(testClock.dateTime(-37, "08:00"));
  await page.locator("#kh-tongmuc").fill("5000000000");
  await page.locator("#form-kehoach button[type='submit']").click();
  await page.locator("#modal-plan-breakdown.active").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#btn-save-plan-breakdown").click();
  await page.locator("#modal-plan-breakdown.active").waitFor({ state: "hidden", timeout: 15_000 });
  await page.locator("#search-kehoach").fill(`Kế hoạch ${runId}`);
  await waitForVisibleRowText(page, "#kehoach-table tbody tr", `Kế hoạch ${runId}`);
  mark("plan-created");
  await renewBrowserSession();

  await openCreateModal(page, "/goi-thau", "#btn-add-goithau", "#modal-goithau");
  await page.locator("#gt-ma").fill(`${runId}-GT`);
  await select(page, "#gt-kehoachid", { label: `Kế hoạch ${runId}` });
  await page.locator("#gt-ten").fill(`Gói hàng hóa ${runId}`);
  await page.locator("#gt-gia").fill("900000000");
  await page.locator("#gt-thoigian").fill("90 ngày");
  await select(page, "#gt-linhvuc", { label: "Hàng hóa" });
  await select(page, "#gt-phanlo", { label: "Không" });
  await page.locator("#gt-nguonvon").fill("Ngân sách nhà nước");
  await page.locator("#gt-thoigiantochuc").fill("45 ngày");
  await page.locator("#gt-thoigianbatdautochuc").fill(testClock.quarter());
  await select(page, "#gt-nhanvienphutrach", { index: 1 });
  const specialistRows = page.locator("#to-chuyengia-tbody tr");
  const appraisalRows = page.locator("#to-thamdinh-tbody tr");
  if (await specialistRows.count() < 2 || await appraisalRows.count() < 2) throw new Error("Package team selectors require two experts.");
  await specialistRows.nth(0).locator('input[name="tochuyengia-select"]').check();
  await appraisalRows.nth(1).locator('input[name="tothamdinh-select"]').check();
  await submitModal(page, "#form-goithau", "#modal-goithau");
  await page.locator("#search-goithau").fill(`Gói hàng hóa ${runId}`);
  await waitForVisibleRowText(page, "#goithau-table tbody tr", `Gói hàng hóa ${runId}`);
  mark("package-created");
  await renewBrowserSession();
  await openPackageWorkflow(`Gói hàng hóa ${runId}`, "goods");
  await page.locator("#btn-package-goods-add").click();
  const goodsRow = page.locator("[data-inline-create-row]");
  await goodsRow.waitFor({ state: "visible", timeout: 10_000 });
  await goodsRow.locator('[name="tenHangHoa"]').fill(`Hàng hóa kiểm thử ${runId}`);
  await goodsRow.locator('[name="donViTinh"]').fill("Bộ");
  await goodsRow.locator('[name="soLuong"]').fill("10");
  await goodsRow.locator("[data-save-new-goods]").click();
  await page.getByText(`Hàng hóa kiểm thử ${runId}`, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  mark("goods-created");

  await reloadReady(page);
  await waitForApp(page);
  await page.locator('button[data-workflow-tab="goods"]').click();
  await page.getByText(`Hàng hóa kiểm thử ${runId}`, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  mark("goods-persisted");
  await renewBrowserSession();
  await openPackageWorkflow(`Gói hàng hóa ${runId}`, "preparation_action");
  await page.locator('button[data-fn="phatHanhHsmtGoiThau"]').click({ timeout: 10_000 });
  await page.locator("#modal-phathanh-hsmt.active").waitFor({ state: "visible", timeout: 10_000 }).catch(async (error) => {
    const browserState = await page.evaluate(() => ({
      activeTab: document.querySelector("[data-workflow-tab][aria-selected='true']")
        ?.getAttribute("data-workflow-tab") || "",
      releaseButtonVisible: Boolean(
        document.querySelector('button[data-fn="phatHanhHsmtGoiThau"]')?.getClientRects().length,
      ),
      lazyModalPresent: Boolean(document.getElementById("modal-phathanh-hsmt")),
      dialogText: document.querySelector("#modal-custom-dialog.active")?.innerText || "",
      toasts: [...document.querySelectorAll(".bf-toast:not(.toast-hiding)")]
        .map((toast) => toast.textContent?.trim() || ""),
    }));
    throw new Error(`Tender publication modal did not open: ${JSON.stringify({
      browserState,
      recentHttpErrors: httpErrors.slice(-8),
      pageErrors: pageErrors.slice(-8),
    })}; ${error.message}`);
  });
  await page.locator("#phathanh-magoithau").fill(`${runId}-GT`);
  await page.locator("#phathanh-sototrinh").fill(`${runId}/TTR-HSMT`);
  await page.locator("#phathanh-ngaytrinh").fill(testClock.date(-11));
  await page.locator("#phathanh-soquyetdinh").fill(`${runId}/QD-HSMT`);
  await page.locator("#phathanh-ngayquyetdinh").fill(testClock.date(-10));
  await page.locator('input[name="phathanh-yeucauthamdinh"][value="NOT_REQUIRED"]').check();
  await page.locator("#phathanh-thoigiandangtai").fill(testClock.dateTime(-9, "08:00"));
  await page.locator("#phathanh-thoigiandongthau").fill(testClock.dateTime(-7, "09:00"));
  await page.locator("#phathanh-giatribaomothau").fill("10000000");
  await page.locator("#phathanh-hieuluchsdt").fill("90");
  await page.locator("#btn-confirm-phathanh").click();
  await confirmDialog(page);
  await page.locator("#modal-phathanh-hsmt.active").waitFor({ state: "hidden", timeout: 15_000 });
  await page.locator('button[data-fn="moThauGoiThau"]').waitFor({ state: "visible", timeout: 15_000 }).catch(async (error) => {
    const browserState = await page.evaluate((expectedName) => {
      const pkg = globalThis.app?.model?.state?.goithau?.find?.(
        (item) => item.tenGoiThau === expectedName,
      );
      const activeDialog = document.querySelector("#modal-custom-dialog.active");
      return {
        package: pkg ? {
          id: pkg.id,
          rowVersion: pkg.rowVersion,
          trangThai: pkg.trangThai,
          thoiGianDangTai: pkg.thoiGianDangTai,
          thoiGianDongThau: pkg.thoiGianDongThau,
        } : null,
        activeTab: document.querySelector("[data-workflow-tab][aria-selected='true']")
          ?.getAttribute("data-workflow-tab") || "",
        workflowButtons: [...document.querySelectorAll("#detail-workflow-content-wrapper [data-fn]")]
          .map((button) => ({
            fn: button.getAttribute("data-fn") || "",
            visible: Boolean(button.getClientRects().length),
          })),
        workflowText: document.getElementById("detail-workflow-content-wrapper")
          ?.innerText?.slice(0, 1000) || "",
        dialog: activeDialog ? {
          title: activeDialog.querySelector("#dialog-title")?.textContent?.trim() || "",
          message: activeDialog.querySelector("#dialog-message")?.textContent?.trim() || "",
        } : null,
        toasts: [...document.querySelectorAll(".bf-toast:not(.toast-hiding)")]
          .map((toast) => toast.textContent?.trim() || ""),
      };
    }, `Gói hàng hóa ${runId}`);
    throw new Error(`Tender publication did not expose opening action: ${JSON.stringify({
      browserState,
      recentHttpErrors: httpErrors.slice(-8),
      pageErrors: pageErrors.slice(-8),
    })}; ${error.message}`);
  });
  mark("tender-published");
  await renewBrowserSession();
  await openPackageWorkflow(`Gói hàng hóa ${runId}`, "opening");
  await page.locator('button[data-fn="moThauGoiThau"]').click();
  await page.locator("#modal-custom-dialog.active #dialog-prompt-input").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#dialog-prompt-input").fill(testClock.dateTime(-7, "10:00"));
  await page.locator("#btn-dialog-ok").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  await page.locator("#btn-mothau-add-bid").waitFor({ state: "visible", timeout: 15_000 });
  await waitForRenderedWorkflowTab(page, "opening");
  mark("tender-opened");

  const openingRows = page.locator("#mothau-table-tbody tr");
  if (await openingRows.count() === 0) await page.locator("#btn-mothau-add-bid").click();
  const openingRow = openingRows.first();
  await openingRow.locator(".mt-ma-nha-thau").fill(`${runId}-NT`);
  await openingRow.locator(".mt-ten-nha-thau").fill(`Nhà thầu ${runId}`);
  await openingRow.locator(".mt-gia-du-thau").fill("780000000");
  await openingRow.locator(".mt-ty-le-giam-gia").fill("1");
  await openingRow.locator(".mt-hieu-luc-hsdt").fill("90");
  await openingRow.locator(".mt-gia-tri-dam-bao").fill("10000000");
  await openingRow.locator(".mt-hieu-luc-bao-dam-ngay").fill("120");
  await openingRow.locator(".mt-thoi-gian-thuc-hien").fill("90 ngày");
  await page.locator("#btn-mothau-save").click();
  const openingSaveCompletion = waitForOpeningSaveCompletion(page);
  await page.locator('button[data-workflow-tab="eval_tech"]').waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      dialogTitle: document.querySelector("#modal-custom-dialog.active #dialog-title")?.textContent || "",
      dialogMessage: document.querySelector("#modal-custom-dialog.active #dialog-message")?.textContent || "",
      tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
      rowValues: [...document.querySelectorAll("#mothau-table-tbody input")].map((item) => ({ className: item.className, value: item.value })),
    }));
    throw new Error(`Opening did not advance: ${JSON.stringify(state)}; ${error.message}`);
  });
  await openingSaveCompletion;
  await renewBrowserSession();
  await openPackageWorkflow(`Gói hàng hóa ${runId}`, "eval_tech");
  // The tab click owns an asynchronous detail render.  Wait for the rendered
  // evaluation seam before writing fields so a late render cannot replace the
  // user's inputs with the initial empty projection.
  await page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("#btn-danhgiahsdt-save").waitFor({ state: "visible", timeout: 15_000 });
  mark("opening-saved");

  mark("evaluation-form-start");
  await page.locator("#danhgiahsdt-so-baocao").fill(`${runId}/BC-DG`);
  mark("evaluation-report-number-filled");
  await page.locator("#danhgiahsdt-ngay-baocao").fill(testClock.date(-6));
  mark("evaluation-report-date-filled");
  const evaluationRow = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").first();
  mark("evaluation-row-visible");
  await select(page, "#danhgiahsdt-table-tbody .mt-dg-hop-le", { label: "Đạt" });
  mark("evaluation-validity-selected");
  await select(page, "#danhgiahsdt-table-tbody .mt-dg-nang-luc", { label: "Đạt" });
  mark("evaluation-capacity-selected");
  await evaluationRow.locator(".mt-dg-ky-thuat").fill("Đạt");
  mark("evaluation-technical-filled");
  if (await evaluationRow.locator(".mt-gia-xep-hang").count()) {
    await evaluationRow.locator(".mt-gia-xep-hang").fill("772200000");
  }
  if (await evaluationRow.locator(".mt-gia-de-nghi-trung-thau").count()) {
    await evaluationRow.locator(".mt-gia-de-nghi-trung-thau").fill("772200000");
  }
  await page.locator("#btn-danhgiahsdt-save").click();
  mark("evaluation-save-clicked");
  await page.locator('button[data-workflow-tab="result"]').waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      dialogTitle: document.querySelector("#modal-custom-dialog.active #dialog-title")?.textContent || "",
      dialogMessage: document.querySelector("#modal-custom-dialog.active #dialog-message")?.textContent || "",
      tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
      conclusion: document.querySelector("#danhgiahsdt-table-tbody .mt-ketluan-cell")?.textContent?.trim() || "",
      saveButton: (() => { const button = document.querySelector("#btn-danhgiahsdt-save"); return button ? { text: button.textContent.trim(), disabled: button.disabled, ariaBusy: button.getAttribute("aria-busy") } : null; })(),
      startupReconciliation: (() => {
        const app = globalThis.app;
        const state = app?.getStartupReconciliationState?.();
        return state ? { phase: state.phase, workspaceToken: state.workspaceToken, hasPromise: Boolean(state.promise) } : null;
      })(),
      activeSync: (() => { const owner = globalThis.app?._autoSyncOwner; return owner ? { workspaceToken: owner.workspaceToken || "", queued: Boolean(owner.queued), hasPromise: Boolean(owner.promise) } : null; })(),
      evaluationControls: ["danhgiahsdt-goithau-select", "danhgiahsdt-so-baocao", "danhgiahsdt-ngay-baocao", "danhgiahsdt-table-tbody"].map((id) => ({
        id,
        count: document.querySelectorAll(`#${id}`).length,
        value: document.querySelector(`#${id}`)?.value || "",
        activePane: document.querySelector(`#${id}`)?.closest?.(".tab-pane")?.id || "",
      })),
      saveHandler: (() => {
        const button = document.querySelector("#btn-danhgiahsdt-save");
        return { onclickType: typeof button?.onclick, onclick: String(button?.onclick || "") };
      })(),
    }));
    throw new Error(`Evaluation did not advance: ${JSON.stringify({ state, pageErrors, httpErrors, recentApiTraffic })}; ${error.message}`);
  });
  mark("evaluation-saved");
  await renewBrowserSession();
  await openPackageWorkflow(`Gói hàng hóa ${runId}`, "result");

  await page.locator("#award-so-bctd").fill(`${runId}/BC-TD-KQ`);
  mark("award-appraisal-number-filled");
  await page.locator("#award-ngay-bctd").fill(testClock.date(-5));
  mark("award-appraisal-date-filled");
  await page.locator("#award-decision-no").fill(`${runId}/QD-KQ`);
  mark("award-decision-number-filled");
  await page.locator("#award-decision-date").fill(testClock.date(-4));
  mark("award-decision-date-filled");
  const awardRow = page.locator("#approve-bidders-tbody tr[data-approve-bid-id]").first();
  await select(page, "#approve-bidders-tbody .row-status-select", "trung");
  mark("award-status-selected");
  await awardRow.locator(".row-gia-trung").fill("772200000");
  mark("award-price-filled");
  await awardRow.locator(".row-tg-goithau").fill("90 ngày");
  mark("award-package-duration-filled");
  await awardRow.locator(".row-tg-hopdong").fill("90 ngày và nghĩa vụ bảo hành");
  mark("award-contract-duration-filled");
  await page.locator("#btn-approve-award").click();
  mark("award-approve-clicked");
  await page.locator(".award-result-card").waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      dialogTitle: document.querySelector("#modal-custom-dialog.active #dialog-title")?.textContent || "",
      dialogMessage: document.querySelector("#modal-custom-dialog.active #dialog-message")?.textContent || "",
      invalid: [...document.querySelectorAll('[aria-invalid="true"]')].map((item) => item.id || item.className),
      tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
      approval: (() => {
        const row = document.querySelector("#approve-bidders-tbody tr[data-approve-bid-id]");
        const field = (selector) => { const item = row?.querySelector(selector); return item ? { value: item.value, border: item.style.border } : null; };
        const button = document.querySelector("#btn-approve-award");
        return {
          status: field(".row-status-select"), price: field(".row-gia-trung"),
          packageDuration: field(".row-tg-goithau"), contractDuration: field(".row-tg-hopdong"),
          decisionNo: document.querySelector("#award-decision-no")?.value || "",
          decisionDate: document.querySelector("#award-decision-date")?.value || "",
          appraisalNo: document.querySelector("#award-so-bctd")?.value || "",
          appraisalDate: document.querySelector("#award-ngay-bctd")?.value || "",
          hasHandler: Boolean(button?.onclick),
        };
      })(),
    }));
    throw new Error(`Award did not complete: ${JSON.stringify({ state, pageErrors, httpErrors })}; ${error.message}`);
  });
  mark("award-approved");

  await reloadReady(page);
  await waitForApp(page);
  await page.locator('button[data-workflow-tab="result"]').click();
  await page.locator(".award-result-card").waitFor({ state: "visible", timeout: 15_000 });
  const persistedContractor = page.locator(".award-result-card")
    .getByText(`Nhà thầu ${runId}`, { exact: true });
  if (await persistedContractor.count() !== 1) {
    throw new Error("Award persistence rendered an ambiguous or missing visible contractor result.");
  }
  await persistedContractor.waitFor({ state: "visible", timeout: 15_000 });
  mark("award-persisted");
  await restartBrowserSession();
  await openCreateModal(page, "/hop-dong", "#btn-add-hopdong", "#modal-hopdong");
  mark("contract-modal-opened");
  await page.locator("#hd-so").fill(`${runId}/HD`);
  mark("contract-number-filled");
  await page.locator("#hd-ten").fill(`Hợp đồng ${runId}`);
  await page.locator("#hd-ngayky").fill(testClock.date(-3));
  mark("contract-basics-filled");
  await select(page, "#hd-chudautuid", { label: `Chủ đầu tư ${runId}` });
  mark("contract-owner-selected");
  process.stdout.write("[DEBUG-contract-create] contractor\n");
  await select(page, "#hd-nhathauid", { label: `Nhà thầu ${runId}` });
  process.stdout.write("[DEBUG-contract-create] value\n");
  await page.locator("#hd-giatri").fill("772200000");
  process.stdout.write("[DEBUG-contract-create] type\n");
  await select(page, "#hd-loai", { label: "Trọn gói" });
  process.stdout.write("[DEBUG-contract-create] classification\n");
  await select(page, "#hd-phanloai", { label: "Khác" });
  process.stdout.write("[DEBUG-contract-create] duration\n");
  await page.locator("#hd-songay").fill("90 ngày");
  process.stdout.write("[DEBUG-contract-create] plan\n");
  await select(page, "#hd-kehoachid", { label: `Kế hoạch ${runId}` });
  process.stdout.write("[DEBUG-contract-create] package\n");
  await page.locator('input[name="hd-goithau-checkbox"]').check();
  process.stdout.write("[DEBUG-contract-create] assignee\n");
  await select(page, "#hd-nhanvienphutrach", { index: 1 });
  process.stdout.write("[DEBUG-contract-create] status\n");
  await select(page, "#hd-trangthai-hopdong", { label: "Đang thực hiện" });
  process.stdout.write("[DEBUG-contract-create] submit\n");
  await submitModal(page, "#form-hopdong", "#modal-hopdong", {
    diagnostics: "contract create",
  });
  await page.locator("#search-hopdong").fill(`Hợp đồng ${runId}`);
  const contractRow = () => page.locator("#hopdong-table tbody tr").filter({ hasText: `Hợp đồng ${runId}` });
  await contractRow().waitFor({ state: "visible", timeout: 15_000 });
  await contractRow().getByText("Đang thực hiện", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  mark("contract-created");

  const advanceContractStatus = async (status, liquidationDate = "") => {
    process.stdout.write(`[DEBUG-contract-stage] ${status}:search\n`);
    await page.locator("#search-hopdong").fill(`Hợp đồng ${runId}`);
    process.stdout.write(`[DEBUG-contract-stage] ${status}:row\n`);
    await contractRow().waitFor({ state: "visible", timeout: 15_000 });
    process.stdout.write(`[DEBUG-contract-stage] ${status}:edit\n`);
    await contractRow().locator('[data-bf-action="edit-contract"]').click();
    process.stdout.write(`[DEBUG-contract-stage] ${status}:modal\n`);
    await page.locator("#modal-hopdong.active").waitFor({ state: "visible", timeout: 10_000 });
    process.stdout.write(`[DEBUG-contract-stage] ${status}:select\n`);
    await select(page, "#hd-trangthai-hopdong", { label: status });
    if (liquidationDate) await page.locator("#hd-ngaythanhly").fill(liquidationDate);
    process.stdout.write(`[DEBUG-contract-stage] ${status}:submit\n`);
    await page.locator("#form-hopdong button[type='submit']").click({
      force: true,
      noWaitAfter: true,
    });
    process.stdout.write(`[DEBUG-contract-stage] ${status}:confirm\n`);
    await confirmDialog(page);
    process.stdout.write(`[DEBUG-contract-stage] ${status}:close\n`);
    try {
      await page.locator("#modal-hopdong.active").waitFor({ state: "hidden", timeout: 15_000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => {
        const modal = document.getElementById("modal-hopdong");
        const formId = document.getElementById("form-hopdong-id")?.value || "";
        const model = globalThis.app?.model;
        return {
          modalActive: modal?.classList.contains("active") === true,
          formId,
          selectedStatus: document.getElementById("hd-trangthai-hopdong")?.value || "",
          liquidationDate: document.getElementById("hd-ngaythanhly")?.value || "",
          dialog: document.querySelector("#modal-custom-dialog.active")?.innerText || "",
          toasts: [...document.querySelectorAll(".bf-toast:not(.toast-hiding)")]
            .map((toast) => toast.textContent?.trim() || ""),
          contracts: (model?.state?.hopdong || [])
            .filter((contract) => String(contract?.tenHopDong || "").includes("Hợp đồng E2E-"))
            .map((contract) => ({
              id: contract.id,
              rootId: contract.rootId,
              version: contract.phienBan,
              isLatest: contract.isLatest,
              status: contract.trangThaiHopDong,
              rowVersion: contract.rowVersion,
            })),
          pendingMutations: Number(globalThis.app?._pendingMutationCount || 0),
          autoSyncOwner: globalThis.app?._autoSyncOwner ? {
            queued: Boolean(globalThis.app._autoSyncOwner.queued),
            hasPromise: Boolean(globalThis.app._autoSyncOwner.promise),
          } : null,
        };
      }).catch(() => ({ rendererUnresponsive: true }));
      throw new Error(`Contract status modal did not close: ${JSON.stringify({ diagnostics, recentApiTraffic: recentApiTraffic.slice(-20), httpErrors: httpErrors.slice(-8), pageErrors: pageErrors.slice(-8) })}`, { cause: error });
    }
    await page.locator("#search-hopdong").fill(`Hợp đồng ${runId}`);
    await contractRow().getByText(status, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  };
  await advanceContractStatus("Đã hoàn thành");
  mark("contract-completed");
  await renewBrowserSession();
  await gotoReady(page, `${baseURL}/hop-dong`);
  await advanceContractStatus("Đã thanh lý", testClock.date(6));
  mark("contract-liquidated");

  await reloadReady(page);
  await waitForApp(page);
  await page.locator("#search-hopdong").fill(`Hợp đồng ${runId}`);
  await contractRow().waitFor({ state: "visible", timeout: 15_000 });
  await contractRow().getByText("Đã thanh lý", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  mark("contract-persisted");
  await restartBrowserSession();

  const createAdditionalPackage = async ({ suffix, title, method, lots = [] }) => {
    await openCreateModal(page, "/goi-thau", "#btn-add-goithau", "#modal-goithau");
    await page.locator("#gt-ma").fill(`${runId}-${suffix}`);
    await select(page, "#gt-kehoachid", { label: `Kế hoạch ${runId}` });
    await page.locator("#gt-ten").fill(title);
    await page.locator("#gt-gia").fill(lots.length ? String(lots.reduce((sum, lot) => sum + lot.price, 0)) : "500000000");
    await page.locator("#gt-thoigian").fill("90 ngày");
    await select(page, "#gt-linhvuc", { label: "Hàng hóa" });
    await select(page, "#gt-hinhthuc", { label: "Đấu thầu rộng rãi" });
    await select(page, "#gt-phuongthuc", { label: method });
    await select(page, "#gt-phuongphapdanhgia", { label: "Giá thấp nhất" });
    await select(page, "#gt-phanlo", { label: lots.length ? "Có" : "Không" });
    if (lots.length) {
      while (await page.locator("#phanlo-tbody tr").count() < lots.length) {
        await page.locator("#btn-them-phanlo").click();
      }
      let lotIndex = 0;
      while (lotIndex < lots.length) {
        // The accessibility enhancer paginates this form table asynchronously.
        // Re-check each row's rendered visibility instead of trusting a locator
        // snapshot captured while the pagination update is still in flight.
        const editableRows = page.locator("#phanlo-tbody tr:has(.pl-code-input)");
        await waitForPageCondition(page, () => [...document.querySelectorAll("#phanlo-tbody tr")]
          .some((row) => !row.hidden && Boolean(row.querySelector(".pl-code-input"))), null, { timeout: 10_000 });
        const editableRowCount = await editableRows.count();
        let filledOnCurrentPage = 0;
        for (let rowIndex = 0; rowIndex < editableRowCount && lotIndex < lots.length; rowIndex += 1) {
          const row = editableRows.nth(rowIndex);
          if (!await row.isVisible()) continue;
          const lot = lots[lotIndex];
          await row.locator(".pl-code-input").fill(lot.code);
          await row.locator(".pl-name-input").fill(lot.name);
          await row.locator(".pl-price-input").fill(String(lot.price));
          await row.locator(".pl-duration-input").fill("90 ngày");
          lotIndex += 1;
          filledOnCurrentPage += 1;
        }
        if (!filledOnCurrentPage) throw new Error("No visible package-lot rows are available for input.");
        if (lotIndex >= lots.length) break;

        const lotTable = page.locator("#phanlo-tbody").locator("xpath=ancestor::table[1]");
        const tableId = await lotTable.getAttribute("id");
        if (!tableId) throw new Error("Package-lot table is missing its pagination identity.");
        const pagination = page.locator(`nav[data-table-pagination-for="${tableId}"]`);
        const activePage = pagination.locator("[aria-current='page']");
        const currentPage = await activePage.getAttribute("data-table-page");
        const nextPage = pagination.getByRole("button", { name: "Trang sau", exact: true });
        if (!currentPage || !await nextPage.isEnabled()) {
          throw new Error(`Package-lot pagination ended after ${lotIndex} of ${lots.length} lots.`);
        }
        await nextPage.click();
        await waitForPageCondition(page, ({ tableId: expectedTableId, currentPage: expectedCurrentPage }) => {
          const paginationNav = [...document.querySelectorAll("nav[data-table-pagination-for]")]
            .find((nav) => nav.dataset.tablePaginationFor === expectedTableId);
          return paginationNav?.querySelector("[aria-current='page']")?.getAttribute("data-table-page") !== expectedCurrentPage;
        }, { tableId, currentPage }, { timeout: 10_000 });
      }
    }
    await page.locator("#gt-nguonvon").fill("Ngân sách nhà nước");
    await page.locator("#gt-thoigiantochuc").fill("45 ngày");
    await page.locator("#gt-thoigianbatdautochuc").fill(testClock.quarter());
    await select(page, "#gt-nhanvienphutrach", { index: 1 });
    const specialistRows = page.locator("#to-chuyengia-tbody tr");
    const appraisalRows = page.locator("#to-thamdinh-tbody tr");
    await specialistRows.nth(0).locator('input[name="tochuyengia-select"]').check();
    await appraisalRows.nth(1).locator('input[name="tothamdinh-select"]').check();
    await submitModal(page, "#form-goithau", "#modal-goithau", {
      diagnostics: `additional package ${suffix}`,
    });
    await page.locator("#search-goithau").fill(title);
    await waitForVisibleRowText(page, "#goithau-table tbody tr", title);
  };

  const twoEnvelopePackage = `Gói 1G2T ${runId}`;
  const lotPackage = `Gói phân lô ${runId}`;
  const cancellablePackage = `Gói hủy ${runId}`;
  const oneItemLotsExcelPackage = `Gói Excel mỗi lô một mặt hàng ${runId}`;
  const manyItemsLotsExcelPackage = `Gói Excel mỗi lô nhiều mặt hàng ${runId}`;
  await createAdditionalPackage({ suffix: "GT-2T", title: twoEnvelopePackage, method: "Một giai đoạn hai túi hồ sơ" });
  await createAdditionalPackage({
    suffix: "GT-LOT",
    title: lotPackage,
    method: "Một giai đoạn một túi hồ sơ",
    lots: [
      { code: "PP01", name: "Phần 1", price: 250000000 },
      { code: "PP02", name: "Phần 2", price: 250000000 },
    ],
  });
  await createAdditionalPackage({ suffix: "GT-CANCEL", title: cancellablePackage, method: "Một giai đoạn một túi hồ sơ" });
  await restartBrowserSession();
  await createAdditionalPackage({
    suffix: "GT-EXCEL-1I",
    title: oneItemLotsExcelPackage,
    method: "Một giai đoạn một túi hồ sơ",
    lots: Array.from({ length: 21 }, (_, index) => ({
      code: `PP260022${4818 + index}`,
      name: `Phần ${index + 1}`,
      price: 10_000_000,
    })),
  });
  await createAdditionalPackage({
    suffix: "GT-EXCEL-MI",
    title: manyItemsLotsExcelPackage,
    method: "Một giai đoạn một túi hồ sơ",
    lots: [{ code: "PL1", name: "Lô 1", price: 250_000_000 }],
  });
  mark("advanced-packages-created", { count: 5 });
  await renewBrowserSession();

  const importPackageGoods = async (packageTitle, filePath) => {
    await gotoReady(page, `${baseURL}/goi-thau`);
    await waitForApp(page);
    await page.locator("#search-goithau").fill(packageTitle);
    await page.getByText(packageTitle, { exact: true }).click();
    await page.locator('button[data-workflow-tab="goods"]').click();
    const previousCount = Number.parseInt((await page.locator(".package-goods-summary").innerText()).replace(/\D/g, ""), 10) || 0;
    const fileInput = page.locator("#package-goods-file");
    await fileInput.setInputFiles(filePath);
    const previewRows = page.locator("#package-goods-preview tbody tr.package-goods-item-row");
    await previewRows.first().waitFor({ state: "visible", timeout: 20_000 });
    const preview = await previewRows.evaluateAll((rows) => rows.map((row) => {
      const cells = [...row.querySelectorAll("td")];
      return {
        sequence: cells[0]?.textContent?.trim() || "",
        status: cells.at(-2)?.textContent?.trim() || "",
        detail: cells.at(-1)?.textContent?.trim() || "",
      };
    }));
    const invalid = preview.filter((row) => row.status !== "Hợp lệ");
    if (!preview.length || invalid.length) {
      throw new Error(`Invalid goods preview for ${filePath}: ${JSON.stringify({ previewCount: preview.length, invalid })}`);
    }
    await page.locator("#btn-package-goods-import-save").click();
    await waitForPageCondition(page, (before) => {
      const text = document.querySelector(".package-goods-summary")?.textContent || "";
      return Number.parseInt(text.replace(/\D/g, ""), 10) > before;
    }, previousCount, { timeout: 20_000 });
    const savedCount = Number.parseInt((await page.locator(".package-goods-summary").innerText()).replace(/\D/g, ""), 10);
    await reloadReady(page);
    await waitForApp(page);
    await page.locator('button[data-workflow-tab="goods"]').click();
    const persistedCount = Number.parseInt((await page.locator(".package-goods-summary").innerText()).replace(/\D/g, ""), 10);
    if (persistedCount !== savedCount) throw new Error(`Goods count changed after reload: ${savedCount} -> ${persistedCount}`);
    return { previewCount: preview.length, persistedCount };
  };

  const noLotImported = await importPackageGoods(twoEnvelopePackage, excelFixtures.noLot);
  await renewBrowserSession();
  const oneLotOneItemImported = await importPackageGoods(oneItemLotsExcelPackage, excelFixtures.oneLotOneItem);
  await renewBrowserSession();
  const oneLotManyItemsImported = await importPackageGoods(manyItemsLotsExcelPackage, excelFixtures.oneLotManyItems);
  mark("supplied-excel-goods-imported", {
    noLotImported,
    oneLotOneItemImported,
    oneLotManyItemsImported,
  });
  await restartBrowserSession();

  await gotoReady(page, `${baseURL}/goi-thau`);
  mark("cancellable-list-ready");
  await waitForApp(page);
  await page.locator("#search-goithau").fill(cancellablePackage);
  await page.getByText(cancellablePackage, { exact: true }).click();
  mark("cancellable-package-opened");
  await page.locator('button[data-workflow-tab="preparation_action"]').click();
  await page.locator('button[data-fn="phatHanhHsmtGoiThau"]').click();
  await page.locator("#modal-phathanh-hsmt.active").waitFor({ state: "visible", timeout: 10_000 });
  mark("cancellable-publication-modal-opened");
  await page.locator("#phathanh-magoithau").fill(`${runId}-GT-CANCEL`);
  await page.locator("#phathanh-sototrinh").fill(`${runId}/TTR-HUY`);
  await page.locator("#phathanh-ngaytrinh").fill(testClock.date(-11));
  await page.locator("#phathanh-soquyetdinh").fill(`${runId}/QD-HUY-HSMT`);
  await page.locator("#phathanh-ngayquyetdinh").fill(testClock.date(-10));
  await page.locator('input[name="phathanh-yeucauthamdinh"][value="NOT_REQUIRED"]').check();
  await page.locator("#phathanh-thoigiandangtai").fill(testClock.dateTime(-9, "08:00"));
  await page.locator("#phathanh-thoigiandongthau").fill(testClock.dateTime(-7, "09:00"));
  await page.locator("#phathanh-giatribaomothau").fill("5000000");
  await page.locator("#phathanh-hieuluchsdt").fill("90");
  await page.locator("#btn-confirm-phathanh").click();
  mark("cancellable-publication-confirm-opened");
  await confirmDialog(page);
  mark("cancellable-publication-confirmed");
  await page.locator("#modal-phathanh-hsmt.active").waitFor({ state: "hidden", timeout: 15_000 });
  mark("cancellable-publication-modal-closed");
  await page.locator('button[data-fn="moThauGoiThau"]').waitFor({ state: "visible", timeout: 15_000 });
  mark("cancellable-opening-action-visible");
  await waitForVisibleContentEnhancements(page);
  mark("cancellable-invitation-enhanced");

  const invitationRoot = page.locator("#detail-workflow-content-wrapper");
  await page.locator("#btn-luu-thongtinmoithau").click({ force: true, noWaitAfter: true });
  mark("cancellable-invitation-edit-requested");
  await invitationRoot.locator("#btn-them-giahan").waitFor({ state: "visible", timeout: 10_000 });
  mark("cancellable-invitation-edit-ready");
  await invitationRoot.locator("#btn-them-giahan").press("Enter", { noWaitAfter: true });
  const extensionRow = invitationRoot.locator("#gt-giahan-tbody tr").last();
  await extensionRow.locator(".gh-time-input").fill(testClock.dateTime(-5, "09:00"));
  const extensionReason = "Gia hạn để nhà thầu hoàn thiện hồ sơ dự thầu";
  await extensionRow.locator(".gh-reason-input").fill(extensionReason);
  await page.locator("#btn-luu-thongtinmoithau").press("Enter", { noWaitAfter: true });
  await page.locator("#btn-luu-thongtinmoithau")
    .filter({ hasText: "Chỉnh sửa" })
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(async (error) => {
      const state = await page.evaluate(() => ({
        editMode: globalThis.app?.view?._biddingInfoEditMode,
        dialog: document.querySelector("#modal-custom-dialog.active")?.innerText || "",
        saveButton: (() => {
          const button = document.getElementById("btn-luu-thongtinmoithau");
          return button ? { text: button.textContent?.trim() || "", disabled: button.disabled } : null;
        })(),
        extensions: [...document.querySelectorAll("#gt-giahan-tbody tr")].map((row) => ({
          time: row.querySelector(".gh-time-input")?.value || "",
          reason: row.querySelector(".gh-reason-input")?.value || "",
          error: row.querySelector(".gh-row-error")?.textContent?.trim() || "",
        })),
      })).catch(() => ({ rendererUnresponsive: true }));
      throw new Error(`Invitation extension did not leave edit mode: ${JSON.stringify(state)}`, { cause: error });
    });
  const renderedExtensionReason = page.locator("#gt-giahan-tbody .gh-reason-input").last();
  await renderedExtensionReason.waitFor({ state: "visible", timeout: 20_000 });
  if (await renderedExtensionReason.inputValue() !== extensionReason) {
    throw new Error("Invitation extension reason was not rendered after save.");
  }
  mark("invitation-extended");
  await renewBrowserSession();
  process.stdout.write("[DEBUG-cancel-opening] open-persisted-extension\n");
  await openPackageWorkflow(cancellablePackage, "opening");
  process.stdout.write("[DEBUG-cancel-opening] persisted-extension-opened\n");
  const savedExtensionReason = page.locator("#gt-giahan-tbody .gh-reason-input").last();
  try {
    await savedExtensionReason.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      dialog: document.getElementById("modal-custom-dialog")?.innerText || "",
      dialogActive: document.getElementById("modal-custom-dialog")?.classList.contains("active") === true,
      packageStatus: globalThis.app?.view?._currentPackage?.trangThai || "",
      workflowHtml: document.getElementById("detail-workflow-content-wrapper")?.innerHTML.slice(0, 2_000) || "",
      extensionRows: document.querySelectorAll("#gt-giahan-tbody tr").length,
      activeTab: document.querySelector("[data-workflow-tab][aria-selected='true']")?.getAttribute("data-workflow-tab") || "",
      modelPackages: (globalThis.app?.model?.state?.goithau || [])
        .filter((item) => String(item?.tenGoiThau || "").includes("hủy"))
        .map((item) => ({ id: item.id, status: item.trangThai, extensionCount: item.giaHanList?.length || 0, rowVersion: item.rowVersion })),
    }));
    throw new Error(`Invitation extension was not rendered after save: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  if (await savedExtensionReason.inputValue() !== extensionReason) {
    throw new Error("Invitation extension reason was not persisted.");
  }
  await waitForRenderedWorkflowTab(page, "opening");
  process.stdout.write("[DEBUG-cancel-opening] request-opening\n");
  await page.locator('button[data-fn="moThauGoiThau"]').click();
  await page.locator("#modal-custom-dialog.active #dialog-prompt-input").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#dialog-prompt-input").fill(testClock.dateTime(-5, "10:00"));
  const cancelOpeningSync = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/sync"
      && response.ok()
  ), { timeout: 20_000 });
  await page.locator("#btn-dialog-ok").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  process.stdout.write("[DEBUG-cancel-opening] opening-dialog-closed\n");
  await cancelOpeningSync;
  process.stdout.write("[DEBUG-cancel-opening] opening-sync-complete\n");
  await renewBrowserSession();
  process.stdout.write("[DEBUG-cancel-opening] reopen-after-opening\n");
  await openPackageWorkflow(cancellablePackage, "opening");
  process.stdout.write("[DEBUG-cancel-opening] reopened-after-opening\n");
  await page.locator("#btn-mothau-save").waitFor({ state: "visible", timeout: 15_000 }).catch(async (error) => {
    const state = await page.evaluate((title) => ({
      package: (globalThis.app?.model?.state?.goithau || [])
        .filter((item) => item.tenGoiThau === title)
        .map((item) => ({ id: item.id, status: item.trangThai, openingTime: item.thoiGianMoThau, closingTime: item.thoiGianDongThau, rowVersion: item.rowVersion })),
      activeTab: document.querySelector("[data-workflow-tab][aria-selected='true']")?.getAttribute("data-workflow-tab") || "",
      tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
      content: document.getElementById("detail-workflow-content-wrapper")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 800) || "",
    }), cancellablePackage);
    throw new Error(`Cancelled-package opening panel did not render: ${JSON.stringify(state)}`, { cause: error });
  });
  await waitForRenderedWorkflowTab(page, "opening");
  const cancelOpeningRow = page.locator("#mothau-table-tbody tr").first();
  await cancelOpeningRow.locator(".mt-ma-nha-thau").fill(`${runId}-NT`);
  await cancelOpeningRow.locator(".mt-ten-nha-thau").fill(`Nhà thầu ${runId}`);
  await cancelOpeningRow.locator(".mt-gia-du-thau").fill("450000000");
  await cancelOpeningRow.locator(".mt-ty-le-giam-gia").fill("0");
  await cancelOpeningRow.locator(".mt-hieu-luc-hsdt").fill("90");
  await cancelOpeningRow.locator(".mt-gia-tri-dam-bao").fill("5000000");
  await cancelOpeningRow.locator(".mt-hieu-luc-bao-dam-ngay").fill("120");
  await cancelOpeningRow.locator(".mt-thoi-gian-thuc-hien").fill("90 ngày");
  await page.locator("#btn-mothau-save").click();
  const cancelOpeningSaveCompletion = waitForOpeningSaveCompletion(page);
  try {
    await page.locator('button[data-workflow-tab="eval_tech"]').waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const dialog = document.querySelector("#modal-custom-dialog.active");
      const saveButton = document.getElementById("btn-mothau-save");
      const selectedId = document.getElementById("mothau-goithau-select")?.value || "";
      const model = globalThis.app?.model;
      const packageRecord = model?.state?.goithau?.find?.(
        (item) => String(item.id) === String(selectedId),
      );
      return {
        dialog: dialog ? {
          title: dialog.querySelector("#dialog-title")?.textContent?.trim() || "",
          message: dialog.querySelector("#dialog-message")?.textContent?.trim() || "",
        } : null,
        toasts: [...document.querySelectorAll(".bf-toast:not(.toast-hiding)")]
          .map((toast) => toast.textContent?.trim() || ""),
        saveButton: saveButton ? {
          text: saveButton.textContent?.trim() || "",
          disabled: saveButton.disabled,
          busy: saveButton.dataset.openingSaveBusy || "",
        } : null,
        selectedId,
        packageRecord: packageRecord ? {
          id: packageRecord.id,
          status: packageRecord.trangThai,
          rowVersion: packageRecord.rowVersion,
          syncVersion: packageRecord.syncVersion,
          openingTime: packageRecord.thoiGianMoThau,
        } : null,
        openingRows: (model?.state?.thongtinmothau || [])
          .filter((item) => String(item.goiThauId) === String(selectedId))
          .map((item) => ({ id: item.id, rowVersion: item.rowVersion, syncVersion: item.syncVersion })),
        activeTab: document.querySelector("[data-workflow-tab][aria-selected='true']")
          ?.getAttribute("data-workflow-tab") || "",
      };
    });
    throw new Error(`Cancel-package opening save did not advance: ${JSON.stringify({
      diagnostics,
      recentApiTraffic,
      recentHttpErrors: httpErrors.slice(-8),
      recentPageErrors: pageErrors.slice(-8),
    })}`, { cause: error });
  }
  await cancelOpeningSaveCompletion;
  await page.locator("#btn-workflow-cancel-package").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#btn-workflow-cancel-package").click();
  await page.locator("#cancel-dec-no").fill(`${runId}/QD-HUY`);
  await page.locator("#cancel-dec-date").fill(testClock.date(-4));
  await page.locator("#cancel-reason").fill("Thay đổi nhu cầu mua sắm theo quyết định của chủ đầu tư");
  await page.locator("#btn-save-cancel-details").click({ force: true, noWaitAfter: true });
  await waitForPageCondition(page, () => {
    const dialogTitle = document.querySelector("#modal-custom-dialog.active #dialog-title")
      ?.textContent?.trim() || "";
    return dialogTitle === "Thành công"
      || document.getElementById("cancel-dec-no")?.disabled === true;
  }, null, { timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      dialog: document.querySelector("#modal-custom-dialog.active")?.innerText || "",
      saveButton: (() => {
        const button = document.getElementById("btn-save-cancel-details");
        return button ? { disabled: button.disabled, text: button.textContent?.trim() || "" } : null;
      })(),
      cancellation: (() => {
        const pkg = globalThis.app?.view?._currentPackage;
        return pkg ? {
          status: pkg.trangThai,
          decisionNumber: pkg.soQuyetDinhHuy,
          reason: pkg.lyDoHuy,
        } : null;
      })(),
    })).catch(() => ({ rendererUnresponsive: true }));
    throw new Error(`Package cancellation did not finish rendering: ${JSON.stringify(state)}`, { cause: error });
  });
  if (await page.locator("#modal-custom-dialog.active #dialog-title", { hasText: "Thành công" }).count()) {
    await confirmDialog(page);
  }
  await page.locator("#cancel-dec-no[disabled]").waitFor({ state: "visible", timeout: 20_000 });
  await renewBrowserSession();
  await openPackageWorkflow(cancellablePackage, "cancel");
  await page.locator("#cancel-dec-no[disabled]").waitFor({ state: "visible", timeout: 20_000 });
  mark("package-cancelled");

  await gotoReady(page, `${baseURL}/goi-thau`);
  await waitForApp(page);
  await page.locator("#btn-add-goithau").click();
  await page.locator("#modal-goithau.active").waitFor({ state: "visible", timeout: 10_000 });
  await select(page, "#gt-kehoachid", { label: `Kế hoạch ${runId}` });
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#btn-dialog-ok").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  await page.locator("#gt-ma").fill(`${runId}-GT-REBID`);
  await page.locator("#gt-ten").fill(`Gói đấu thầu lại ${runId}`);
  await page.locator("#form-goithau button[type='submit']").click();
  await page.locator("#modal-goithau.active").waitFor({ state: "hidden", timeout: 20_000 });
  await page.locator("#search-goithau").fill(`Gói đấu thầu lại ${runId}`);
  await waitForVisibleRowText(page, "#goithau-table tbody tr", `Gói đấu thầu lại ${runId}`);
  mark("package-rebid-created");

  await page.locator("#search-goithau").fill(twoEnvelopePackage);
  await page.getByText(twoEnvelopePackage, { exact: true }).click();
  await page.locator('button[data-workflow-tab="preparation_action"]').click();
  await page.locator('button[data-fn="phatHanhHsmtGoiThau"]').click();
  await page.locator("#modal-phathanh-hsmt.active").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#phathanh-magoithau").fill(`${runId}-GT-2T`);
  await page.locator("#phathanh-sototrinh").fill(`${runId}/TTR-2T`);
  await page.locator("#phathanh-ngaytrinh").fill(testClock.date(-11));
  await page.locator("#phathanh-soquyetdinh").fill(`${runId}/QD-2T-HSMT`);
  await page.locator("#phathanh-ngayquyetdinh").fill(testClock.date(-10));
  await page.locator('input[name="phathanh-yeucauthamdinh"][value="NOT_REQUIRED"]').check();
  await page.locator("#phathanh-thoigiandangtai").fill(testClock.dateTime(-9, "08:00"));
  await page.locator("#phathanh-thoigiandongthau").fill(testClock.dateTime(-3, "09:00"));
  await page.locator("#phathanh-giatribaomothau").fill("5000000");
  await page.locator("#phathanh-hieuluchsdt").fill("90");
  await page.locator("#btn-confirm-phathanh").click();
  await confirmDialog(page);
  await page.locator("#modal-phathanh-hsmt.active").waitFor({ state: "hidden", timeout: 15_000 });
  await page.locator('button[data-fn="moThauGoiThau"]').click();
  await page.locator("#dialog-prompt-input").fill(testClock.dateTime(-3, "10:00"));
  await page.locator("#btn-dialog-ok").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  await page.locator("#btn-mothau-save").waitFor({ state: "visible", timeout: 15_000 });
  await waitForRenderedWorkflowTab(page, "opening_tech");
  const technicalOpeningRow = page.locator("#mothau-table-tbody tr").first();
  await technicalOpeningRow.locator(".mt-ma-nha-thau").fill(`${runId}-NT`);
  await technicalOpeningRow.locator(".mt-ten-nha-thau").fill(`Nhà thầu ${runId}`);
  await technicalOpeningRow.locator(".mt-dam-bao-du-thau").fill("5000000");
  await technicalOpeningRow.locator(".mt-hieu-luc-dam-bao").fill("120");
  await technicalOpeningRow.locator(".mt-hieu-luc-hsdxt").fill("90");
  await page.locator("#btn-mothau-save").click();
  const technicalOpeningSaveCompletion = waitForOpeningSaveCompletion(page);
  await page.locator('button[data-workflow-tab="eval_tech"]').waitFor({ state: "visible", timeout: 20_000 });
  await technicalOpeningSaveCompletion;
  await page.locator('button[data-workflow-tab="eval_tech"]').click();
  await waitForRenderedWorkflowTab(page, "eval_tech");
  mark("two-envelope-technical-opening-saved");
  await renewBrowserSession();
  await openPackageWorkflow(twoEnvelopePackage, "eval_tech");

  const technicalEvaluationRow = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").first();
  await technicalEvaluationRow.waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      packageId: document.getElementById("danhgiahsdt-goithau-select")?.value || "",
      openingRows: [...document.querySelectorAll("#mothau-table-tbody tr")].map((row) => ({
        bidId: row.getAttribute("data-bid-id") || "",
        contractor: row.querySelector(".mt-ma-nha-thau")?.value || "",
      })),
      evaluationRows: document.querySelectorAll("#danhgiahsdt-table-tbody tr").length,
      content: document.getElementById("detail-workflow-content-wrapper")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 500) || "",
    }));
    throw new Error(`Technical evaluation row did not render: ${JSON.stringify({ state, pageErrors, httpErrors, recentApiTraffic })}; ${error.message}`);
  });
  await ensureSelectedValue(page, "#danhgiahsdt-table-tbody .mt-dg-hop-le", "Đạt").catch(async (error) => {
    const state = await page.evaluate(() => {
      const wrapper = document.getElementById("detail-workflow-content-wrapper");
      const controls = [...document.querySelectorAll("#danhgiahsdt-table-tbody .mt-dg-hop-le")];
      return {
        packageId: document.getElementById("danhgiahsdt-goithau-select")?.value || "",
        activeWorkflowTab: document.querySelector("[data-workflow-tab][aria-selected='true']")
          ?.getAttribute("data-workflow-tab") || "",
        controls: controls.map((control) => ({
          connected: control.isConnected,
          disabled: control.disabled,
          hidden: control.hidden,
          value: control.value,
          options: [...control.options].map((option) => ({
            label: option.label,
            value: option.value,
            disabled: option.disabled,
            selected: option.selected,
          })),
        })),
        wrapper: wrapper ? {
          pendingRenderVersion: wrapper.dataset.pendingRenderVersion || "",
          renderedRenderVersion: wrapper.dataset.renderedRenderVersion || "",
          renderedWorkflowTab: wrapper.dataset.renderedWorkflowTab || "",
        } : null,
      };
    });
    throw new Error(`Technical evaluation validity selector was not editable: ${JSON.stringify({
      state,
      pageErrors: pageErrors.slice(-8),
      httpErrors: httpErrors.slice(-8),
      recentApiTraffic,
    })}; ${error.message}`, { cause: error });
  });
  await ensureSelectedValue(page, "#danhgiahsdt-table-tbody .mt-dg-nang-luc", "Đạt");
  await technicalEvaluationRow.locator(".mt-dg-ky-thuat").fill("Đạt");
  await waitForPageCondition(page, () => {
    const row = document.querySelector("#danhgiahsdt-table-tbody tr[data-bid-id]");
    return row?.querySelector(".mt-dg-ky-thuat")?.value === "Đạt"
      && row.querySelector(".mt-ketluan-cell")?.textContent?.trim() === "Đạt";
  }, null, { timeout: 10_000 });
  await page.locator("#danhgiahsdt-so-baocao").fill(`${runId}/BC-DG-KT`);
  await page.locator("#danhgiahsdt-ngay-baocao").fill(testClock.date(-2));
  const technicalEvaluationSubmission = await page.evaluate(() => ({
    packageId: document.getElementById("danhgiahsdt-goithau-select")?.value || "",
    reportNumber: document.getElementById("danhgiahsdt-so-baocao")?.value || "",
    reportDate: document.getElementById("danhgiahsdt-ngay-baocao")?.value || "",
    technical: document.querySelector("#danhgiahsdt-table-tbody .mt-dg-ky-thuat")?.value || "",
    conclusion: document.querySelector("#danhgiahsdt-table-tbody .mt-ketluan-cell")?.textContent?.trim() || "",
  }));
  await page.locator("#btn-danhgiahsdt-save").click();
  await page.locator('button[data-workflow-tab="qualified"]').waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
      evaluation: [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")].map((row) => ({
        bidId: row.getAttribute("data-bid-id"),
        validity: row.querySelector(".mt-dg-hop-le")?.value || "",
        capacity: row.querySelector(".mt-dg-nang-luc")?.value || "",
        technical: row.querySelector(".mt-dg-ky-thuat")?.value || "",
        conclusion: row.querySelector(".mt-ketluan-cell")?.textContent?.trim() || "",
      })),
      content: document.getElementById("detail-workflow-content-wrapper")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 700) || "",
    }));
    throw new Error(`Technical evaluation did not expose qualified approval: ${JSON.stringify({ technicalEvaluationSubmission, state, pageErrors, httpErrors })}; ${error.message}`);
  });
  await page.locator('button[data-workflow-tab="qualified"]').click();
  await waitForRenderedWorkflowTab(page, "qualified");
  await page.locator("#qualified-so-bctd").waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      selectedTab: document.querySelector('[data-workflow-tab][aria-selected="true"]')?.getAttribute("data-workflow-tab") || "",
      tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => ({
        id: item.getAttribute("data-workflow-tab"),
        selected: item.getAttribute("aria-selected") === "true",
      })),
      content: document.getElementById("detail-workflow-content-wrapper")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 1000) || "",
      dialog: document.querySelector("#modal-custom-dialog.active #dialog-message")?.textContent?.trim() || "",
    }));
    throw new Error(`Qualified approval panel did not become active: ${JSON.stringify({ state, pageErrors, httpErrors })}; ${error.message}`);
  });
  mark("two-envelope-technical-evaluation-saved");
  await restartBrowserSession();
  await openPackageWorkflow(twoEnvelopePackage, "qualified");

  await page.locator("#qualified-ngay-bctd").fill(testClock.date(-1));
  await page.locator("#qualified-ngay-qd").fill(testClock.date(0));
  await page.locator("#qualified-so-bctd").fill(`${runId}/BC-TD-KT`);
  await page.locator("#qualified-so-qd").fill(`${runId}/QD-KT`);
  await waitForPageCondition(page, ({ reportNumber, reportDate, decisionNumber, decisionDate }) => (
    document.getElementById("qualified-so-bctd")?.value === reportNumber
      && document.getElementById("qualified-ngay-bctd")?.value === reportDate
      && document.getElementById("qualified-so-qd")?.value === decisionNumber
      && document.getElementById("qualified-ngay-qd")?.value === decisionDate
  ), {
    reportNumber: `${runId}/BC-TD-KT`,
    reportDate: testClock.date(-1),
    decisionNumber: `${runId}/QD-KT`,
    decisionDate: testClock.date(0),
  }, { timeout: 10_000 }).catch(async (error) => {
    const values = await page.evaluate(() => ["qualified-so-bctd", "qualified-ngay-bctd", "qualified-so-qd", "qualified-ngay-qd"]
      .map((id) => ({ id, value: document.getElementById(id)?.value || "", storageValue: document.getElementById(id)?._flatpickr?.input?.value || "" })));
    throw new Error(`Qualified approval fields were not stable: ${JSON.stringify(values)}`, { cause: error });
  });
  await page.locator("#btn-save-qualified-decision").click();
  await page.locator("#op-fin-thoigianmothau").waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
      fields: ["qualified-so-bctd", "qualified-ngay-bctd", "qualified-so-qd", "qualified-ngay-qd"].map((id) => ({ id, value: document.getElementById(id)?.value || "", invalid: document.getElementById(id)?.getAttribute("aria-invalid") || "" })),
      button: (() => { const item = document.getElementById("btn-save-qualified-decision"); return item ? { disabled: item.disabled, hasHandler: Boolean(item.onclick) } : null; })(),
      content: document.getElementById("detail-workflow-content-wrapper")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 500) || "",
    }));
    throw new Error(`Qualified approval did not advance: ${JSON.stringify({ state, pageErrors, httpErrors })}; ${error.message}`);
  });
  mark("two-envelope-qualified-approved");
  await renewBrowserSession();
  await openPackageWorkflow(twoEnvelopePackage, "opening_fin");

  await page.locator("#op-fin-thoigianmothau").fill(testClock.dateTime(1, "10:00"));
  const financialOpeningRow = page.locator("#opening-fin-table tbody tr").first();
  await financialOpeningRow.locator(".op-gia-du-thau").fill("450000000");
  await financialOpeningRow.locator(".op-ty-le-giam").fill("1");
  await page.locator("#btn-save-opening-fin").click();
  await page.locator("#danhgiahsdt-table-tbody .mt-gia-xep-hang").waitFor({ state: "visible", timeout: 20_000 });
  mark("two-envelope-financial-opening-saved");
  await renewBrowserSession();
  await openPackageWorkflow(twoEnvelopePackage, "eval_fin");

  await page.locator("#danhgiahsdt-so-baocao").fill(`${runId}/BC-DG-TC`);
  await page.locator("#danhgiahsdt-ngay-baocao").fill(testClock.date(2));
  const financialEvaluationRow = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").first();
  await financialEvaluationRow.locator(".mt-gia-xep-hang").fill("445500000");
  await financialEvaluationRow.locator(".mt-gia-de-nghi-trung-thau").fill("445500000");
  const automaticRanking = financialEvaluationRow.locator(".mt-dg-tai-chinh");
  if (await automaticRanking.count()) {
    const tagName = await automaticRanking.evaluate((element) => element.tagName);
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tagName)) {
      throw new Error("Automatic ranking must be display-only");
    }
    const rankingElement = await automaticRanking.elementHandle();
    await waitForPageCondition(
      page,
      (element) => String(element?.textContent || "").includes("Xếp hạng"),
      rankingElement,
      { timeout: 5_000 },
    );
    if (!(await automaticRanking.innerText()).includes("Xếp hạng")) {
      throw new Error("Automatic ranking was not calculated");
    }
  }
  await page.locator("#btn-danhgiahsdt-save").click();
  await page.locator('button[data-workflow-tab="result"]').waitFor({ state: "visible", timeout: 20_000 });
  await page.locator('button[data-workflow-tab="result"]').click();
  await page.locator("#award-so-bctd").waitFor({ state: "visible", timeout: 20_000 });
  mark("two-envelope-financial-evaluation-saved");
  await renewBrowserSession();
  await openPackageWorkflow(twoEnvelopePackage, "result");

  await page.locator("#award-so-bctd").fill(`${runId}/BC-TD-2T-KQ`);
  await page.locator("#award-ngay-bctd").fill(testClock.date(3));
  await page.locator("#award-decision-no").fill(`${runId}/QD-2T-KQ`);
  await page.locator("#award-decision-date").fill(testClock.date(4));
  const twoEnvelopeAwardRow = page.locator("#approve-bidders-tbody tr[data-approve-bid-id]").first();
  await select(page, "#approve-bidders-tbody .row-status-select", "trung");
  await twoEnvelopeAwardRow.locator(".row-gia-trung").fill("445500000");
  await twoEnvelopeAwardRow.locator(".row-tg-goithau").fill("90 ngày");
  await twoEnvelopeAwardRow.locator(".row-tg-hopdong").fill("90 ngày và nghĩa vụ bảo hành");
  await page.locator("#btn-approve-award").click();
  await page.locator(".award-result-card").waitFor({ state: "visible", timeout: 20_000 });
  mark("two-envelope-award-approved");

  await restartBrowserSession();
  await openPackageWorkflow(lotPackage, "preparation_action");
  await page.locator('button[data-workflow-tab="preparation_action"]').click();
  await page.locator('button[data-fn="phatHanhHsmtGoiThau"]').click();
  await page.locator("#modal-phathanh-hsmt.active").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#phathanh-magoithau").fill(`${runId}-GT-LOT`);
  await page.locator("#phathanh-sototrinh").fill(`${runId}/TTR-LOT`);
  await page.locator("#phathanh-ngaytrinh").fill(testClock.date(-11));
  await page.locator("#phathanh-soquyetdinh").fill(`${runId}/QD-LOT-HSMT`);
  await page.locator("#phathanh-ngayquyetdinh").fill(testClock.date(-10));
  await page.locator('input[name="phathanh-yeucauthamdinh"][value="NOT_REQUIRED"]').check();
  await page.locator("#phathanh-thoigiandangtai").fill(testClock.dateTime(-9, "08:00"));
  await page.locator("#phathanh-thoigiandongthau").fill(testClock.dateTime(5, "09:00"));
  await page.locator("#phathanh-hieuluchsdt").fill("90");
  const lotSecurityRows = page.locator("#phathanh-phanlo-baodam-tbody tr");
  if (await lotSecurityRows.count() !== 2) throw new Error("Expected two lot security rows.");
  await lotSecurityRows.nth(0).locator(".phathanh-pl-baodam-input").fill("5000000");
  await lotSecurityRows.nth(1).locator(".phathanh-pl-baodam-input").fill("5000000");
  await page.locator("#btn-confirm-phathanh").click();
  await confirmDialog(page);
  await page.locator("#modal-phathanh-hsmt.active").waitFor({ state: "hidden", timeout: 15_000 });
  await page.locator('button[data-fn="moThauGoiThau"]').click();
  await page.locator("#dialog-prompt-input").fill(testClock.dateTime(5, "10:00"));
  const lotOpeningSync = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/sync"
      && response.ok()
  ), { timeout: 20_000 });
  await page.locator("#btn-dialog-ok").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  await lotOpeningSync;
  await page.locator("#btn-mothau-save").waitFor({ state: "visible", timeout: 15_000 }).catch(async (error) => {
    const browserState = await page.evaluate((expectedName) => {
      const pkg = globalThis.app?.model?.state?.goithau?.find?.(
        (item) => item.tenGoiThau === expectedName,
      );
      return {
        package: pkg ? {
          id: pkg.id,
          rowVersion: pkg.rowVersion,
          trangThai: pkg.trangThai,
          phuongThucLuaChon: pkg.phuongThucLuaChon,
          thoiGianMoThau: pkg.thoiGianMoThau,
        } : null,
        activeTab: document.querySelector("[data-workflow-tab][aria-selected='true']")
          ?.getAttribute("data-workflow-tab") || "",
        tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((tab) => ({
          id: tab.getAttribute("data-workflow-tab") || "",
          selected: tab.getAttribute("aria-selected") || "",
          visible: Boolean(tab.getClientRects().length),
        })),
        workflowText: document.getElementById("detail-workflow-content-wrapper")
          ?.innerText?.slice(0, 1200) || "",
        dialogText: document.querySelector("#modal-custom-dialog.active")?.innerText || "",
        toasts: [...document.querySelectorAll(".bf-toast:not(.toast-hiding)")]
          .map((toast) => toast.textContent?.trim() || ""),
      };
    }, twoEnvelopePackage);
    throw new Error(`Two-envelope opening panel did not render: ${JSON.stringify({
      browserState,
      recentHttpErrors: httpErrors.slice(-8),
      pageErrors: pageErrors.slice(-8),
    })}; ${error.message}`);
  });
  await waitForPageCondition(page, () => (
    document.getElementById("detail-workflow-status-badge")?.textContent?.includes("Đã mở thầu")
  ), null, { timeout: 15_000 });
  await waitForRenderedWorkflowTab(page, "opening");

  while (await page.locator("#mothau-table-tbody tr").count() < 2) {
    await page.locator("#btn-mothau-add-bid").click();
  }
  for (const [index, lotCode, price] of [[0, "PP01", "240000000"], [1, "PP02", "230000000"]]) {
    const row = page.locator("#mothau-table-tbody tr").nth(index);
    await select(page, `#mothau-table-tbody tr:nth-child(${index + 1}) .mt-ma-phan-lo`, lotCode);
    await row.locator(".mt-ma-nha-thau").fill(`${runId}-NT`);
    await row.locator(".mt-ten-nha-thau").fill(`Nhà thầu ${runId}`);
    await row.locator(".mt-gia-du-thau").fill(price);
    await row.locator(".mt-ty-le-giam-gia").fill("0");
    await row.locator(".mt-hieu-luc-hsdt").fill("90");
    await row.locator(".mt-gia-tri-dam-bao").fill("5000000");
    await row.locator(".mt-hieu-luc-bao-dam-ngay").fill("120");
    await row.locator(".mt-thoi-gian-thuc-hien").fill("90 ngày");
  }
  await page.locator("#btn-mothau-save").click();
  const lotOpeningSaveCompletion = waitForOpeningSaveCompletion(page);
  await page.locator('button[data-workflow-tab="eval_tech"]').waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      dialogTitle: document.querySelector("#modal-custom-dialog.active #dialog-title")?.textContent || "",
      dialogMessage: document.querySelector("#modal-custom-dialog.active #dialog-message")?.textContent || "",
      tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
      rows: [...document.querySelectorAll("#mothau-table-tbody tr")].map((row) => ({
        lot: row.querySelector(".mt-ma-phan-lo")?.value || "",
        contractorCode: row.querySelector(".mt-ma-nha-thau")?.value || "",
        contractorName: row.querySelector(".mt-ten-nha-thau")?.value || "",
        price: row.querySelector(".mt-gia-du-thau")?.value || "",
      })),
    }));
    throw new Error(`Lot opening did not advance: ${JSON.stringify({ state, pageErrors, httpErrors })}; ${error.message}`);
  });
  await lotOpeningSaveCompletion;
  await renewBrowserSession();
  await openPackageWorkflow(lotPackage, "eval_tech");
  mark("lot-opening-saved", { lots: 2 });

  const evaluateCurrentLot = async ({ lotCode, reportSuffix, price }) => {
    const selectedMode = page.locator('input[name="danhgiahsdt-scope-mode"][value="selected"]');
    if (await selectedMode.count()) {
      await selectedMode.check();
      const optionLabels = page.locator("#danhgiahsdt-lot-options label");
      for (const optionText of await optionLabels.allTextContents()) {
        if (optionText.includes(lotCode)) continue;
        const unwanted = page.locator("#danhgiahsdt-lot-options label")
          .filter({ hasText: optionText.trim() })
          .locator("input");
        if (await unwanted.isChecked()) await unwanted.uncheck();
      }
      const lotChoice = page.locator("#danhgiahsdt-lot-options label").filter({ hasText: lotCode }).locator("input");
      await lotChoice.waitFor({ state: "visible", timeout: 10_000 });
      if (!await lotChoice.isChecked()) await lotChoice.check();
    }
    const row = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").filter({ hasText: lotCode }).first();
    await waitForPageCondition(page, (code) => {
      const selectedLotInputs = [...document.querySelectorAll("#danhgiahsdt-lot-options [data-evaluation-lot-id]:checked")];
      const selectedCurrentLot = selectedLotInputs.length === 1
        && selectedLotInputs[0].closest("label")?.textContent?.includes(code);
      const rows = [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")];
      const candidate = rows.find((item) => item.textContent?.includes(code));
      return selectedCurrentLot
        && rows.length === 1
        && [".mt-dg-hop-le", ".mt-dg-nang-luc", ".mt-dg-ky-thuat"].every((selector) => {
          const control = candidate?.querySelector(selector);
          return control && !control.disabled;
        });
    }, lotCode, { timeout: 15_000 }).catch(async (error) => {
      const state = await page.evaluate((code) => ({
        tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
          selectedLot: [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")]
          .filter((item) => item.textContent?.includes(code))
          .map((item) => ({
            disabled: item.querySelector(".mt-dg-hop-le")?.disabled ?? null,
            validityDisabled: item.querySelector(".mt-dg-hop-le")?.disabled ?? null,
            capacityDisabled: item.querySelector(".mt-dg-nang-luc")?.disabled ?? null,
            technicalDisabled: item.querySelector(".mt-dg-ky-thuat")?.disabled ?? null,
            validity: item.querySelector(".mt-dg-hop-le")?.value || "",
            capacity: item.querySelector(".mt-dg-nang-luc")?.value || "",
            technical: item.querySelector(".mt-dg-ky-thuat")?.value || "",
            conclusion: item.querySelector(".mt-ketluan-cell")?.textContent?.trim() || "",
          })),
        selectedLots: [...document.querySelectorAll("#danhgiahsdt-lot-options [data-evaluation-lot-id]:checked")]
          .map((item) => ({ id: item.getAttribute("data-evaluation-lot-id"), label: item.closest("label")?.textContent?.trim() || "" })),
        save: (() => {
          const item = document.getElementById("btn-danhgiahsdt-save");
          return item ? { text: item.textContent?.trim() || "", hidden: item.hidden, disabled: item.disabled } : null;
        })(),
        report: (() => {
          const item = document.getElementById("danhgiahsdt-so-baocao");
          return item ? { readOnly: item.readOnly, disabled: item.disabled } : null;
        })(),
        scope: document.getElementById("danhgiahsdt-scope-feedback")?.textContent?.trim() || "",
        content: document.getElementById("detail-workflow-content-wrapper")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 1000) || "",
      }), lotCode);
      throw new Error(`Lot evaluation row stayed read-only: ${JSON.stringify({ state, pageErrors, httpErrors })}; ${error.message}`);
    });
    await page.locator("#danhgiahsdt-so-baocao").fill(`${runId}/BC-${reportSuffix}`);
    await page.locator("#danhgiahsdt-ngay-baocao").fill(reportSuffix === "LOT-1" ? testClock.date(6) : testClock.date(9));
    // Fresh evaluation rows default validity and capacity to “Đạt”. Re-selecting
    // those enhanced controls can race their progressive enablement; entering
    // the technical result is the user action that completes this row.
    await row.locator(".mt-dg-ky-thuat").fill("Đạt");
    await waitForPageCondition(page, (code) => {
      const candidate = [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")]
        .find((item) => item.textContent?.includes(code));
      return candidate?.querySelector(".mt-dg-ky-thuat")?.value === "Đạt"
        && candidate.querySelector(".mt-ketluan-cell")?.textContent?.trim() === "Đạt";
    }, lotCode, { timeout: 10_000 });
    if (await row.locator(".mt-gia-xep-hang").count()) await row.locator(".mt-gia-xep-hang").fill(price);
    if (await row.locator(".mt-gia-de-nghi-trung-thau").count()) await row.locator(".mt-gia-de-nghi-trung-thau").fill(price);
    const lowPriceAcceptance = row.locator('.mt-low-price-acceptance[value="true"]');
    if (await lowPriceAcceptance.isVisible()) {
      await lowPriceAcceptance.check();
    }
    await page.locator("#btn-danhgiahsdt-save").click();
    await page.locator('button[data-workflow-tab="result"]').waitFor({ state: "visible", timeout: 20_000 });
    await page.locator('button[data-workflow-tab="result"]').click();
    await page.locator("#award-so-bctd").waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
      const state = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
        evaluation: [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")].map((row) => ({
          bidId: row.getAttribute("data-bid-id"),
          lotCode: row.querySelector(".mt-ma-phan-lo")?.value || row.textContent?.trim() || "",
          validity: row.querySelector(".mt-dg-hop-le")?.value || "",
          capacity: row.querySelector(".mt-dg-nang-luc")?.value || "",
          technical: row.querySelector(".mt-dg-ky-thuat")?.value || "",
          conclusion: row.querySelector(".mt-ketluan-cell")?.textContent?.trim() || "",
        })),
        content: document.getElementById("detail-workflow-content-wrapper")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 1000) || "",
      }));
      throw new Error(`Lot evaluation did not expose award approval: ${JSON.stringify({ state, pageErrors, httpErrors })}; ${error.message}`);
    });
  };

  const approveCurrentLot = async ({ sequence, price }) => {
    await page.locator("#award-so-bctd").fill(`${runId}/BC-TD-LOT-${sequence}`);
    await page.locator("#award-ngay-bctd").fill(sequence === 1 ? testClock.date(7) : testClock.date(10));
    await page.locator("#award-decision-no").fill(`${runId}/QD-LOT-${sequence}`);
    await page.locator("#award-decision-date").fill(sequence === 1 ? testClock.date(8) : testClock.date(11));
    const row = page.locator("#approve-bidders-tbody tr[data-approve-bid-id]").first();
    await row.locator(".row-status-select").selectOption("trung", { force: true });
    await row.locator(".row-gia-trung").fill(price);
    await row.locator(".row-tg-goithau").fill("90 ngày");
    await row.locator(".row-tg-hopdong").fill("90 ngày và nghĩa vụ bảo hành");
    await page.locator("#btn-approve-award").click();
    await page.locator(".evaluation-round-card").waitFor({ state: "visible", timeout: 20_000 });
  };

  await evaluateCurrentLot({ lotCode: "PP01", reportSuffix: "LOT-1", price: "240000000" });
  await approveCurrentLot({ sequence: 1, price: "240000000" });
  await page.getByText("Còn 1 phần lô chưa có kết quả", { exact: false }).waitFor({ state: "visible", timeout: 20_000 });
  mark("lot-first-batch-approved");

  await renewBrowserSession();
  await openPackageWorkflow(lotPackage, "eval_tech");
  await page.locator("#btn-continue-lot-evaluation").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("#btn-continue-lot-evaluation").click();
  await page.locator("#danhgiahsdt-so-baocao").waitFor({ state: "visible", timeout: 15_000 });
  await evaluateCurrentLot({ lotCode: "PP02", reportSuffix: "LOT-2", price: "230000000" });
  await approveCurrentLot({ sequence: 2, price: "230000000" });
  await page.locator('button[data-workflow-tab="result"]').waitFor({ state: "visible", timeout: 20_000 });
  if (await page.locator('button[data-workflow-tab="result"]').getAttribute("aria-selected") !== "true") {
    await page.locator('button[data-workflow-tab="result"]').click();
  }
  await page.locator(".award-result-card").waitFor({ state: "visible", timeout: 20_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      url: location.href,
      statusBadge: document.getElementById("detail-workflow-status-badge")?.textContent?.trim() || "",
      activeTab: document.querySelector("[data-workflow-tab][aria-selected='true']")
        ?.getAttribute("data-workflow-tab") || "",
      tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((tab) => ({
        name: tab.getAttribute("data-workflow-tab"),
        visible: Boolean(tab.getClientRects().length),
      })),
      rounds: [...document.querySelectorAll(".evaluation-round-card")]
        .map((card) => card.textContent?.trim().replace(/\s+/g, " ").slice(0, 500) || ""),
      resultCards: document.querySelectorAll(".award-result-card").length,
      content: document.getElementById("detail-workflow-content-wrapper")
        ?.textContent?.trim().replace(/\s+/g, " ").slice(0, 2_000) || "",
      package: (() => {
        const packageId = globalThis.app?.view?._currentWorkflowPackageId || "";
        const record = globalThis.app?.model?.state?.goithau?.find?.(
          (item) => String(item.id) === String(packageId),
        );
        return record ? {
          id: record.id,
          status: record.trangThai,
          rowVersion: record.rowVersion,
          result: record.ketQuaLuaChonNhaThau || record.ketQua || null,
        } : null;
      })(),
    })).catch(() => ({ rendererUnresponsive: true }));
    throw new Error(`Final lot result was not rendered: ${JSON.stringify({ state, recentApiTraffic: recentApiTraffic.slice(-25), httpErrors: httpErrors.slice(-8), pageErrors: pageErrors.slice(-8) })}`, { cause: error });
  });
  const finalLotStatus = (await page.locator("#detail-workflow-status-badge").innerText()).trim();
  if (!finalLotStatus.includes("Đã có kết quả")) throw new Error(`Unexpected final lot status: ${finalLotStatus}`);
  if (await page.locator(".evaluation-round-card").count() !== 2) throw new Error("Expected two official lot result rounds.");
  mark("lot-second-batch-approved", { finalStatus: finalLotStatus, rounds: 2 });

  await restartBrowserSession();
  await gotoReady(page, `${baseURL}/ke-hoach`);
  await waitForApp(page);
  await page.locator("#search-kehoach").fill(`Kế hoạch ${runId}`);
  const historicalPlanRow = page.locator("#kehoach-table tbody tr").filter({ hasText: `Kế hoạch ${runId}` });
  await historicalPlanRow.first().waitFor({ state: "visible", timeout: 15_000 });
  if (await historicalPlanRow.count() !== 1) throw new Error("Expected one plan row before versioning.");
  await historicalPlanRow.locator('[data-bf-action="show-plan"]').click();
  await page.locator("#fullpage-kh-version-select").waitFor({ state: "attached", timeout: 15_000 });
  const historicalPlanId = await page.locator("#fullpage-kh-version-select").inputValue();
  await page.locator("#btn-edit-kehoach-fullpage").click();
  await page.locator("#modal-kehoach.active").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#kh-thoigiandang").fill(testClock.dateTime(-36, "08:00"));
  await page.locator("#form-kehoach button[type='submit']").click();
  await page.locator("#modal-plan-breakdown.active").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#btn-save-plan-breakdown").click();
  await page.locator("#modal-plan-breakdown.active").waitFor({ state: "hidden", timeout: 30_000 }).catch(async (error) => {
    const failureState = await page.evaluate(() => ({
      dialogTitle: document.querySelector("#modal-custom-dialog.active #dialog-title")?.textContent || "",
      dialogMessage: document.querySelector("#modal-custom-dialog.active #dialog-message")?.textContent || "",
      saveDisabled: document.querySelector("#btn-save-plan-breakdown")?.disabled || false,
    }));
    throw new Error(`Plan snapshot save did not finish: ${JSON.stringify({ failureState, pageErrors, httpErrors })}; ${error.message}`);
  });
  const planSaveDialog = page.locator("#modal-custom-dialog.active");
  if (await planSaveDialog.isVisible().catch(() => false)) {
    await page.locator("#btn-dialog-ok").click();
    await planSaveDialog.waitFor({ state: "hidden", timeout: 10_000 });
  }

  await gotoReady(page, `${baseURL}/ke-hoach`);
  await waitForApp(page);
  await page.locator("#search-kehoach").fill(`Kế hoạch ${runId}`);
  const latestPlanRow = page.locator("#kehoach-table tbody tr").filter({ hasText: `Kế hoạch ${runId}` });
  await latestPlanRow.first().waitFor({ state: "visible", timeout: 15_000 });
  if (await latestPlanRow.count() !== 1) throw new Error("Expected one plan row after versioning.");
  await latestPlanRow.locator('[data-bf-action="show-plan"]').click();
  await page.locator("#fullpage-kh-version-select").waitFor({ state: "attached", timeout: 15_000 });
  const planVersionState = await page.locator("#fullpage-kh-version-select").evaluate((selectElement) => ({
    value: selectElement.value,
    options: [...selectElement.options].map((option) => ({ value: option.value, text: option.textContent })),
  }));
  if (planVersionState.options.length !== 2) {
    throw new Error(`Expected two plan versions, got ${JSON.stringify(planVersionState)}`);
  }
  const latestPlanId = planVersionState.value;
  if (!historicalPlanId || !latestPlanId || historicalPlanId === latestPlanId) {
    throw new Error(`Plan version identifiers are invalid: ${JSON.stringify({ historicalPlanId, latestPlanId })}`);
  }

  const inheritedSnapshot = await page.evaluate(async ({ historicalPlanId: oldPlanId, latestPlanId: newPlanId, packageCode, contractNumber }) => {
    const readPage = async (table, extra = {}) => {
      const query = new URLSearchParams({ table, pageSize: "500", ...extra });
      const response = await fetch(`/api/paginate?${query}`);
      if (!response.ok) throw new Error(`${table} pagination failed: ${response.status}`);
      return response.json();
    };
    const [
      oldPackages,
      newPackages,
      oldGoods,
      newGoods,
      oldOpenings,
      newOpenings,
      contracts,
    ] = await Promise.all([
      readPage("goithau", { keHoachId: oldPlanId }),
      readPage("goithau", { keHoachId: newPlanId }),
      readPage("goithauhanghoa", { keHoachId: oldPlanId }),
      readPage("goithauhanghoa", { keHoachId: newPlanId }),
      readPage("thongtinmothau", { keHoachId: oldPlanId }),
      readPage("thongtinmothau", { keHoachId: newPlanId }),
      readPage("hopdong"),
    ]);
    const byCode = (items) => items.find((item) => item.maGoiThau === packageCode);
    const oldPackage = byCode(oldPackages.items || []);
    const newPackage = byCode(newPackages.items || []);
    const contract = (contracts.items || []).find((item) => item.soHopDong === contractNumber);
    return {
      oldPackage,
      newPackage,
      oldGoods: (oldGoods.items || []).filter((item) => item.goiThauId === oldPackage?.id),
      newGoods: (newGoods.items || []).filter((item) => item.goiThauId === newPackage?.id),
      oldOpenings: (oldOpenings.items || []).filter((item) => item.goiThauId === oldPackage?.id),
      newOpenings: (newOpenings.items || []).filter((item) => item.goiThauId === newPackage?.id),
      contract,
    };
  }, {
    historicalPlanId,
    latestPlanId,
    packageCode: `${runId}-GT`,
    contractNumber: `${runId}/HD`,
  });
  if (!inheritedSnapshot.oldPackage || !inheritedSnapshot.newPackage) {
    throw new Error(`Plan snapshot did not inherit the primary package: ${JSON.stringify(inheritedSnapshot)}`);
  }
  if (inheritedSnapshot.oldPackage.id === inheritedSnapshot.newPackage.id
      || inheritedSnapshot.oldPackage.phienBan !== inheritedSnapshot.newPackage.phienBan
      || inheritedSnapshot.oldPackage.trangThai !== inheritedSnapshot.newPackage.trangThai) {
    throw new Error(`Inherited package metadata is invalid: ${JSON.stringify(inheritedSnapshot)}`);
  }
  if (!inheritedSnapshot.oldGoods.length
      || inheritedSnapshot.oldGoods.length !== inheritedSnapshot.newGoods.length
      || inheritedSnapshot.newGoods.some((row) => inheritedSnapshot.oldGoods.some((oldRow) => oldRow.id === row.id))) {
    throw new Error(`Required goods were not independently inherited: ${JSON.stringify(inheritedSnapshot)}`);
  }
  if (!inheritedSnapshot.oldOpenings.length
      || inheritedSnapshot.oldOpenings.length !== inheritedSnapshot.newOpenings.length
      || inheritedSnapshot.newOpenings.some((row) => inheritedSnapshot.oldOpenings.some((oldRow) => oldRow.id === row.id))) {
    throw new Error(`Opening data was not independently inherited: ${JSON.stringify(inheritedSnapshot)}`);
  }
  if (!inheritedSnapshot.contract
      || inheritedSnapshot.contract.keHoachId !== historicalPlanId
      || !inheritedSnapshot.contract.goiThauIds?.includes(inheritedSnapshot.oldPackage.id)
      || inheritedSnapshot.contract.goiThauIds?.includes(inheritedSnapshot.newPackage.id)) {
    throw new Error(`Historical contract references drifted during plan versioning: ${JSON.stringify(inheritedSnapshot.contract)}`);
  }
  mark("plan-version-snapshot-inherited", {
    packageVersion: inheritedSnapshot.newPackage.phienBan,
    status: inheritedSnapshot.newPackage.trangThai,
    goods: inheritedSnapshot.newGoods.length,
    openings: inheritedSnapshot.newOpenings.length,
  });

  const rebidOldName = `Gói đấu thầu lại ${runId}`;
  const rebidNewName = `Gói đấu thầu lại đã sửa ${runId}`;
  await gotoReady(page, `${baseURL}/goi-thau`);
  await waitForApp(page);
  await page.locator("#search-goithau").fill(rebidOldName);
  const rebidRow = page.locator("#goithau-table tbody tr").filter({ hasText: rebidOldName });
  await rebidRow.first().waitFor({ state: "visible", timeout: 15_000 });
  if (await rebidRow.count() !== 1) throw new Error("Expected one inherited rebid package row.");
  await rebidRow.locator(".btn-edit").click();
  await page.locator("#modal-goithau.active").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#gt-ten").fill(rebidNewName);
  await submitModal(page, "#form-goithau", "#modal-goithau", {
    diagnostics: "inherited rebid package copy-on-write",
  });

  const copyOnWriteState = await page.evaluate(async ({ oldPlanId, newPlanId, oldName, newName }) => {
    const readPackages = async (planId) => {
      const response = await fetch(`/api/paginate?table=goithau&pageSize=500&keHoachId=${encodeURIComponent(planId)}`);
      if (!response.ok) throw new Error(`package pagination failed: ${response.status}`);
      return (await response.json()).items || [];
    };
    const [oldPackages, newPackages] = await Promise.all([readPackages(oldPlanId), readPackages(newPlanId)]);
    return {
      oldPackage: oldPackages.find((item) => item.tenGoiThau === oldName),
      newPackage: newPackages.find((item) => item.tenGoiThau === newName),
    };
  }, { oldPlanId: historicalPlanId, newPlanId: latestPlanId, oldName: rebidOldName, newName: rebidNewName });
  if (!copyOnWriteState.oldPackage || !copyOnWriteState.newPackage
      || copyOnWriteState.oldPackage.id === copyOnWriteState.newPackage.id
      || copyOnWriteState.oldPackage.rootId !== copyOnWriteState.newPackage.rootId) {
    throw new Error(`Package copy-on-write failed: ${JSON.stringify(copyOnWriteState)}`);
  }
  mark("historical-plan-package-frozen");

  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
  if (httpErrors.length) throw new Error(`HTTP errors: ${httpErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  if (browserServer) browserServer.process().kill();
  if (generatedExcelFixtures) {
    rmSync(generatedExcelFixtures.directory, { recursive: true, force: true });
  }
}
