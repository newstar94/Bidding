import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createE2ETestClock } from "./e2e_test_clock.mjs";
import { isExpectedSyncReset, isExpectedTelemetryBackpressure } from "./lib/e2eHttpErrors.mjs";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const testClock = createE2ETestClock();
const runId = `crud-e2e-${Date.now()}`;
const runDigits = String(Date.now()).slice(-9);
const organizationId = `${runId}-org`;
const password = `Aa!9${randomBytes(12).toString("hex")}`;
const account = {
  id: `${runId}-manager-id`,
  username: `${runId}-manager`,
  email: `${runId}-manager@example.test`,
  name: `CRUD manager ${runId}`,
};
const crudCodes = {
  investor: `${runId}-CRUD-CDT`,
  contractor: `${runId}-NT`,
  expert: `Chuyên gia CRUD ${runId}`,
  plan: `${runId}-CRUD-KH`,
  package: `${runId}-GT`,
  contract: `${runId}/HD`,
};
const documentFixtureDirectory = resolve("test-results", "e2e-artifacts", `documents-${runId}`);
const fixturePayload = {
  runId, organizationId, password, account, crudCodes, documentFixtureDirectory,
};
const result = { runId, steps: [] };
const mark = (step, details = {}) => {
  result.steps.push({ step, ...details });
  process.stdout.write(`[CRUD-E2E] ${step}\n`);
};

function fixture(action) {
  const execution = spawnSync(
    process.env.PYTHON || "python",
    ["scripts/package_pairwise_fixture.py", action],
    {
      cwd: process.cwd(), env: process.env, input: JSON.stringify(fixturePayload),
      encoding: "utf8", windowsHide: true,
    },
  );
  if (execution.status !== 0) throw new Error(`Fixture ${action} failed: ${execution.stderr || execution.stdout}`);
  return JSON.parse(execution.stdout || "{}");
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false" && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

async function gotoRoute(page, route) {
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`${route} returned HTTP ${response?.status() || "unknown"}`);
  await waitForApp(page);
}

async function openCreateModal(page, route, buttonSelector, modalSelector) {
  await gotoRoute(page, route);
  await page.locator(buttonSelector).click();
  await page.locator(`${modalSelector}.active`).waitFor({ state: "visible", timeout: 10_000 });
}

async function submitModal(page, formSelector, modalSelector) {
  await page.locator(`${formSelector} button[type="submit"]`).click();
  const modal = page.locator(`${modalSelector}.active`);
  const outcome = await Promise.race([
    modal.waitFor({ state: "hidden", timeout: 20_000 }).then(() => "closed").catch(() => null),
    page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 20_000 })
      .then(() => "confirm").catch(() => null),
  ]);
  if (outcome === "confirm") {
    await page.locator("#btn-dialog-ok").click();
    await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
    await modal.waitFor({ state: "hidden", timeout: 20_000 });
    return;
  }
  if (outcome === "closed") return;
  await modal.waitFor({ state: "hidden", timeout: 100 }).catch(async (error) => {
    const diagnostics = await page.evaluate((selector) => ({
      invalid: [...document.querySelectorAll(`${selector} :invalid`)].map((element) => ({
        id: element.id, value: element.value, message: element.validationMessage,
      })),
      dialog: document.getElementById("modal-custom-dialog")?.innerText || "",
      toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.innerText),
    }), formSelector);
    throw new Error(`${formSelector} did not close: ${JSON.stringify(diagnostics)}; ${error.message}`);
  });
}

const select = (page, selector, option) => page.locator(selector).selectOption(option, { force: true });

async function selectFirstAddress(page, provinceSelector, wardSelector) {
  await select(page, provinceSelector, { index: 1 });
  await page.waitForFunction((selector) => {
    const ward = document.querySelector(selector);
    return ward && !ward.disabled && ward.options.length > 1;
  }, wardSelector, { timeout: 10_000 });
  await select(page, wardSelector, { index: 1 });
}

