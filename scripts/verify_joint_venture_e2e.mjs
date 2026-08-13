import process from "node:process";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createE2ETestClock } from "./e2e_test_clock.mjs";
import { isExpectedTelemetryBackpressure } from "./lib/e2eHttpErrors.mjs";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const testClock = createE2ETestClock();
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!password) throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");
const scenario = String(process.env.E2E_JV_SCENARIO || "full").trim().toLowerCase();
const multiLotOnly = scenario === "multi-lot";

const runId = `jv-e2e-${Date.now()}`;
const organizationId = `__${runId}-org`;
const username = `${runId}-user`;
const account = {
  id: `${runId}-account`,
  username,
  name: `Quản lý JV ${runId}`,
  email: `${runId}@example.invalid`,
};
const artifactDirectory = resolve("test-results", "e2e-artifacts");
mkdirSync(artifactDirectory, { recursive: true });
const wordTemplatePath = resolve(artifactDirectory, `jv_result_template_${runId}.docx`);
const wordExportPath = resolve(artifactDirectory, `jv_result_export_${runId}.docx`);
const contractors = [1, 2, 3, 4].map((index) => ({
  id: `${runId}-contractor-${index}`,
  code: `${runId.toUpperCase()}-NT-${index}`,
  name: `Nhà thầu JV ${index} ${runId}`,
}));
const packageData = {
  id: `${runId}-package`,
  code: `${runId.toUpperCase()}-GT`,
  name: `Gói liên danh ${runId}`,
  price: 1_000_000,
};
const lotPackageData = {
  id: `${runId}-lot-package`,
  code: `${runId.toUpperCase()}-GT-LOT`,
  name: `Gói liên danh nhiều lô ${runId}`,
  price: 1_000_000,
  lots: [
    { id: `${runId}-lot-1`, code: "JV-L1", name: "Lô liên danh 1", price: 500_000 },
    { id: `${runId}-lot-2`, code: "JV-L2", name: "Lô liên danh 2", price: 500_000 },
  ],
};
const twoEnvelopePackageData = {
  id: `${runId}-two-envelope-package`,
  code: `${runId.toUpperCase()}-GT-2T`,
  name: `Gói liên danh 1G2T ${runId}`,
  price: 1_000_000,
};
const fixtureDates = {
  contractorEffective: testClock.isoDate(-40),
  ownerEffective: testClock.isoDate(-40),
  planApproval: testClock.isoDate(-39),
  packageStart: testClock.isoDate(-39),
  packagePublishedAt: testClock.isoDateTime(-39, "08:00"),
  packageClosingAt: testClock.isoDateTime(-35, "08:00"),
  packageOpeningAt: testClock.isoDateTime(-35, "08:05"),
};
const fixturePayload = {
  runId, organizationId, username, password, account, contractors,
  package: packageData, lotPackage: lotPackageData,
  twoEnvelopePackage: twoEnvelopePackageData,
  fixtureDates, wordTemplatePath,
};
const result = { runId, steps: [] };
const mark = (step, details = {}) => {
  result.steps.push({ step, ...details });
  process.stdout.write(`[JV-E2E] ${step}\n`);
};

function fixture(action, extra = {}) {
  const execution = spawnSync(
    process.env.PYTHON || "python",
    ["scripts/joint_venture_e2e_fixture.py", action],
    {
      cwd: process.cwd(),
      env: process.env,
      input: JSON.stringify({ ...fixturePayload, ...extra }),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (execution.status !== 0) {
    throw new Error(`Fixture ${action} failed: ${execution.stderr || execution.stdout}`);
  }
  return JSON.parse(execution.stdout || "{}");
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

const workflowTabReadySelectors = {
  opening: ["#btn-mothau-save"],
  opening_tech: ["#btn-mothau-save"],
  eval_tech: ["#danhgiahsdt-so-baocao", "#btn-continue-lot-evaluation"],
  eval_fin: ["#danhgiahsdt-so-baocao", "#btn-continue-lot-evaluation"],
  result: ["#award-so-bctd", ".award-result-card", ".evaluation-round-card"],
};

async function activateWorkflowTab(page, tabId, { activate = true } = {}) {
  const tab = page.locator(`[data-workflow-tab="${tabId}"]`);
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  if (activate && await tab.getAttribute("aria-selected") !== "true") await tab.click();
  const readySelectors = workflowTabReadySelectors[tabId] || ["#detail-workflow-content-wrapper"];
  try {
    await page.waitForFunction(({ expectedTab, selectors }) => {
      const tabButton = document.querySelector(`[data-workflow-tab="${expectedTab}"]`);
      const root = document.getElementById("detail-workflow-content-wrapper");
      return tabButton?.getAttribute("aria-selected") === "true"
        && selectors.some((selector) => Boolean(root?.querySelector(selector)));
    }, { expectedTab: tabId, selectors: readySelectors }, { timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(({ expectedTab, selectors }) => {
      const root = document.getElementById("detail-workflow-content-wrapper");
      return {
        expectedTab,
        selectors,
        currentWorkflowTab: globalThis.app?.view?._currentWorkflowTab || "",
        tabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => ({
          id: item.getAttribute("data-workflow-tab"),
          ariaSelected: item.getAttribute("aria-selected"),
          className: item.className,
        })),
        contentIds: [...(root?.querySelectorAll("[id]") || [])].slice(0, 40).map((item) => item.id),
      };
    }, { expectedTab: tabId, selectors: readySelectors });
    throw new Error(`Workflow tab ${tabId} did not become ready: ${JSON.stringify(diagnostics)}; ${error.message}`);
  }
}

async function openCreateModal(page, route, buttonSelector, modalSelector) {
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`${route} returned HTTP ${response?.status() || "unknown"}`);
  await waitForApp(page);
  await page.locator(buttonSelector).click();
  await page.locator(`${modalSelector}.active`).waitFor({ state: "visible", timeout: 10_000 });
}

async function submitModal(page, formSelector, modalSelector) {
  await page.locator(`${formSelector} button[type='submit']`).click();
  try {
    await page.locator(`${modalSelector}.active`).waitFor({ state: "hidden", timeout: 15_000 });
  } catch (error) {
    const diagnostics = await page.locator(modalSelector).evaluate((modal) => ({
      invalid: [...modal.querySelectorAll(":invalid, [aria-invalid='true']")].map((field) => ({
        id: field.id || "",
        name: field.getAttribute("name") || "",
        value: field.value || "",
        message: field.validationMessage || field.closest(".form-group")?.querySelector(".error-message, .error-text")?.textContent?.trim() || "",
      })),
      text: modal.textContent?.trim().replace(/\s+/g, " ").slice(0, 1_000) || "",
    }));
    const dialog = await page.locator("#modal-custom-dialog.active").allTextContents();
    throw new Error(
      `Modal ${modalSelector} did not close: ${JSON.stringify({ diagnostics, dialog })}`,
      { cause: error },
    );
  }
}

const select = (page, selector, option) => page.locator(selector).selectOption(option, { force: true });

async function loginAndSelectWorkspace(page) {
  await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.locator("#auth-overlay").waitFor({ state: "hidden", timeout: 20_000 });
  await waitForApp(page);
  await page.setExtraHTTPHeaders({ "X-Active-Org": encodeURIComponent(organizationId) });
  const activation = await page.evaluate(async (orgId) => {
    localStorage.setItem("bf_active_org", orgId);
    sessionStorage.setItem("bf_active_org", orgId);
    const csrf = document.cookie.split(";").map((part) => part.trim())
      .find((part) => part.startsWith("csrf_token="))?.slice("csrf_token=".length) || "";
    const response = await fetch("/api/auth/active-role", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Active-Org": encodeURIComponent(orgId),
        "X-CSRF-Token": decodeURIComponent(csrf),
      },
      body: JSON.stringify({ active_role: "manager" }),
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }, organizationId);
  if (!activation.ok) throw new Error(`Cannot select JV workspace: ${JSON.stringify(activation)}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  const activeOrganization = await page.evaluate(() => sessionStorage.getItem("bf_active_org") || localStorage.getItem("bf_active_org"));
  if (activeOrganization !== organizationId) {
    throw new Error(`Active workspace mismatch: expected ${organizationId}, got ${activeOrganization}`);
  }
  await page.getByText("Chế độ: Quản lý", { exact: true }).waitFor({ state: "visible" });
}

async function openPackage(page, tabId, targetPackage = packageData) {
  await page.goto(`${baseURL}/goi-thau`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#search-goithau").fill(targetPackage.code);
  const link = page.getByRole("link", { name: targetPackage.code, exact: true });
  try {
    await link.waitFor({ state: "visible", timeout: 20_000 });
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
        tableText: document.querySelector("#goithau-table tbody")?.textContent?.trim() || "",
        paginateStatus: response.status,
        paginateBody: await response.text(),
      };
    }, targetPackage.code);
    throw new Error(`Package link missing: ${JSON.stringify(diagnostics)}; ${error.message}`);
  }
  await link.click();
  await activateWorkflowTab(page, tabId);
}

async function fillOpeningRow(page, row, { type, contractor, price }) {
  const typeSelect = row.locator(".mt-loai-nha-thau");
  if (await typeSelect.inputValue() !== type) {
    await typeSelect.evaluate((select, nextType) => {
      select.value = nextType;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, type);
  }
  await row.locator(".mt-ma-nha-thau").fill(contractor.code);
  await row.locator(".mt-ten-nha-thau").fill(contractor.name);
  await row.locator(".mt-gia-du-thau").fill(String(price));
  await row.locator(".mt-ty-le-giam-gia").fill("0");
  await row.locator(".mt-hieu-luc-hsdt").fill("90");
  await row.locator(".mt-gia-tri-dam-bao").fill("10000");
  await row.locator(".mt-hieu-luc-bao-dam-ngay").fill("120");
  await row.locator(".mt-thoi-gian-thuc-hien").fill("90 ngày");
}

async function configureJointMembers(page, row) {
  const button = row.locator(".mt-btn-manage-members");
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.click();
  const modal = page.locator("#modal-mothau-jv-manager");
  await modal.waitFor({ state: "visible", timeout: 10_000 });
  await modal.locator("#jv-input-lead-name").fill(contractors[0].name);
  const memberRow = modal.locator(".mothau-jv-member-row").first();
  await memberRow.locator(".jv-input-mst").fill(contractors[1].code);
  await memberRow.locator(".jv-input-ten").fill(contractors[1].name);
  await modal.locator("#btn-add-mothau-jv-member").click();
  const secondMemberRow = modal.locator(".mothau-jv-member-row").nth(1);
  await secondMemberRow.locator(".jv-input-mst").fill(contractors[2].code);
  await secondMemberRow.locator(".jv-input-ten").fill(contractors[2].name);
  await modal.locator("#btn-save-mothau-jv").click();
  await modal.waitFor({ state: "hidden", timeout: 10_000 });
}

async function selectEvaluationLot(page, lotCode) {
  await page.evaluate(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    globalThis.__bfE2eController = getAppController();
  });
  const selectedMode = page.locator(
    'input[name="danhgiahsdt-scope-mode"][value="selected"]:visible',
  );
  await selectedMode.check();
  const options = page.locator(".evaluation-lot-option:visible");
  const target = options.filter({ hasText: lotCode }).locator("[data-evaluation-lot-id]");
  await target.waitFor({ state: "visible", timeout: 10_000 });
  const optionCount = await options.count();
  for (let index = 0; index < optionCount; index += 1) {
    const option = options.nth(index);
    if ((await option.textContent())?.includes(lotCode)) continue;
    const input = option.locator("[data-evaluation-lot-id]");
    if (await input.isChecked()) await input.uncheck();
  }
  await target.check();
  const targetId = await target.getAttribute("data-evaluation-lot-id");
  await page.waitForFunction(evaluationLotScopeBarrier, targetId, { timeout: 10_000 });
}

function evaluationLotScopeBarrier(expectedTargetId) {
  const controller = globalThis.__bfE2eController;
  if (!controller || controller._evaluationLotScopeRenderQueued === true) return false;
  const packageId = controller.view?._currentWorkflowPackageId
    || controller.view?.getActiveElement?.("danhgiahsdt-goithau-select")?.value
    || "";
  const scopeKey = `${String(packageId)}:${String(controller.currentDanhGiaTab || "technical")}`;
  const scope = controller._explicitEvaluationLotScopes?.[scopeKey];
  return scope?.mode === "selected"
    && scope?.selectedLotIds?.length === 1
    && scope.selectedLotIds[0] === expectedTargetId;
}

function evaluationControlsBarrier({ expectedCount, expectedLotCode, requiresRejection, reportUnready = false }) {
  const view = globalThis.__bfE2eController?.view;
  const tbody = view?.getActiveElement?.("danhgiahsdt-table-tbody");
  const rows = [...(tbody?.querySelectorAll("tr[data-bid-id]") || [])]
    .filter((row) => row.textContent?.includes(expectedLotCode));
  const activeButton = view?.getActiveElement?.("btn-danhgiahsdt-save");
  const rejectionReady = !requiresRejection || rows.some((row) => (
    row.textContent?.includes("Liên danh")
    && row.querySelector('.mt-low-price-acceptance[value="false"]')?.checked === true
  ));
  const ready = rows.length === expectedCount
    && rows.every((row) => row.querySelector(".mt-ketluan-cell")?.textContent?.trim() === "Đạt")
    && rejectionReady
    && activeButton?.isConnected === true
    && typeof activeButton.onclick === "function";
  if (!ready && !reportUnready) return false;
  return {
    ready,
    rowCount: rows.length,
    conclusions: rows.map((row) => row.querySelector(".mt-ketluan-cell")?.textContent?.trim() || ""),
    rejectionReady,
    saveConnected: activeButton?.isConnected === true,
    saveBound: typeof activeButton?.onclick === "function",
  };
}

async function waitForEvaluationSave(page, httpErrors, pageErrors) {
  try {
    await page.waitForFunction(() => (
      Boolean(document.querySelector(".bf-toast.toast-success:not(.toast-hiding)"))
      || document.getElementById("modal-custom-dialog")?.classList.contains("active")
    ), null, { timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(async () => {
      const { getAppController } = await import("/frontend/app/controllerRef.js");
      const controller = getAppController();
      const packageId = document.getElementById("danhgiahsdt-goithau-select")?.value || "";
      const pkg = controller?.model?.state?.goithau?.find((item) => String(item.id) === String(packageId));
      const latestPackage = controller?.model?.getLatestPackage?.(packageId);
      return ({
      dialogClass: document.getElementById("modal-custom-dialog")?.className || "",
      dialogTitle: document.getElementById("dialog-title")?.textContent?.trim() || "",
      dialogMessage: document.getElementById("dialog-message")?.textContent?.trim() || "",
      saveButton: {
        disabled: Boolean(document.getElementById("btn-danhgiahsdt-save")?.disabled),
        hidden: Boolean(document.getElementById("btn-danhgiahsdt-save")?.hidden),
        text: document.getElementById("btn-danhgiahsdt-save")?.textContent?.trim() || "",
      },
      reportFields: {
        number: document.getElementById("danhgiahsdt-so-baocao")?.value || "",
        numberInvalid: document.getElementById("danhgiahsdt-so-baocao")?.getAttribute("aria-invalid") || "",
        date: document.getElementById("danhgiahsdt-ngay-baocao")?.value || "",
        dateInvalid: document.getElementById("danhgiahsdt-ngay-baocao")?.getAttribute("aria-invalid") || "",
      },
      syncState: document.getElementById("btn-force-sync")?.dataset?.syncState || "",
      toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.innerText),
      workflowTabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => item.getAttribute("data-workflow-tab")),
      packageMetadata: pkg?.danhGiaHsdtMetadata || "",
      latestPackageIsCanonical: latestPackage === pkg,
      latestPackageMetadata: latestPackage?.danhGiaHsdtMetadata || "",
    });
    });
    throw new Error(`Evaluation did not complete: ${JSON.stringify(diagnostics)}; HTTP=${JSON.stringify(httpErrors)}; pageErrors=${JSON.stringify(pageErrors)}; ${error.message}`);
  }
  if (await page.locator("#modal-custom-dialog.active").isVisible()) {
    throw new Error(`Evaluation save blocked: ${await page.locator("#modal-custom-dialog").innerText()}; HTTP=${JSON.stringify(httpErrors)}; pageErrors=${JSON.stringify(pageErrors)}`);
  }
  const successToast = page.locator(".toast-success").last();
  await successToast.waitFor({ state: "visible", timeout: 10_000 });
  await successToast.waitFor({ state: "hidden", timeout: 10_000 });
}

async function waitForOpeningAdvance(page, httpErrors, pageErrors, label) {
  const dialog = page.locator("#modal-custom-dialog.active");
  const successToast = page.locator(".bf-toast.toast-success:not(.toast-hiding)").last();
  try {
    const outcome = await Promise.race([
      successToast.waitFor({ state: "visible", timeout: 20_000 }).then(() => "success"),
      dialog.waitFor({ state: "visible", timeout: 20_000 }).then(() => "dialog"),
    ]);
    if (outcome === "dialog") {
      const dialogText = await page.locator("#modal-custom-dialog").innerText();
      throw new Error(`${label} blocked: ${dialogText}; HTTP=${JSON.stringify(httpErrors)}; pageErrors=${JSON.stringify(pageErrors)}`);
    }
    await activateWorkflowTab(page, "eval_tech", { activate: false });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      dialogClass: document.getElementById("modal-custom-dialog")?.className || "",
      dialogText: document.getElementById("modal-custom-dialog")?.innerText || "",
      toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.innerText),
      workflowTabs: [...document.querySelectorAll("[data-workflow-tab]")].map((item) => ({
        id: item.getAttribute("data-workflow-tab"),
        display: getComputedStyle(item).display,
        visibility: getComputedStyle(item).visibility,
      })),
    }));
    throw new Error(`${label} did not complete and advance to eval_tech: ${JSON.stringify(diagnostics)}; HTTP=${JSON.stringify(httpErrors)}; pageErrors=${JSON.stringify(pageErrors)}; ${error.message}`);
  }
  return page.locator('[data-workflow-tab="eval_tech"]');
}

let browser;
let fixtureCreated = false;
try {
  fixture("setup");
  fixtureCreated = true;
  const wordTemplateEvidence = fixture("create_word_template");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN" });
  const page = await context.newPage();
  const pageErrors = [];
  const httpErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", async (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")
      && !isExpectedTelemetryBackpressure(response)) {
      let body = "";
      try { body = await response.text(); } catch {}
      // Delta 409 is the protocol's safe-reset/full-sync response.  The page
      // immediately retries through the authoritative pull path; it is not a
      // failed business mutation and must not poison this long E2E's error list.
      if (
        response.status() === 409
        && response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/sync/delta"
      ) return;
      httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()} ${body}`);
    }
  });
  await loginAndSelectWorkspace(page);

  if (!multiLotOnly) {
  await page.goto(`${baseURL}/bieu-mau`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#word-file-input").setInputFiles(wordTemplatePath);
  const uploadedTemplateRow = page.locator("#word-templates-tbody tr").filter({ hasText: runId });
  await uploadedTemplateRow.waitFor({ state: "visible", timeout: 20_000 });
  if (await page.locator("#modal-custom-dialog.active").isVisible()) {
    const uploadDialog = await page.locator("#modal-custom-dialog").innerText();
    if (!uploadDialog.includes("Thành công")) throw new Error(`Word template upload failed: ${uploadDialog}`);
    await page.locator("#btn-dialog-ok").click();
    await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  }
  if (await uploadedTemplateRow.locator(".btn-activate-template").count()) {
    await uploadedTemplateRow.locator(".btn-activate-template").last().click();
  }
  await page.locator("#word-templates-tbody tr").filter({ hasText: runId })
    .filter({ hasText: "Đang hoạt động" }).waitFor({ state: "visible", timeout: 20_000 });
  mark("word-template-uploaded-and-activated", wordTemplateEvidence);

  await openPackage(page, "opening");

  const addButton = page.locator("#btn-mothau-add-bid");
  await addButton.waitFor({ state: "visible", timeout: 20_000 });
  const openingRows = page.locator("#mothau-table-tbody tr");
  if (await openingRows.count() === 0) await addButton.click();
  const firstRow = openingRows.first();
  await fillOpeningRow(page, firstRow, { type: "Liên danh", contractor: contractors[0], price: 400_000 });
  const manageMembersButton = firstRow.locator(".mt-btn-manage-members");
  try {
    await manageMembersButton.waitFor({ state: "visible", timeout: 5_000 });
  } catch (error) {
    const diagnostics = await firstRow.evaluate((row) => {
      const select = row.querySelector(".mt-loai-nha-thau");
      const container = row.querySelector(".mt-jv-members-container");
      const button = row.querySelector(".mt-btn-manage-members");
      return {
        selectValue: select?.value || "",
        rowDisplay: getComputedStyle(row).display,
        containerClass: container?.className || "",
        containerStyle: container?.getAttribute("style") || "",
        containerDisplay: container ? getComputedStyle(container).display : "missing",
        buttonDisplay: button ? getComputedStyle(button).display : "missing",
        displayRules: container ? [...document.styleSheets].flatMap((sheet) => {
          try {
            return [...sheet.cssRules]
              .filter((rule) => rule.cssText?.includes("display") && [...container.classList].some((className) => rule.cssText.includes(`.${className}`)))
              .map((rule) => rule.cssText);
          } catch (_) {
            return [];
          }
        }) : [],
        rowText: row.innerText,
      };
    });
    throw new Error(`Joint-venture controls remained hidden: ${JSON.stringify(diagnostics)}; ${error.message}`);
  }
  await manageMembersButton.click();
  const modal = page.locator("#modal-mothau-jv-manager");
  await modal.waitFor({ state: "visible", timeout: 10_000 });
  await modal.locator("#jv-input-lead-name").fill(contractors[0].name);
  const memberRow = modal.locator(".mothau-jv-member-row").first();
  await memberRow.locator(".jv-input-mst").fill(contractors[0].code);
  await memberRow.locator(".jv-input-ten").fill(contractors[0].name);
  await modal.locator("#btn-save-mothau-jv").click();
  await memberRow.locator('.jv-input-mst[aria-invalid="true"]').waitFor({ state: "visible", timeout: 10_000 });
  const duplicateMessage = (await memberRow.locator(".error-text").first().innerText()).trim();
  if (!/bị trùng trong liên danh/i.test(duplicateMessage)) {
    throw new Error(`JV inline duplicate validation message missing: ${duplicateMessage}`);
  }
  if (await page.locator("#modal-custom-dialog.active").count()) {
    throw new Error("JV duplicate validation unexpectedly opened a modal alert");
  }
  await memberRow.locator(".jv-input-mst").fill(contractors[1].code);
  await memberRow.locator(".jv-input-ten").fill(contractors[1].name);
  await modal.locator("#btn-add-mothau-jv-member").click();
  const secondJointMemberRow = modal.locator(".mothau-jv-member-row").nth(1);
  await secondJointMemberRow.locator(".jv-input-mst").fill(contractors[2].code);
  await secondJointMemberRow.locator(".jv-input-ten").fill(contractors[2].name);
  await modal.locator("#btn-save-mothau-jv").click();
  await modal.waitFor({ state: "hidden", timeout: 10_000 });
  await firstRow.locator(".mt-jv-btn-text").filter({ hasText: "(2)" }).waitFor({ state: "visible" });
  mark("joint-venture-created-and-duplicate-blocked");

  if (await openingRows.count() < 2) await addButton.click();
  const secondRow = openingRows.nth(1);
  await fillOpeningRow(page, secondRow, { type: "Độc lập", contractor: contractors[3], price: 600_000 });
  const openingDraft = await page.locator("#mothau-table-tbody tr").evaluateAll((rows) => rows.map((row) => ({
    type: row.querySelector(".mt-loai-nha-thau")?.value || "",
    code: row.querySelector(".mt-ma-nha-thau")?.value || "",
    name: row.querySelector(".mt-ten-nha-thau")?.value || "",
  })));
  if (openingDraft.some((row) => !row.code.trim() || !row.name.trim())) {
    throw new Error(`Opening row lost contractor identity before save: ${JSON.stringify(openingDraft)}`);
  }
  await page.locator("#btn-mothau-save").click();
  const evaluationTab = page.locator('[data-workflow-tab="eval_tech"]');
  const openingOutcome = await Promise.race([
    evaluationTab.waitFor({ state: "visible", timeout: 20_000 }).then(() => "advanced"),
    page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 20_000 }).then(() => "dialog"),
  ]);
  if (openingOutcome === "dialog") {
    throw new Error(`Opening save blocked: ${await page.locator("#modal-custom-dialog").innerText()}; HTTP=${JSON.stringify(httpErrors)}; pageErrors=${JSON.stringify(pageErrors)}`);
  }
  mark("opening-saved");

  const databaseOpening = fixture("verify");
  mark("opening-postgres-verified", databaseOpening);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await activateWorkflowTab(page, "opening");
  const jvLink = page.locator("#mothau-table-tbody .mt-jv-view-link").first();
  await jvLink.waitFor({ state: "visible", timeout: 20_000 });
  await jvLink.click();
  const viewModal = page.locator("#modal-mothau-jv-view");
  await viewModal.waitFor({ state: "visible" });
  const viewText = await viewModal.innerText();
  if (![contractors[0].name, contractors[1].name, contractors[2].name].every((name) => viewText.includes(name))) {
    throw new Error(`Joint venture members missing after reload: ${viewText}`);
  }
  await viewModal.locator("#btn-ok-mothau-jv-view").click();
  mark("joint-venture-reloaded");

  await activateWorkflowTab(page, "eval_tech");
  await page.locator("#danhgiahsdt-so-baocao").fill(`${runId}/BC-DG`);
  await page.locator("#danhgiahsdt-ngay-baocao").fill(testClock.date(-11));
  const evaluationRows = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]");
  if (await evaluationRows.count() !== 2) throw new Error("Expected two evaluation rows");
  for (const row of await evaluationRows.all()) {
    await row.locator(".mt-dg-hop-le").selectOption({ label: "Đạt" }, { force: true });
    await row.locator(".mt-dg-nang-luc").selectOption({ label: "Đạt" }, { force: true });
    await row.locator(".mt-dg-ky-thuat").fill("Đạt");
    const isJoint = (await row.innerText()).includes("Liên danh");
    await row.locator(".mt-gia-xep-hang").fill(isJoint ? "400000" : "600000");
    await row.locator(".mt-gia-de-nghi-trung-thau").fill(isJoint ? "400000" : "600000");
  }
  await page.locator("#btn-danhgiahsdt-save").click();
  try {
    await page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const diagnostics = await evaluationRows.evaluateAll((rows) => rows.map((row) => ({
      text: row.innerText,
      bidId: row.dataset.bidId || "",
      rankingPrice: row.querySelector(".mt-gia-xep-hang")?.value || "",
      proposedPrice: row.querySelector(".mt-gia-de-nghi-trung-thau")?.value || "",
      lowPriceDecision: row.querySelector(".mt-low-price-acceptance:checked")?.value || "",
      technicalValue: row.querySelector(".mt-dg-ky-thuat")?.value || "",
      technicalValidation: row.querySelector(".mt-dg-ky-thuat")?.validationMessage || "",
    })));
    throw new Error(`Mandatory low-price prompt did not appear: ${JSON.stringify({
      diagnostics,
      toasts: await page.locator(".bf-toast").allInnerTexts(),
      httpErrors,
      pageErrors,
    })}; ${error.message}`);
  }
  const lowPriceMessage = (await page.locator("#dialog-message").innerText()).trim();
  if (!/Chấp thuận hoặc Không chấp thuận/i.test(lowPriceMessage)) {
    throw new Error(`Missing mandatory low-price decision: ${lowPriceMessage}`);
  }
  await page.locator("#btn-dialog-ok").click();
  const jointEvaluationRow = evaluationRows.filter({ hasText: "Liên danh" });
  await jointEvaluationRow.locator('.mt-low-price-acceptance[value="false"]').check();
  await page.locator("#btn-danhgiahsdt-save").click();
  await waitForEvaluationSave(page, httpErrors, pageErrors);
  const rejectedEvaluation = fixture("verify_evaluation", { expectedLowPriceDecision: false });
  mark("low-price-joint-venture-rejected", rejectedEvaluation);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await activateWorkflowTab(page, "eval_tech");
  const reloadedRejectedRow = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").filter({ hasText: "Liên danh" });
  const rejectedRadio = reloadedRejectedRow.locator('.mt-low-price-acceptance[value="false"]');
  if (!await rejectedRadio.isChecked()) throw new Error("Rejected low-price decision was lost after reload");
  await page.locator("#btn-danhgiahsdt-save").click();
  const acceptedRadio = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]")
    .filter({ hasText: "Liên danh" })
    .locator('.mt-low-price-acceptance[value="true"]');
  await acceptedRadio.waitFor({ state: "visible", timeout: 10_000 });
  await acceptedRadio.check();
  await page.locator("#btn-danhgiahsdt-save").click();
  await waitForEvaluationSave(page, httpErrors, pageErrors);
  const acceptedEvaluation = fixture("verify_evaluation", { expectedLowPriceDecision: true });
  mark("low-price-rejection-changed-to-acceptance", acceptedEvaluation);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await activateWorkflowTab(page, "eval_tech");
  const reloadedAcceptedRadio = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]")
    .filter({ hasText: "Liên danh" })
    .locator('.mt-low-price-acceptance[value="true"]');
  if (!await reloadedAcceptedRadio.isChecked()) throw new Error("Accepted low-price decision was lost after reload");
  mark("low-price-acceptance-reloaded");

  const generalReportRowText = await page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]")
    .filter({ hasText: "Liên danh" }).innerText();
  if (!generalReportRowText.includes("Chấp thuận")) {
    throw new Error(`General evaluation report lost the low-price decision: ${generalReportRowText}`);
  }
  await page.locator("#btn-danhgiahsdt-detail").click();
  const detailedPanel = page.locator('[aria-label="Báo cáo đánh giá chi tiết"]');
  await detailedPanel.waitFor({ state: "visible", timeout: 15_000 });
  const detailedBidSelect = page.locator("#detailed-evaluation-bid-select");
  const jointBidOption = await detailedBidSelect.locator("option").evaluateAll((options, name) => (
    options.find((option) => option.textContent.includes(name))?.value || ""
  ), contractors[0].name);
  if (!jointBidOption) throw new Error("Joint venture is missing from the detailed report selector");
  await detailedBidSelect.evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, jointBidOption);
  const lowPriceSummary = page.locator(".detailed-evaluation-low-price-decision");
  await lowPriceSummary.waitFor({ state: "visible", timeout: 10_000 });
  if (!(await lowPriceSummary.innerText()).includes("Chấp thuận")) {
    throw new Error(`Detailed report lost the accepted low-price decision: ${await lowPriceSummary.innerText()}`);
  }
  mark("low-price-general-and-detailed-reports-verified");
  await page.locator("#btn-detailed-evaluation-back").click();
  await page.locator("#danhgiahsdt-table-tbody").waitFor({ state: "visible", timeout: 10_000 });
  await activateWorkflowTab(page, "eval_tech");
  if (!await page.locator("#danhgiahsdt-table-tbody .mt-gia-xep-hang").count()) {
    await page.locator("#btn-danhgiahsdt-save").click();
  }
  await page.locator("#danhgiahsdt-table-tbody .mt-gia-xep-hang").first().waitFor({ state: "visible", timeout: 10_000 });

  const setJointProposedPrice = async (price) => {
    const row = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").filter({ hasText: "Liên danh" });
    await row.locator(".mt-gia-xep-hang").fill(String(price));
    await row.locator(".mt-gia-de-nghi-trung-thau").fill(String(price));
    await row.locator(".mt-gia-de-nghi-trung-thau").press("Tab");
    return row;
  };
  let boundaryRow = await setJointProposedPrice(500_000);
  if (!await boundaryRow.locator(".evaluation-low-price-decision").isHidden()) {
    throw new Error("Exactly 50% incorrectly shows a low-price warning");
  }
  await page.locator("#btn-danhgiahsdt-save").click();
  await waitForEvaluationSave(page, httpErrors, pageErrors);
  const exactHalfEvidence = fixture("verify_evaluation", { expectedLowPriceDecision: null });
  mark("low-price-exact-half-persisted", exactHalfEvidence);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await activateWorkflowTab(page, "eval_tech");
  boundaryRow = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").filter({ hasText: "Liên danh" });
  if (!await boundaryRow.locator(".evaluation-low-price-decision").isHidden()) {
    throw new Error("Exactly 50% warning returned after reload");
  }
  await page.locator("#btn-danhgiahsdt-save").click();
  await page.locator("#danhgiahsdt-table-tbody .mt-gia-xep-hang").first().waitFor({ state: "visible", timeout: 10_000 });
  const boundaryCases = [
    { price: 600_000, warning: false, label: "above-half" },
    { price: 499_999, warning: true, label: "one-unit-below-half" },
    { price: 490_000, warning: true, label: "forty-nine-percent" },
    { price: 300_000, warning: true, label: "thirty-percent" },
    { price: 1, warning: true, label: "small-positive" },
  ];
  for (const boundaryCase of boundaryCases) {
    boundaryRow = await setJointProposedPrice(boundaryCase.price);
    const visible = await boundaryRow.locator(".evaluation-low-price-decision").isVisible();
    if (visible !== boundaryCase.warning) {
      throw new Error(`Wrong low-price warning for ${boundaryCase.label}: ${visible}`);
    }
  }
  boundaryRow = await setJointProposedPrice(400_000);
  await page.locator("#btn-danhgiahsdt-save").click();
  await page.locator("#modal-custom-dialog.active").waitFor({ state: "visible", timeout: 10_000 });
  const transitionMessage = await page.locator("#dialog-message").innerText();
  if (!transitionMessage.includes("Chấp thuận hoặc Không chấp thuận")) {
    throw new Error(`Above-to-below transition did not require a decision: ${transitionMessage}`);
  }
  await page.locator("#btn-dialog-ok").click();
  await boundaryRow.locator('.mt-low-price-acceptance[value="true"]').check();
  await page.locator("#btn-danhgiahsdt-save").click();
  await waitForEvaluationSave(page, httpErrors, pageErrors);
  const boundaryTransitionEvidence = fixture("verify_evaluation", { expectedLowPriceDecision: true });
  mark("low-price-ui-boundaries-and-transition-verified", boundaryTransitionEvidence);

  const reloginContext = await browser.newContext({ locale: "vi-VN" });
  const reloginPage = await reloginContext.newPage();
  await loginAndSelectWorkspace(reloginPage);
  await openPackage(reloginPage, "eval_tech");
  const reloginAcceptedRadio = reloginPage.locator("#danhgiahsdt-table-tbody tr[data-bid-id]")
    .filter({ hasText: "Liên danh" })
    .locator('.mt-low-price-acceptance[value="true"]');
  if (!await reloginAcceptedRadio.isChecked()) throw new Error("Accepted low-price decision was lost after relogin");
  await reloginContext.close();
  mark("low-price-acceptance-relogin-verified");

  await loginAndSelectWorkspace(page);
  await openPackage(page, "result");
  httpErrors.length = 0;
  mark("primary-context-reauthenticated-after-session-replacement");

  await activateWorkflowTab(page, "eval_tech");
  await page.locator("#btn-danhgiahsdt-save").click();
  const exportButton = page.locator("#btn-danhgiahsdt-download-excel");
  await exportButton.waitFor({ state: "visible", timeout: 10_000 });
  const [evaluationDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    exportButton.click(),
  ]);
  const exportPath = await evaluationDownload.path();
  if (!exportPath) throw new Error("Evaluation export did not produce a local file");
  const exportEvidence = fixture("inspect_export", {
    exportPath,
    expectedNames: [contractors[0].name, contractors[1].name, contractors[2].name],
  });
  mark("joint-venture-low-price-excel-export-verified", {
    filename: evaluationDownload.suggestedFilename(),
    ...exportEvidence,
  });

  await activateWorkflowTab(page, "result");
  const resultExportButton = page.locator("#btn-result-export-excel-template");
  await resultExportButton.waitFor({ state: "visible", timeout: 10_000 });
  const [resultDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    resultExportButton.click(),
  ]);
  const resultExportPath = await resultDownload.path();
  if (!resultExportPath) throw new Error("Award-result export did not produce a local file");
  const resultExportEvidence = fixture("inspect_export", {
    exportPath: resultExportPath,
    expectedNames: [contractors[0].name, contractors[1].name, contractors[2].name],
  });
  mark("joint-venture-award-excel-export-verified", {
    filename: resultDownload.suggestedFilename(),
    ...resultExportEvidence,
  });
  await page.locator("#award-so-bctd").fill(`${runId}/BC-TD`);
  await page.locator("#award-ngay-bctd").fill(testClock.date(-11));
  await page.locator("#award-decision-no").fill(`${runId}/QD-KQ`);
  await page.locator("#award-decision-date").fill(testClock.date(-11));
  const resultRows = page.locator("#approve-bidders-tbody tr[data-approve-bid-id]");
  const jointResultRow = resultRows.filter({ hasText: contractors[0].name });
  const independentResultRow = resultRows.filter({ hasText: contractors[3].name });
  await jointResultRow.locator(".row-status-select").selectOption("trung", { force: true });
  await jointResultRow.locator(".row-gia-trung").fill("400000");
  await jointResultRow.locator(".row-tg-goithau").fill("90 ngày");
  await jointResultRow.locator(".row-tg-hopdong").fill("90 ngày và bảo hành");
  await independentResultRow.locator(".row-status-select").selectOption("truot", { force: true });
  await page.locator("#award-so-bctd").fill(`${runId}/BC-TD`);
  await page.locator("#award-ngay-bctd").fill(testClock.date(-11));
  await page.locator("#award-decision-no").fill(`${runId}/QD-KQ`);
  await page.locator("#award-decision-date").fill(testClock.date(-11));
  const awardDraft = await page.evaluate(() => ({
    appraisalNumber: document.getElementById("award-so-bctd")?.value || "",
    appraisalDate: document.getElementById("award-ngay-bctd")?.value || "",
    decisionNumber: document.getElementById("award-decision-no")?.value || "",
    decisionDate: document.getElementById("award-decision-date")?.value || "",
    rows: [...document.querySelectorAll("#approve-bidders-tbody tr")].map((row) => ({
      name: row.querySelector(".row-ten-nha-thau")?.value || row.innerText,
      status: row.querySelector(".row-status-select")?.value || "",
      price: row.querySelector(".row-gia-trung")?.value || "",
      packageDuration: row.querySelector(".row-tg-goithau")?.value || "",
      contractDuration: row.querySelector(".row-tg-hopdong")?.value || "",
    })),
  }));
  const winningDraft = awardDraft.rows.find((row) => row.status === "trung");
  if (!awardDraft.appraisalNumber || !awardDraft.appraisalDate || !awardDraft.decisionNumber || !awardDraft.decisionDate
    || !winningDraft?.price || !winningDraft.packageDuration || !winningDraft.contractDuration) {
    throw new Error(`Award draft is incomplete before approval: ${JSON.stringify(awardDraft)}`);
  }
  await page.locator("#btn-approve-award").click();
  try {
    await page.waitForFunction(() => (
      Boolean(document.querySelector(".award-result-card")?.getClientRects().length)
      || document.getElementById("modal-custom-dialog")?.classList.contains("active")
    ), null, { timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      dialogClass: document.getElementById("modal-custom-dialog")?.className || "",
      dialogText: document.getElementById("modal-custom-dialog")?.innerText || "",
      toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.innerText),
      resultRows: [...document.querySelectorAll("#approve-bidders-tbody tr")].map((row) => row.innerText),
    }));
    throw new Error(`Award approval did not complete: ${JSON.stringify(diagnostics)}; HTTP=${JSON.stringify(httpErrors)}; pageErrors=${JSON.stringify(pageErrors)}; ${error.message}`);
  }
  if (await page.locator("#modal-custom-dialog.active").isVisible()) {
    throw new Error(`Award approval blocked: ${await page.locator("#modal-custom-dialog").innerText()}; HTTP=${JSON.stringify(httpErrors)}; pageErrors=${JSON.stringify(pageErrors)}`);
  }
  const resultText = await page.locator("#detail-workflow-content-wrapper").innerText();
  if (!resultText.includes(contractors[0].name)) {
    throw new Error(`Approved joint venture not shown in result: ${resultText.slice(0, 1000)}`);
  }
  await page.locator('#detail-workflow-content-wrapper [data-bf-action="show-jv"]').first().click();
  const resultJointVentureModal = page.locator("#modal-mothau-jv-view");
  await resultJointVentureModal.waitFor({ state: "visible", timeout: 10_000 });
  const approvedMembers = await resultJointVentureModal.innerText();
  if (![contractors[0].name, contractors[1].name, contractors[2].name].every((name) => approvedMembers.includes(name))) {
    throw new Error(`Approved joint-venture members are incomplete: ${approvedMembers}`);
  }
  await resultJointVentureModal.locator("#btn-ok-mothau-jv-view").click();
  mark("joint-venture-award-approved");

  const wordExportButton = page.locator("#btn-export-docx-report");
  await wordExportButton.waitFor({ state: "visible", timeout: 10_000 });
  if (await wordExportButton.isDisabled()) throw new Error("Word export entitlement is unexpectedly disabled");
  const wordDownloadPromise = page.waitForEvent("download", { timeout: 30_000 })
    .then((download) => ({ type: "download", download }))
    .catch(() => null);
  const wordErrorPromise = page.locator("#modal-custom-dialog.active")
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(async () => ({ type: "error", message: await page.locator("#modal-custom-dialog").innerText() }))
    .catch(() => null);
  await wordExportButton.click();
  const wordOutcome = await Promise.race([
    wordDownloadPromise,
    wordErrorPromise,
    new Promise((resolveOutcome) => setTimeout(() => resolveOutcome(null), 31_000)),
  ]);
  if (!wordOutcome || wordOutcome.type !== "download") {
    throw new Error(`Word export failed: ${JSON.stringify({ wordOutcome, httpErrors, pageErrors })}`);
  }
  const wordDownload = wordOutcome.download;
  await wordDownload.saveAs(wordExportPath);
  const wordEvidence = fixture("inspect_docx", {
    exportPath: wordExportPath,
    expectedNames: [contractors[0].name, contractors[1].name, contractors[2].name],
  });
  mark("joint-venture-word-report-exported-and-inspected", {
    filename: wordDownload.suggestedFilename(),
    ...wordEvidence,
  });

  await openCreateModal(page, "/hop-dong", "#btn-add-hopdong", "#modal-hopdong");
  await page.locator("#hd-so").fill(`${runId}/HD-JV`);
  await page.locator("#hd-ten").fill(`Hợp đồng liên danh ${runId}`);
  await page.locator("#hd-ngayky").fill(testClock.date(-10));
  await select(page, "#hd-chudautuid", { label: `Chủ đầu tư ${runId}` });
  await select(page, "#hd-nhathauid", { label: contractors[0].name });
  await page.locator("#hd-giatri").fill("400000");
  await select(page, "#hd-loai", { label: "Trọn gói" });
  await select(page, "#hd-phanloai", { label: "Khác" });
  await page.locator("#hd-songay").fill("90 ngày");
  await select(page, "#hd-kehoachid", { label: `Kế hoạch ${runId}` });
  await page.locator(`input[name="hd-goithau-checkbox"][value="${packageData.id}"]`).check();
  await select(page, "#hd-nhanvienphutrach", { index: 1 });
  await select(page, "#hd-trangthai-hopdong", { label: "Đang thực hiện" });
  await submitModal(page, "#form-hopdong", "#modal-hopdong");
  await page.locator("#search-hopdong").fill(`Hợp đồng liên danh ${runId}`);
  const contractRow = page.locator("#hopdong-table tbody tr").filter({ hasText: `Hợp đồng liên danh ${runId}` });
  await contractRow.waitFor({ state: "visible", timeout: 15_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#search-hopdong").fill(`Hợp đồng liên danh ${runId}`);
  await contractRow.waitFor({ state: "visible", timeout: 15_000 });
  const contractEvidence = fixture("verify_contract");
  mark("joint-venture-contract-created-and-reloaded", contractEvidence);
  }

  await openPackage(page, "opening", lotPackageData);
  const lotAddButton = page.locator("#btn-mothau-add-bid");
  const lotOpeningRows = page.locator("#mothau-table-tbody tr");
  while (await lotOpeningRows.count() < 3) await lotAddButton.click();
  const lotOpeningSpecs = [
    { lot: lotPackageData.lots[0], type: "Liên danh", contractor: contractors[0], price: 400_000 },
    { lot: lotPackageData.lots[1], type: "Liên danh", contractor: contractors[0], price: 200_000 },
    { lot: lotPackageData.lots[1], type: "Độc lập", contractor: contractors[3], price: 300_000 },
  ];
  for (let index = 0; index < lotOpeningSpecs.length; index += 1) {
    const spec = lotOpeningSpecs[index];
    const row = lotOpeningRows.nth(index);
    await row.locator(".mt-ma-phan-lo").selectOption(spec.lot.code, { force: true });
    await fillOpeningRow(page, row, spec);
    if (spec.type === "Liên danh") await configureJointMembers(page, row);
  }
  await page.locator("#btn-mothau-save").click();
  await waitForOpeningAdvance(page, httpErrors, pageErrors, "Multi-lot opening save");
  mark("joint-venture-multi-lot-opening-saved", { bids: 3, jointLots: 2 });

  const evaluateLot = async ({ lot, sequence, jointPrice, independentPrice = null, rejectJoint = false }) => {
    if (await page.locator("#modal-custom-dialog.active").isVisible()) {
      throw new Error(`Multi-lot evaluation started with an open dialog: ${JSON.stringify({
        dialog: await page.locator("#modal-custom-dialog").innerText(),
        httpErrors,
        pageErrors,
      })}`);
    }
    await activateWorkflowTab(page, "eval_tech");
    if (sequence > 1) {
      await page.locator("#btn-continue-lot-evaluation").waitFor({ state: "visible", timeout: 15_000 });
      await page.locator("#btn-continue-lot-evaluation").click();
      await page.locator("#danhgiahsdt-so-baocao").waitFor({ state: "visible", timeout: 15_000 });
    }
    await selectEvaluationLot(page, lot.code);
    await page.locator("#danhgiahsdt-so-baocao").fill(`${runId}/BC-LOT-${sequence}`);
    await page.locator("#danhgiahsdt-ngay-baocao").fill(sequence === 1 ? testClock.date(-10) : testClock.date(-7));
    const scopedRows = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").filter({ hasText: lot.code });
    const expectedRows = independentPrice === null ? 1 : 2;
    if (await scopedRows.count() !== expectedRows) {
      throw new Error(`Lot ${lot.code} expected ${expectedRows} evaluation rows, got ${await scopedRows.count()}`);
    }
    for (const row of await scopedRows.all()) {
      await row.locator(".mt-dg-hop-le").selectOption({ label: "Đạt" }, { force: true });
      await row.locator(".mt-dg-nang-luc").selectOption({ label: "Đạt" }, { force: true });
      await row.locator(".mt-dg-ky-thuat").fill("Đạt");
      const isJoint = (await row.innerText()).includes("Liên danh");
      const price = isJoint ? jointPrice : independentPrice;
      await row.locator(".mt-gia-xep-hang").fill(String(price));
      await row.locator(".mt-gia-de-nghi-trung-thau").fill(String(price));
      if (isJoint && rejectJoint) {
        await row.locator('.mt-low-price-acceptance[value="false"]').check();
      }
    }
    // Ranking/conclusion updates are intentionally batched to animation frames.
    // Wait for that public UI state to settle before submitting the report so
    // the click cannot race the pending low-price/conclusion projection.
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    let evaluationReadiness = null;
    const readinessInput = {
      expectedCount: expectedRows,
      expectedLotCode: lot.code,
      requiresRejection: rejectJoint,
    };
    try {
      const readinessHandle = await page.waitForFunction(evaluationControlsBarrier, {
        ...readinessInput,
        reportUnready: false,
      }, { timeout: 10_000 });
      evaluationReadiness = await readinessHandle.jsonValue();
      await readinessHandle.dispose();
    } catch (error) {
      evaluationReadiness = await page.evaluate(evaluationControlsBarrier, {
        expectedCount: expectedRows,
        expectedLotCode: lot.code,
        requiresRejection: rejectJoint,
        reportUnready: true,
      });
      throw new Error(
        `Lot ${lot.code} evaluation controls did not settle: ${JSON.stringify(evaluationReadiness)}`,
        { cause: error },
      );
    }
    await page.locator("#btn-danhgiahsdt-save:visible").click();
    try {
      await page.locator("#award-so-bctd").waitFor({ state: "visible", timeout: 20_000 });
    } catch (error) {
      const diagnostics = await page.evaluate(async (packageId) => {
        const { getAppController } = await import("/frontend/app/controllerRef.js");
        const controller = getAppController();
        const pkg = controller?.model?.state?.goithau?.find(
          (item) => String(item.id) === String(packageId),
        );
        return {
          currentTab: controller?.currentDanhGiaTab || "",
          currentView: controller?.currentEvaluationView || "",
          workflowTab: controller?.view?._currentWorkflowTab || "",
          scopeStore: controller?._evaluationLotScopes || {},
          metadata: pkg?.danhGiaHsdtMetadata || "",
          dialog: document.querySelector("#modal-custom-dialog.active")?.textContent?.trim() || "",
          toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.textContent?.trim()),
          rows: [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")].map((row) => ({
            text: row.innerText,
            proposedPrice: row.querySelector(".mt-gia-de-nghi-trung-thau")?.value || "",
            conclusion: row.querySelector(".mt-ketluan-cell")?.textContent?.trim() || "",
          })),
        };
      }, lotPackageData.id);
      throw new Error(`Lot ${lot.code} evaluation did not advance to result: ${JSON.stringify({
        diagnostics,
        httpErrors,
        pageErrors,
      })}; ${error.message}`);
    }
  };

  const approveLot = async ({ lot, sequence, winnerName, price }) => {
    await page.locator("#award-so-bctd").fill(`${runId}/BC-TD-LOT-${sequence}`);
    await page.locator("#award-ngay-bctd").fill(sequence === 1 ? testClock.date(-9) : testClock.date(-6));
    await page.locator("#award-decision-no").fill(`${runId}/QD-LOT-${sequence}`);
    await page.locator("#award-decision-date").fill(sequence === 1 ? testClock.date(-8) : testClock.date(-5));
    const rows = page.locator("#approve-bidders-tbody tr[data-approve-bid-id]");
    const rowDiagnostics = await rows.evaluateAll((items) => items.map((row) => ({
      bidId: row.dataset.approveBidId || "",
      text: row.innerText,
      qualified: row.dataset.isQualified || "",
      status: row.querySelector(".row-status-select")?.value || "",
      statusDisabled: Boolean(row.querySelector(".row-status-select")?.disabled),
    })));
    if (rowDiagnostics.some((row) => !row.text.includes(lot.code))) {
      const packageState = await page.evaluate(async (packageId) => {
        const { getAppController } = await import("/frontend/app/controllerRef.js");
        const pkg = getAppController()?.model?.state?.goithau?.find(
          (item) => String(item.id) === String(packageId),
        );
        return {
          metadata: pkg?.danhGiaHsdtMetadata || "",
          status: pkg?.trangThai || "",
          scopeStore: getAppController()?._evaluationLotScopes || {},
          currentEvaluationTab: getAppController()?.currentDanhGiaTab || "",
          selectedMode: document.querySelector(
            'input[name="danhgiahsdt-scope-mode"][value="selected"]',
          )?.checked || false,
          checkedLotIds: [...document.querySelectorAll(
            "#danhgiahsdt-lot-options [data-evaluation-lot-id]:checked",
          )].map((input) => input.getAttribute("data-evaluation-lot-id")),
        };
      }, lotPackageData.id);
      throw new Error(`Lot ${lot.code} result approval leaked bidders from another scope: ${JSON.stringify({
        rowDiagnostics,
        packageState,
      })}`);
    }
    for (const row of await rows.all()) {
      const isWinner = (await row.innerText()).includes(winnerName);
      const status = row.locator(".row-status-select");
      if (await status.isDisabled()) {
        if (isWinner || await status.inputValue() !== "truot") {
          throw new Error(`Lot ${lot.code} has an invalid locked award status: ${JSON.stringify(rowDiagnostics)}`);
        }
      } else {
        await status.selectOption(isWinner ? "trung" : "truot", { force: true });
      }
      if (isWinner) {
        await row.locator(".row-gia-trung").fill(String(price));
        await row.locator(".row-tg-goithau").fill("90 ngày");
        await row.locator(".row-tg-hopdong").fill("90 ngày và bảo hành");
      }
    }
    await page.locator("#btn-approve-award").click();
    await page.locator(".evaluation-round-card").waitFor({ state: "visible", timeout: 20_000 });
    const resultText = await page.locator("#detail-workflow-content-wrapper").innerText();
    if (!resultText.includes(lot.code)) throw new Error(`Approved lot ${lot.code} missing from result`);
  };

  await evaluateLot({ lot: lotPackageData.lots[0], sequence: 1, jointPrice: 400_000 });
  await approveLot({ lot: lotPackageData.lots[0], sequence: 1, winnerName: contractors[0].name, price: 400_000 });
  await page.getByText("Còn 1 phần lô chưa có kết quả", { exact: false }).waitFor({ state: "visible", timeout: 20_000 });
  mark("joint-venture-won-first-lot");

  await evaluateLot({
    lot: lotPackageData.lots[1], sequence: 2,
    jointPrice: 200_000, independentPrice: 300_000, rejectJoint: true,
  });
  await approveLot({ lot: lotPackageData.lots[1], sequence: 2, winnerName: contractors[3].name, price: 300_000 });
  await page.locator(".award-result-card").waitFor({ state: "visible", timeout: 20_000 });
  const multiLotEvidence = fixture("verify_lot_outcomes");
  mark("joint-venture-multi-lot-outcomes-verified", multiLotEvidence);

  if (!multiLotOnly) {
  await openPackage(page, "opening_tech", twoEnvelopePackageData);
  const twoEnvelopeRows = page.locator("#mothau-table-tbody tr");
  while (await twoEnvelopeRows.count() < 2) await page.locator("#btn-mothau-add-bid").click();
  const twoEnvelopeOpeningSpecs = [
    { type: "Liên danh", contractor: contractors[0] },
    { type: "Độc lập", contractor: contractors[3] },
  ];
  for (let index = 0; index < twoEnvelopeOpeningSpecs.length; index += 1) {
    const spec = twoEnvelopeOpeningSpecs[index];
    const row = twoEnvelopeRows.nth(index);
    const typeSelect = row.locator(".mt-loai-nha-thau");
    await typeSelect.evaluate((element, value) => {
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, spec.type);
    await row.locator(".mt-ma-nha-thau").fill(spec.contractor.code);
    await row.locator(".mt-ten-nha-thau").fill(spec.contractor.name);
    await row.locator(".mt-dam-bao-du-thau").fill("10000");
    await row.locator(".mt-hieu-luc-dam-bao").fill("120");
    await row.locator(".mt-hieu-luc-hsdxt").fill("90");
    if (await row.locator(".mt-gia-du-thau").count()) {
      throw new Error("Financial bid price leaked into the 1G2T technical opening");
    }
    if (spec.type === "Liên danh") await configureJointMembers(page, row);
  }
  await page.locator("#btn-mothau-save").click();
  await waitForOpeningAdvance(page, httpErrors, pageErrors, "Two-envelope technical opening save");
  mark("joint-venture-two-envelope-technical-opening-saved");

  await page.locator("#danhgiahsdt-so-baocao").fill(`${runId}/BC-2T-KT`);
  await page.locator("#danhgiahsdt-ngay-baocao").fill(testClock.date(-4));
  const twoEnvelopeEvaluationRows = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]");
  if (await twoEnvelopeEvaluationRows.count() !== 2) throw new Error("Expected two 1G2T technical evaluation rows");
  for (const row of await twoEnvelopeEvaluationRows.all()) {
    const isJoint = (await row.innerText()).includes("Liên danh");
    await row.locator(".mt-dg-hop-le").selectOption({ label: "Đạt" }, { force: true });
    await row.locator(".mt-dg-nang-luc").selectOption({ label: "Đạt" }, { force: true });
    await row.locator(".mt-dg-ky-thuat").fill(isJoint ? "Đạt" : "Không đạt");
  }
  await page.locator("#btn-danhgiahsdt-save").click();
  await page.locator('[data-workflow-tab="qualified"]').waitFor({ state: "visible", timeout: 20_000 });
  const qualifiedText = await page.locator("#detail-workflow-content-wrapper").innerText();
  if (!qualifiedText.includes(contractors[0].name) || qualifiedText.includes(contractors[3].name)) {
    throw new Error(`1G2T technical gate is wrong: ${qualifiedText.slice(0, 1200)}`);
  }
  await page.locator("#qualified-so-bctd").fill(`${runId}/BC-TD-2T`);
  await page.locator("#qualified-ngay-bctd").fill(testClock.date(-3));
  await page.locator("#qualified-so-qd").fill(`${runId}/QD-2T-KT`);
  await page.locator("#qualified-ngay-qd").fill(testClock.date(-2));
  await page.locator("#btn-save-qualified-decision").click();
  await page.locator("#op-fin-thoigianmothau").waitFor({ state: "visible", timeout: 20_000 });
  const financialOpeningRows = page.locator("#opening-fin-table tbody tr");
  if (await financialOpeningRows.count() !== 1 || !(await financialOpeningRows.first().innerText()).includes(contractors[0].name)) {
    throw new Error("Only the qualified joint venture should reach 1G2T financial opening");
  }
  await page.locator("#op-fin-thoigianmothau").fill(testClock.dateTime(-1, "09:00"));
  await financialOpeningRows.first().locator(".op-gia-du-thau").fill("400000");
  await financialOpeningRows.first().locator(".op-ty-le-giam").fill("0");
  await page.locator("#btn-save-opening-fin").click();
  await page.locator("#danhgiahsdt-table-tbody .mt-gia-xep-hang").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#danhgiahsdt-so-baocao").fill(`${runId}/BC-2T-TC`);
  await page.locator("#danhgiahsdt-ngay-baocao").fill(testClock.date(0));
  const twoEnvelopeFinancialRow = page.locator("#danhgiahsdt-table-tbody tr[data-bid-id]").first();
  await twoEnvelopeFinancialRow.locator(".mt-gia-xep-hang").fill("400000");
  await twoEnvelopeFinancialRow.locator(".mt-gia-de-nghi-trung-thau").fill("400000");
  const automaticRanking = twoEnvelopeFinancialRow.locator(".mt-dg-tai-chinh");
  if (await automaticRanking.count()) {
    const tagName = await automaticRanking.evaluate((element) => element.tagName);
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tagName)) {
      throw new Error("Automatic ranking must be display-only");
    }
    await automaticRanking.filter({ hasText: "Xếp hạng" })
      .waitFor({ state: "visible", timeout: 10_000 });
  }
  await twoEnvelopeFinancialRow.locator('.mt-low-price-acceptance[value="true"]').check();
  await page.locator("#btn-danhgiahsdt-save").click();
  await page.locator("#award-so-bctd").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#award-so-bctd").fill(`${runId}/BC-TD-2T-KQ`);
  await page.locator("#award-ngay-bctd").fill(testClock.date(1));
  await page.locator("#award-decision-no").fill(`${runId}/QD-2T-KQ`);
  await page.locator("#award-decision-date").fill(testClock.date(2));
  const twoEnvelopeAwardRow = page.locator("#approve-bidders-tbody tr[data-approve-bid-id]").first();
  await twoEnvelopeAwardRow.locator(".row-status-select").selectOption("trung", { force: true });
  await twoEnvelopeAwardRow.locator(".row-gia-trung").fill("400000");
  await twoEnvelopeAwardRow.locator(".row-tg-goithau").fill("90 ngày");
  await twoEnvelopeAwardRow.locator(".row-tg-hopdong").fill("90 ngày và bảo hành");
  await page.locator("#btn-approve-award").click();
  await page.locator(".award-result-card").waitFor({ state: "visible", timeout: 20_000 });
  const twoEnvelopeEvidence = fixture("verify_two_envelope");
  mark("joint-venture-two-envelope-outcome-verified", twoEnvelopeEvidence);
  }

  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
  if (httpErrors.length) throw new Error(`HTTP errors: ${httpErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  if (fixtureCreated) {
    const cleanup = fixture("cleanup");
    mark("fixture-removed", cleanup);
  }
}