async function confirmDeleteAll(page) {
  const dialog = page.locator("#modal-custom-dialog.active");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  if (await page.locator("#btn-dialog-opt2").count()) {
    await page.locator("#btn-dialog-opt2").click();
  } else {
    await page.locator("#btn-dialog-ok").click();
  }
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
}

async function savePlanBreakdown(page) {
  await page.locator("#btn-save-plan-breakdown").click();
  await page.locator("#modal-plan-breakdown.active").waitFor({ state: "hidden", timeout: 15_000 });
  const versionDialog = page.locator("#modal-custom-dialog.active");
  const requiresVersionChoice = await versionDialog.waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true).catch(() => false);
  if (requiresVersionChoice) {
    await page.locator("#btn-dialog-ok").click();
    await versionDialog.waitFor({ state: "hidden", timeout: 10_000 });
  }
}

async function deleteSearchedRow(page, tableSelector, expectedText) {
  const row = page.locator(`${tableSelector} tbody tr`).filter({ hasText: expectedText });
  const syncResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/sync" && response.request().method() === "POST";
  }, { timeout: 20_000 });
  await row.locator('[data-bf-action^="delete-"]').click();
  await confirmDeleteAll(page);
  const syncResponse = await syncResponsePromise;
  if (!syncResponse.ok()) {
    const body = await syncResponse.text().catch(() => "");
    throw new Error(`Delete sync returned ${syncResponse.status()}: ${body}`);
  }
  await row.waitFor({ state: "hidden", timeout: 20_000 });
}

let browser;
let fixtureCreated = false;
try {
  fixture("setup");
  fixtureCreated = true;
  const paginationFixture = fixture("seed_catalog_pagination");
  const documentFixtures = fixture("create_document_fixtures");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const pageErrors = [];
  const httpErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("response", async (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")
      && !isExpectedTelemetryBackpressure(response)) {
      let body = "";
      try { body = await response.text(); } catch {}
      if (isExpectedSyncReset(response, body)) return;
      httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()} ${body}`);
    }
  });

  await gotoRoute(page, "/dang-nhap");
  await page.locator("#login-username").fill(account.username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.locator("#auth-overlay").waitFor({ state: "hidden", timeout: 20_000 });
  mark("login-and-isolated-workspace");

  await gotoRoute(page, "/chuyen-gia");
  const firstPaginationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/paginate"
      && url.searchParams.get("table") === "chuyengia"
      && url.searchParams.get("search")?.includes(`phân trang ${runId}`)
      && url.searchParams.get("page") === "1"
      && response.ok();
  }, { timeout: 20_000 });
  await page.locator("#search-chuyengia").fill(paginationFixture.search);
  const firstPaginationPayload = await (await firstPaginationResponse).json();
  if (firstPaginationPayload.totalItems !== 15) throw new Error(`Expert pagination total is ${firstPaginationPayload.totalItems}`);
  if (await page.locator("#chuyengia-table tbody tr").count() !== 10) throw new Error("Expert first page did not render 10 rows");
  const secondPaginationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/paginate"
      && url.searchParams.get("table") === "chuyengia"
      && url.searchParams.get("page") === "2"
      && response.ok();
  }, { timeout: 20_000 });
  await page.locator('#chuyengia-pagination [title="Trang sau"]').click();
  await secondPaginationResponse;
  await page.waitForFunction(() => document.querySelectorAll("#chuyengia-table tbody tr").length === 5, null, { timeout: 10_000 });
  mark("expert-search-and-pagination", { totalItems: 15, firstPage: 10, secondPage: 5 });

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoRoute(page, "/chu-dau-tu");
  const mobileMetrics = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    mobileLayout: document.getElementById("chudautu-table")?.dataset.mobileLayout || "",
    addVisible: Boolean(document.getElementById("btn-add-chudautu")?.getClientRects().length),
  }));
  if (mobileMetrics.overflow || mobileMetrics.mobileLayout !== "cards" || !mobileMetrics.addVisible) {
    throw new Error(`Authenticated mobile layout is invalid: ${JSON.stringify(mobileMetrics)}`);
  }
  await page.locator("#btn-add-chudautu").focus();
  await page.keyboard.press("Enter");
  await page.locator("#modal-chudautu.active").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('#modal-chudautu .modal-close[data-close="modal-chudautu"]').click();
  await page.locator("#modal-chudautu.active").waitFor({ state: "hidden", timeout: 10_000 });
  await page.setViewportSize({ width: 1280, height: 720 });
  mark("authenticated-responsive-and-keyboard", mobileMetrics);

  await openCreateModal(page, "/chu-dau-tu", "#btn-add-chudautu", "#modal-chudautu");
  await page.locator("#form-chudautu button[type='submit']").click();
  if (await page.locator("#modal-chudautu.active").isHidden()) throw new Error("Investor required-field validation did not block submit");
  await page.locator("#cdt-ma").fill(crudCodes.investor);
  await page.locator("#cdt-ten").fill(`Chủ đầu tư CRUD ${runId}`);
  await page.locator("#cdt-ngayapdung").fill(testClock.date(-40));
  await page.locator("#cdt-danhxung").fill("Ông");
  await page.locator("#cdt-daidiencdt").fill("Nguyễn Văn CRUD");
  await page.locator("#cdt-chucvunguoidungdau").fill("Giám đốc");
  await page.locator("#cdt-chucvudaidien").fill("Giám đốc");
  await selectFirstAddress(page, "#cdt-tinh", "#cdt-xa");
  await page.locator("#cdt-diachichitiet").fill("01 Đường CRUD");
  await submitModal(page, "#form-chudautu", "#modal-chudautu");
  await page.locator("#search-chudautu").fill(crudCodes.investor);
  let investorRow = page.locator("#chudautu-table tbody tr").filter({ hasText: crudCodes.investor });
  await investorRow.locator('[data-bf-action="edit-investor"]').click();
  await page.locator("#modal-chudautu.active").waitFor({ state: "visible" });
  const investorUpdated = `Chủ đầu tư CRUD đã sửa ${runId}`;
  await page.locator("#cdt-ten").fill(investorUpdated);
  await submitModal(page, "#form-chudautu", "#modal-chudautu");
  await page.locator("#search-chudautu").fill(investorUpdated);
  investorRow = page.locator("#chudautu-table tbody tr").filter({ hasText: investorUpdated });
  await investorRow.waitFor({ state: "visible" });
  mark("investor-create-update-validation");

  await openCreateModal(page, "/nha-thau", "#btn-add-nhathau", "#modal-nhathau");
  await page.locator("#nt-ma").fill(crudCodes.contractor);
  await page.locator("#nt-ten").fill(`Nhà thầu CRUD ${runId}`);
  await page.locator("#nt-ngayapdung").fill(testClock.date(-40));
  await page.locator("#nt-danhxung").fill("Bà");
  await page.locator("#nt-nguoidaidien").fill("Trần Thị CRUD");
  await page.locator("#nt-chucvudaidien").fill("Giám đốc");
  await selectFirstAddress(page, "#nt-tinh", "#nt-xa");
  await page.locator("#nt-diachichitiet").fill("02 Đường CRUD");
  await submitModal(page, "#form-nhathau", "#modal-nhathau");
  await page.locator("#search-nhathau").fill(crudCodes.contractor);
  let contractorRow = page.locator("#nhathau-table tbody tr").filter({ hasText: crudCodes.contractor });
  await contractorRow.locator('[data-bf-action="edit-contractor"]').click();
  await page.locator("#modal-nhathau.active").waitFor({ state: "visible" });
  const contractorUpdated = `Nhà thầu CRUD đã sửa ${runId}`;
  await page.locator("#nt-ten").fill(contractorUpdated);
  await submitModal(page, "#form-nhathau", "#modal-nhathau");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#search-nhathau").fill(contractorUpdated);
  contractorRow = page.locator("#nhathau-table tbody tr").filter({ hasText: contractorUpdated });
  await contractorRow.waitFor({ state: "visible" });
  mark("contractor-create-update-reload");

  await openCreateModal(page, "/chuyen-gia", "#btn-add-chuyengia", "#modal-chuyengia");
  await page.locator("#cg-hoten").fill(crudCodes.expert);
  await page.locator("#cg-socccd").fill(`07${runDigits}1`);
  await page.locator("#cg-ngaycapcccd").fill(testClock.date(-3_650));
  await page.locator("#cg-noicapcccd").fill("Cục Cảnh sát QLHC về TTXH");
  await page.locator("#cg-sochungchi").fill(`${runId}-CC`);
  await page.locator("#cg-ngaycapchungchi").fill(testClock.date(-3_600));
  await page.locator("#cg-donvicapchungchi").fill("Cục Quản lý Đấu thầu");
  await submitModal(page, "#form-chuyengia", "#modal-chuyengia");
  await page.locator("#search-chuyengia").fill(crudCodes.expert);
  let expertRow = page.locator("#chuyengia-table tbody tr").filter({ hasText: crudCodes.expert });
  await expertRow.locator('[data-bf-action="edit-expert"]').click();
  await page.locator("#modal-chuyengia.active").waitFor({ state: "visible" });
  const expertUpdated = `${crudCodes.expert} đã sửa`;
  await page.locator("#cg-hoten").fill(expertUpdated);
  await submitModal(page, "#form-chuyengia", "#modal-chuyengia");
  await page.locator("#search-chuyengia").fill(expertUpdated);
  expertRow = page.locator("#chuyengia-table tbody tr").filter({ hasText: expertUpdated });
  await expertRow.waitFor({ state: "visible" });
  mark("expert-create-update");

  await openCreateModal(page, "/ke-hoach", "#btn-add-kehoach", "#modal-kehoach");
  await page.locator("#kh-ma").fill(crudCodes.plan);
  await page.locator("#kh-ten").fill(`Kế hoạch CRUD ${runId}`);
  await select(page, "#kh-loaihinh", { label: "Dự toán mua sắm" });
  await select(page, "#kh-pheduyet", { value: "Dự toán và kế hoạch" });
  await page.locator("#kh-duan").fill(`Dự toán CRUD ${runId}`);
  await select(page, "#kh-chudautuid", { index: 1 });
  await page.locator("#kh-sototrinhdutoankehoach").fill(`${runId}/TTR`);
  await page.locator("#kh-ngaytrinhkehoach").fill(testClock.date(-30));
  await page.locator("#kh-quyetdinh").fill(`${runId}/QD-KH`);
  await page.locator("#kh-ngaypheduyet").fill(testClock.date(-29));
  await page.locator("#kh-tongmuc").fill("1000000000");
  await page.locator("#form-kehoach button[type='submit']").click();
  await page.locator("#modal-plan-breakdown.active").waitFor({ state: "visible", timeout: 10_000 });
  await savePlanBreakdown(page);
  await page.locator("#search-kehoach").fill(crudCodes.plan);
  let planRow = page.locator("#kehoach-table tbody tr").filter({ hasText: crudCodes.plan });
  await planRow.locator('[data-bf-action="edit-plan"]').click();
  await page.locator("#modal-kehoach.active").waitFor({ state: "visible" });
  const planUpdated = `Kế hoạch CRUD đã sửa ${runId}`;
  await page.locator("#kh-ten").fill(planUpdated);
  await page.locator("#form-kehoach button[type='submit']").click();
  await page.locator("#modal-plan-breakdown.active").waitFor({ state: "visible", timeout: 10_000 });
  await savePlanBreakdown(page);
  await page.locator("#search-kehoach").fill(planUpdated);
  planRow = page.locator("#kehoach-table tbody tr").filter({ hasText: planUpdated });
  await planRow.waitFor({ state: "visible" });
  mark("plan-create-update");

  await openCreateModal(page, "/goi-thau", "#btn-add-goithau", "#modal-goithau");
  await page.locator("#gt-ma").fill(crudCodes.package);
  await select(page, "#gt-kehoachid", { index: 1 });
  await page.locator("#gt-ten").fill(`Gói CRUD ${runId}`);
  await page.locator("#gt-gia").fill("500000000");
  await page.locator("#gt-thoigian").fill("90 ngày");
  await select(page, "#gt-linhvuc", { label: "Hàng hóa" });
  await select(page, "#gt-hinhthuc", { label: "Đấu thầu rộng rãi" });
  await select(page, "#gt-phuongthuc", { label: "Một giai đoạn một túi hồ sơ" });
  await select(page, "#gt-phuongphapdanhgia", { label: "Giá thấp nhất" });
  await select(page, "#gt-phanlo", { label: "Không" });
  await page.locator("#gt-nguonvon").fill("Ngân sách nhà nước");
  await page.locator("#gt-thoigiantochuc").fill("45 ngày");
  await page.locator("#gt-thoigianbatdautochuc").fill(testClock.quarter());
  await select(page, "#gt-nhanvienphutrach", { index: 1 });
  await page.locator('#to-chuyengia-tbody input[name="tochuyengia-select"]').first().check();
  await page.locator('#to-thamdinh-tbody input[name="tothamdinh-select"]').nth(1).check();
  await submitModal(page, "#form-goithau", "#modal-goithau");
  await page.locator("#search-goithau").fill(crudCodes.package);
  let packageRow = page.locator("#goithau-table tbody tr").filter({ hasText: crudCodes.package });
  await packageRow.locator('[data-bf-action="edit-package"]').click();
  await page.locator("#modal-goithau.active").waitFor({ state: "visible" });
  const packageUpdated = `Gói CRUD đã sửa ${runId}`;
  await page.locator("#gt-ten").fill(packageUpdated);
  await submitModal(page, "#form-goithau", "#modal-goithau");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#search-goithau").fill(packageUpdated);
  packageRow = page.locator("#goithau-table tbody tr").filter({ hasText: packageUpdated });
  await packageRow.waitFor({ state: "visible" });
  mark("package-create-update-reload");

  await packageRow.locator('[data-bf-action="show-package"]').first().click();
  const documentsTab = page.locator('[data-workflow-tab="documents"]');
  await documentsTab.waitFor({ state: "visible", timeout: 15_000 });
  await documentsTab.click();
  const documentInput = page.locator("[data-document-input]").first();
  await documentInput.waitFor({ state: "attached", timeout: 15_000 });
  await documentInput.setInputFiles(documentFixtures.invalidPath);
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
  const invalidDocumentMessage = await page.locator("#modal-custom-dialog").innerText();
  if (!invalidDocumentMessage.includes("Chỉ hỗ trợ tệp PDF, DOCX hoặc XLSX")) {
    throw new Error(`Invalid package document was not rejected correctly: ${invalidDocumentMessage}`);
  }
  await page.locator("#btn-dialog-ok").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForFunction((selector) => {
    const input = document.querySelector(selector);
    return input && !input.value;
  }, "[data-document-input]", { timeout: 5_000 });

  await documentInput.setInputFiles({
    name: "noi-dung-gia-mao.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf archive"),
  });
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
  const spoofedPdfMessage = await page.locator("#modal-custom-dialog").innerText();
  if (!spoofedPdfMessage.includes("Cấu trúc tệp PDF không hợp lệ")) {
    throw new Error(`Spoofed PDF was not rejected by content: ${spoofedPdfMessage}`);
  }
  const expectedSpoofedPdfError = httpErrors.findIndex((entry) => (
    entry.includes("400 PUT") && entry.includes("PACKAGE_DOCUMENT_INVALID")
  ));
  if (expectedSpoofedPdfError < 0) throw new Error("Spoofed PDF rejection was not enforced by the backend");
  httpErrors.splice(expectedSpoofedPdfError, 1);
  await page.locator("#btn-dialog-ok").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });

  await documentInput.setInputFiles({
    name: "qua-dung-luong.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(25 * 1024 * 1024 + 1, 0x41),
  });
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
  const oversizedPdfMessage = await page.locator("#modal-custom-dialog").innerText();
  if (!oversizedPdfMessage.includes("không vượt quá 25 MB")) {
    throw new Error(`Oversized PDF was not rejected: ${oversizedPdfMessage}`);
  }
  await page.locator("#btn-dialog-ok").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });

  await documentInput.setInputFiles({
    name: "..\\..\\tai-lieu-thau-hop-le.pdf",
    mimeType: "application/pdf",
    buffer: readFileSync(documentFixtures.pdfPath),
  });
  const documentCard = page.locator(".package-document-card").filter({ hasText: "tai-lieu-thau-hop-le.pdf" });
  const uploadOutcome = await Promise.race([
    documentCard.waitFor({ state: "visible", timeout: 20_000 }).then(() => "card").catch(() => null),
    page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 20_000 })
      .then(() => "dialog").catch(() => null),
  ]);
  if (uploadOutcome === "dialog") {
    const uploadMessage = await page.locator("#modal-custom-dialog").innerText();
    if (!uploadMessage.includes("Thành công")) throw new Error(`PDF upload failed: ${uploadMessage}`);
    await page.locator("#btn-dialog-ok").click();
    await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  } else if (uploadOutcome !== "card") {
    const diagnostics = await page.evaluate(() => ({
      status: [...document.querySelectorAll("[data-document-status]")].map((item) => item.textContent),
      panel: document.querySelector(".package-documents-panel")?.innerText || "",
    }));
    throw new Error(`PDF upload had no result: ${JSON.stringify({ diagnostics, httpErrors, pageErrors })}`);
  }
  await documentCard.waitFor({ state: "visible", timeout: 15_000 });
  const storedDocumentName = (await documentCard.locator("strong").textContent())?.trim() || "";
  if (storedDocumentName !== "tai-lieu-thau-hop-le.pdf") {
    throw new Error(`Dangerous upload name was not sanitized: ${storedDocumentName}`);
  }
  const [pdfDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    documentCard.locator("[data-document-download]").click(),
  ]);
  const downloadedPdfPath = await pdfDownload.path();
  if (!downloadedPdfPath) throw new Error("Uploaded PDF did not download");
  const downloadedPdf = readFileSync(downloadedPdfPath);
  if (!downloadedPdf.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || !downloadedPdf.subarray(Math.max(0, downloadedPdf.length - 1024)).includes(Buffer.from("%%EOF"))) {
    throw new Error("Downloaded package PDF is structurally invalid");
  }
  await documentCard.locator("[data-document-delete]").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#btn-dialog-ok").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  const deleteOutcome = await Promise.race([
    documentCard.waitFor({ state: "hidden", timeout: 15_000 }).then(() => "card").catch(() => null),
    page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 15_000 })
      .then(() => "dialog").catch(() => null),
  ]);
  if (deleteOutcome === "dialog") {
    const deleteDocumentMessage = await page.locator("#modal-custom-dialog").innerText();
    if (!deleteDocumentMessage.includes("Thành công")) throw new Error(`PDF delete failed: ${deleteDocumentMessage}`);
    await page.locator("#btn-dialog-ok").click();
    await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  }
  await documentCard.waitFor({ state: "hidden", timeout: 15_000 });
  mark("package-pdf-invalid-upload-download-delete", {
    uploadedBytes: documentFixtures.pdfSize,
    downloadedBytes: downloadedPdf.length,
    spoofedContentRejected: true,
    oversizedRejected: true,
    sanitizedFilename: storedDocumentName,
  });

  await openCreateModal(page, "/hop-dong", "#btn-add-hopdong", "#modal-hopdong");
  await page.locator("#hd-so").fill(crudCodes.contract);
  await page.locator("#hd-ten").fill(`Hợp đồng CRUD ${runId}`);
  await page.locator("#hd-ngayky").fill(testClock.date(-20));
  await select(page, "#hd-chudautuid", { index: 1 });
  await select(page, "#hd-nhathauid", { label: contractorUpdated });
  await page.locator("#hd-giatri").fill("450000000");
  await select(page, "#hd-loai", { label: "Trọn gói" });
  await select(page, "#hd-phanloai", { label: "Khác" });
  await page.locator("#hd-songay").fill("90 ngày");
  await select(page, "#hd-kehoachid", { index: 1 });
  await page.locator('input[name="hd-goithau-checkbox"]:not([disabled])').first().check();
  await select(page, "#hd-nhanvienphutrach", { index: 1 });
  await select(page, "#hd-trangthai-hopdong", { label: "Đang thực hiện" });
  await submitModal(page, "#form-hopdong", "#modal-hopdong");
  await page.locator("#search-hopdong").fill(`Hợp đồng CRUD ${runId}`);
  let contractRow = page.locator("#hopdong-table tbody tr").filter({ hasText: `Hợp đồng CRUD ${runId}` });
  await contractRow.locator('[data-bf-action="edit-contract"]').click();
  await page.locator("#modal-hopdong.active").waitFor({ state: "visible" });
  const contractUpdated = `Hợp đồng CRUD đã sửa ${runId}`;
  await page.locator("#hd-ten").fill(contractUpdated);
  await submitModal(page, "#form-hopdong", "#modal-hopdong");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#search-hopdong").fill(contractUpdated);
  contractRow = page.locator("#hopdong-table tbody tr").filter({ hasText: contractUpdated });
  await contractRow.waitFor({ state: "visible" });
  mark("contract-create-update-reload");

  await deleteSearchedRow(page, "#hopdong-table", contractUpdated);
  mark("contract-delete");
  await gotoRoute(page, "/goi-thau");
  await page.locator("#search-goithau").fill(packageUpdated);
  await deleteSearchedRow(page, "#goithau-table", packageUpdated);
  mark("package-delete-all-versions");
  await gotoRoute(page, "/ke-hoach");
  await page.locator("#search-kehoach").fill(planUpdated);
  await deleteSearchedRow(page, "#kehoach-table", planUpdated);
  mark("plan-delete-all-versions");
  await gotoRoute(page, "/chuyen-gia");
  await page.locator("#search-chuyengia").fill(expertUpdated);
  await deleteSearchedRow(page, "#chuyengia-table", expertUpdated);
  mark("expert-delete-all-versions");
  await gotoRoute(page, "/nha-thau");
  await page.locator("#search-nhathau").fill(contractorUpdated);
  await deleteSearchedRow(page, "#nhathau-table", contractorUpdated);
  mark("contractor-delete-all-versions");
  await gotoRoute(page, "/chu-dau-tu");
  await page.locator("#search-chudautu").fill(investorUpdated);
  await deleteSearchedRow(page, "#chudautu-table", investorUpdated);
  mark("investor-delete-all-versions");

  const postgresEvidence = fixture("verify_crud_absent");
  mark("postgres-crud-clean", postgresEvidence);
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
  if (httpErrors.length) throw new Error(`HTTP errors: ${httpErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  if (fixtureCreated) mark("fixture-removed", fixture("cleanup"));
}
