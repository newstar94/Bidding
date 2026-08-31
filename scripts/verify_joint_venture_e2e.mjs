import process from "node:process";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createE2ETestClock } from "./e2e_test_clock.mjs";
import {
  isExpectedSyncReset,
  isExpectedTelemetryAuthFailure,
  isExpectedTelemetryBackpressure,
} from "./lib/e2eHttpErrors.mjs";

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

async function assignAwardResultWordTemplate(context, filename) {
  const csrfCookie = (await context.cookies(baseURL))
    .find((cookie) => cookie.name === "csrf_token");
  if (!csrfCookie?.value) throw new Error("Word assignment request is missing the CSRF cookie");
  const endpoint = `${baseURL}/api/word-publication-template-assignments`;
  const headers = {
    Origin: baseURL,
    "X-Active-Org": encodeURIComponent(organizationId),
    "X-CSRF-Token": decodeURIComponent(csrfCookie.value),
  };
  const currentResponse = await context.request.get(endpoint, { headers });
  const current = await currentResponse.json().catch(() => ({}));
  if (!currentResponse.ok()) {
    throw new Error(`Cannot read Word publication assignments: ${JSON.stringify(current)}`);
  }
  const assignmentSets = {
    ...(current.assignmentSets || current.assignments || {}),
    award_result_appraisal_report: [filename],
  };
  const saveResponse = await context.request.put(endpoint, {
    headers,
    data: {
      expectedRevision: current.revision,
      assignmentSets,
    },
  });
  const saved = await saveResponse.json().catch(() => ({}));
  if (!saveResponse.ok()) {
    throw new Error(`Cannot save Word publication assignment: ${JSON.stringify(saved)}`);
  }
  const assigned = saved.assignmentSets?.award_result_appraisal_report
    || saved.assignments?.award_result_appraisal_report
    || [];
  if (!assigned.includes(filename)) {
    throw new Error(`Saved Word publication assignment is incomplete: ${JSON.stringify(saved)}`);
  }
  return { filename, revision: saved.revision };
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

async function gotoReady(page, url) {
  const response = await page.goto(url, { waitUntil: "commit" });
  if (!response?.ok()) throw new Error(`${url} returned HTTP ${response?.status() || "unknown"}`);
  await waitForApp(page);
  return response;
}

async function reloadReady(page) {
  const currentUrl = page.url();
  await page.goto("about:blank", { waitUntil: "commit" });
  await page.goto(currentUrl, { waitUntil: "commit" });
  await waitForApp(page);
}

const workflowTabReadySelectors = {
  opening: ["#btn-mothau-save"],
  opening_tech: ["#btn-mothau-save"],
  eval_tech: ["#danhgiahsdt-so-baocao", "#btn-continue-lot-evaluation"],
  eval_fin: ["#danhgiahsdt-so-baocao", "#btn-continue-lot-evaluation"],
  qualified: ["#qualified-so-bctd"],
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
  await gotoReady(page, `${baseURL}${route}`);
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
  await gotoReady(page, `${baseURL}/dang-nhap`);
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  try {
    await page.locator("#auth-overlay").waitFor({ state: "hidden", timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      usernameError: document.getElementById("login-username")?.getAttribute("aria-invalid") || "",
      passwordError: document.getElementById("login-password")?.getAttribute("aria-invalid") || "",
      errorText: document.querySelector("#auth-error, .auth-error, [role='alert']")?.textContent?.trim() || "",
      submitDisabled: Boolean(document.querySelector("#form-auth-login button[type='submit']")?.disabled),
    }));
    throw new Error(`Joint-venture login did not complete: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
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
  await reloadReady(page);
  const activeOrganization = await page.evaluate(() => sessionStorage.getItem("bf_active_org") || localStorage.getItem("bf_active_org"));
  if (activeOrganization !== organizationId) {
    throw new Error(`Active workspace mismatch: expected ${organizationId}, got ${activeOrganization}`);
  }
  await page.getByText("Chế độ: Quản lý", { exact: true }).waitFor({ state: "visible" });
}

async function openPackage(page, tabId, targetPackage = packageData) {
  await gotoReady(page, `${baseURL}/goi-thau`);
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
  const selectedMode = page.locator(
    'input[name="danhgiahsdt-scope-mode"][value="selected"]:visible',
  );
  await selectedMode.check();
  const clearLots = page.locator("#danhgiahsdt-clear-all-lots:visible");
  await clearLots.waitFor({ state: "visible", timeout: 10_000 });
  if (!await clearLots.isDisabled()) await clearLots.click();
  await page.waitForFunction(() => (
    document.querySelector('input[name="danhgiahsdt-scope-mode"][value="selected"]')?.checked === true
    && [...document.querySelectorAll("#danhgiahsdt-lot-options [data-evaluation-lot-id]")]
      .every((input) => !input.checked)
  ), null, { timeout: 10_000 });
  const target = page.locator(".evaluation-lot-option:visible")
    .filter({ hasText: lotCode })
    .locator("[data-evaluation-lot-id]");
  await target.waitFor({ state: "visible", timeout: 10_000 });
  const targetId = await target.getAttribute("data-evaluation-lot-id");
  await target.check();
  await page.waitForFunction(({ expectedTargetId, expectedLotCode }) => {
    const scopeMode = document.querySelector(
      'input[name="danhgiahsdt-scope-mode"][value="selected"]',
    );
    const checkedLotIds = [...document.querySelectorAll(
      "#danhgiahsdt-lot-options [data-evaluation-lot-id]:checked",
    )].map((input) => input.getAttribute("data-evaluation-lot-id"));
    const rows = [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")];
    return scopeMode?.checked === true
      && checkedLotIds.length === 1
      && checkedLotIds[0] === expectedTargetId
      && rows.length > 0
      && rows.every((row) => row.textContent?.includes(expectedLotCode));
  }, { expectedTargetId: targetId, expectedLotCode: lotCode }, { timeout: 10_000 });
}

function evaluationControlsBarrier({ expectedCount, expectedLotCode, requiresRejection, reportUnready = false }) {
  const tbody = document.getElementById("danhgiahsdt-table-tbody");
  const rows = [...(tbody?.querySelectorAll("tr[data-bid-id]") || [])]
    .filter((row) => row.textContent?.includes(expectedLotCode));
  const activeButton = document.getElementById("btn-danhgiahsdt-save");
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

function initialJointVentureEvaluationBarrier({ reportUnready = false } = {}) {
  const rows = [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")];
  const rowState = rows.map((row) => ({
    isJointVenture: row.textContent?.includes("Liên danh") === true,
    validity: row.querySelector(".mt-dg-hop-le")?.value || "",
    capacity: row.querySelector(".mt-dg-nang-luc")?.value || "",
    technical: row.querySelector(".mt-dg-ky-thuat")?.value || "",
    rankingPrice: (row.querySelector(".mt-gia-xep-hang")?.value || "").replace(/\D/g, ""),
    proposedPrice: (row.querySelector(".mt-gia-de-nghi-trung-thau")?.value || "").replace(/\D/g, ""),
  }));
  const ready = rowState.length === 2
    && rowState.every((row) => (
      row.validity === "Đạt"
      && row.capacity === "Đạt"
      && row.technical === "Đạt"
      && row.rankingPrice === (row.isJointVenture ? "400000" : "600000")
      && row.proposedPrice === (row.isJointVenture ? "400000" : "600000")
    ));
  return reportUnready ? { ready, rowState } : ready;
}

async function waitForInitialJointVentureEvaluation(page) {
  try {
    await page.waitForFunction(initialJointVentureEvaluationBarrier, {}, { timeout: 10_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(initialJointVentureEvaluationBarrier, { reportUnready: true });
    throw new Error(
      `Initial joint-venture evaluation controls did not settle: ${JSON.stringify(diagnostics)}`,
      { cause: error },
    );
  }
}

function twoEnvelopeTechnicalEvaluationBarrier({ reportUnready = false } = {}) {
  const rows = [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")];
  const saveButton = document.getElementById("btn-danhgiahsdt-save");
  const rowState = rows.map((row) => ({
    isJointVenture: row.textContent?.includes("Liên danh") === true,
    validity: row.querySelector(".mt-dg-hop-le")?.value || "",
    capacity: row.querySelector(".mt-dg-nang-luc")?.value || "",
    technical: row.querySelector(".mt-dg-ky-thuat")?.value || "",
    conclusion: row.querySelector(".mt-ketluan-cell")?.textContent?.trim() || "",
  }));
  const ready = rowState.length === 2
    && rowState.every((row) => (
      row.validity === "Đạt"
      && row.capacity === "Đạt"
      && row.technical === (row.isJointVenture ? "Đạt" : "Không đạt")
      && (row.isJointVenture
        ? row.conclusion === "Đạt"
        : row.conclusion.startsWith("Không đạt"))
    ))
    && saveButton?.isConnected === true
    && typeof saveButton.onclick === "function";
  return reportUnready ? {
    ready,
    rowState,
    saveConnected: saveButton?.isConnected === true,
    saveBound: typeof saveButton?.onclick === "function",
  } : ready;
}

async function waitForTwoEnvelopeTechnicalEvaluation(page) {
  try {
    await page.waitForFunction(twoEnvelopeTechnicalEvaluationBarrier, {}, { timeout: 10_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(twoEnvelopeTechnicalEvaluationBarrier, { reportUnready: true });
    throw new Error(
      `Two-envelope technical evaluation controls did not settle: ${JSON.stringify(diagnostics)}`,
      { cause: error },
    );
  }
}

async function waitForEvaluationSave(page, httpErrors, pageErrors, { previousSuccessToast = null } = {}) {
  try {
    await page.waitForFunction((previousToast) => (
      (() => {
        const currentToast = document.querySelector(".bf-toast.toast-success:not(.toast-hiding)");
        return Boolean(currentToast && currentToast !== previousToast);
      })()
      || document.getElementById("modal-custom-dialog")?.classList.contains("active")
    ), previousSuccessToast, { timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
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
    });
    });
    throw new Error(`Evaluation did not complete: ${JSON.stringify(diagnostics)}; HTTP=${JSON.stringify(httpErrors)}; pageErrors=${JSON.stringify(pageErrors)}; ${error.message}`);
  }
  if (await page.locator("#modal-custom-dialog.active").isVisible()) {
    throw new Error(`Evaluation save blocked: ${await page.locator("#modal-custom-dialog").innerText()}; HTTP=${JSON.stringify(httpErrors)}; pageErrors=${JSON.stringify(pageErrors)}`);
  }
  const successToast = page.locator(".bf-toast.toast-success:not(.toast-hiding)").last();
  await successToast.waitFor({ state: "visible", timeout: 10_000 });
  await successToast.waitFor({ state: "hidden", timeout: 10_000 });
}

async function saveEvaluationAndWait(page, httpErrors, pageErrors) {
  // Retain the currently visible toast so the save barrier can distinguish a
  // new notification from one left by the preceding workflow transition.
  const previousSuccessToast = await page.evaluateHandle(() => {
    const toasts = document.querySelectorAll(".bf-toast.toast-success:not(.toast-hiding)");
    return toasts.item(toasts.length - 1) || null;
  });
  await page.locator("#btn-danhgiahsdt-save").click();
  try {
    await waitForEvaluationSave(page, httpErrors, pageErrors, { previousSuccessToast });
  } finally {
    await previousSuccessToast?.dispose();
  }
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
  const setupEvidence = fixture("setup");
  if (setupEvidence.credentialsVerified !== true) {
    throw new Error("Joint-venture fixture did not seed a usable active account");
  }
  fixtureCreated = true;
  const wordTemplateEvidence = fixture("create_word_template");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN" });
  const page = await context.newPage();
  const pageErrors = [];
  const httpErrors = [];
  const responseTrace = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", async (response) => {
    responseTrace.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    if (responseTrace.length > 80) responseTrace.shift();
    if (response.status() >= 400 && response.url().includes("/api/")
      && !isExpectedTelemetryBackpressure(response)
      && !isExpectedTelemetryAuthFailure(response)) {
      let body = "";
      try { body = await response.text(); } catch {}
      if (isExpectedSyncReset(response, body)) return;
      httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()} ${body}`);
    }
  });
  await loginAndSelectWorkspace(page);

  if (!multiLotOnly) {
  await gotoReady(page, `${baseURL}/bieu-mau`);
  await page.waitForFunction(() => {
    const input = document.getElementById("word-file-input");
    return input?.dataset.wordUploadBound === "true" && !input.disabled;
  }, null, { timeout: 20_000 });
  const uploadResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/templates/upload"
  ), { timeout: 20_000 });
  await page.locator("#word-file-input").setInputFiles(wordTemplatePath);
  const uploadResponse = await uploadResponsePromise;
  const uploadBody = await uploadResponse.text();
  if (!uploadResponse.ok()) {
    throw new Error(`Word template upload returned ${uploadResponse.status()}: ${uploadBody}`);
  }
  const uploadedTemplateRow = page.locator("#word-templates-tbody tr").filter({ hasText: runId });
  await uploadedTemplateRow.waitFor({ state: "visible", timeout: 20_000 });
  if (await page.locator("#modal-custom-dialog.active").isVisible()) {
    const uploadDialog = await page.locator("#modal-custom-dialog").innerText();
    if (!uploadDialog.includes("Thành công")) throw new Error(`Word template upload failed: ${uploadDialog}`);
    await page.locator("#btn-dialog-ok").click();
    await page.locator("#modal-custom-dialog.active").waitFor({ state: "hidden", timeout: 10_000 });
  }
  const availabilityToggle = uploadedTemplateRow.locator(".btn-toggle-template-availability");
  if (await availabilityToggle.count() && await availabilityToggle.getAttribute("aria-pressed") !== "true") {
    const activationResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/templates/active"
    ), { timeout: 20_000 });
    await availabilityToggle.click();
    const activationResponse = await activationResponsePromise;
    const activationBody = await activationResponse.text();
    if (!activationResponse.ok()) {
      throw new Error(`Word template activation returned ${activationResponse.status()}: ${activationBody}`);
    }
  }
  await page.locator("#word-templates-tbody tr").filter({ hasText: runId })
    .filter({ hasText: "Sẵn sàng" }).waitFor({ state: "visible", timeout: 20_000 });
  const uploadedTemplateFilename = await uploadedTemplateRow.getAttribute("data-filename");
  if (!uploadedTemplateFilename) throw new Error("Uploaded Word template has no filename identity");
  const assignmentEvidence = await assignAwardResultWordTemplate(
    context,
    uploadedTemplateFilename,
  );
  mark("word-template-uploaded-and-assigned", {
    ...wordTemplateEvidence,
    ...assignmentEvidence,
  });

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

  // Each field schedules the ranking projection on the next animation frame.
  // Apply this initial complete row state in one DOM turn so that projection
  // never observes, and consequently cannot retain, a partially filled row.
  await evaluationRows.evaluateAll((rows) => {
    const change = (row, selector, value) => {
      const input = row.querySelector(selector);
      if (!input) throw new Error(`Missing evaluation input ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    rows.forEach((row) => {
      const price = row.textContent?.includes("Liên danh") ? "400000" : "600000";
      change(row, ".mt-dg-hop-le", "Đạt");
      change(row, ".mt-dg-nang-luc", "Đạt");
      change(row, ".mt-dg-ky-thuat", "Đạt");
      change(row, ".mt-gia-xep-hang", price);
      change(row, ".mt-gia-de-nghi-trung-thau", price);
    });
  });
  await waitForInitialJointVentureEvaluation(page);
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
    const saveContext = await page.evaluate(() => {
      const button = document.getElementById("btn-danhgiahsdt-save");
      const form = button?.closest("form");
      return {
        url: location.href,
        buttonType: button?.getAttribute("type") || "",
        formAction: form?.getAttribute("action") || "",
        reportNumber: document.getElementById("danhgiahsdt-so-baocao")?.value || "",
        reportDate: document.getElementById("danhgiahsdt-ngay-baocao")?.value || "",
      };
    });
    throw new Error(`Mandatory low-price prompt did not appear: ${JSON.stringify({
      diagnostics,
      saveContext,
      responseTrace,
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
  await saveEvaluationAndWait(page, httpErrors, pageErrors);
  const rejectedEvaluation = fixture("verify_evaluation", { expectedLowPriceDecision: false });
  mark("low-price-joint-venture-rejected", rejectedEvaluation);

  await reloadReady(page);
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
  await saveEvaluationAndWait(page, httpErrors, pageErrors);
  const acceptedEvaluation = fixture("verify_evaluation", { expectedLowPriceDecision: true });
  mark("low-price-rejection-changed-to-acceptance", acceptedEvaluation);

  await reloadReady(page);
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
  const detailedPanel = page.locator("section.detailed-evaluation-panel");
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
  await saveEvaluationAndWait(page, httpErrors, pageErrors);
  const exactHalfEvidence = fixture("verify_evaluation", { expectedLowPriceDecision: null });
  mark("low-price-exact-half-persisted", exactHalfEvidence);

  await reloadReady(page);
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
  await saveEvaluationAndWait(page, httpErrors, pageErrors);
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

  if (await page.locator('[id="btn-export-docx-report"]').count()) {
    throw new Error("Legacy award-result Word export action must remain absent");
  }
  mark("legacy-award-word-export-absent");

  await gotoReady(page, `${baseURL}/xuat-ban-word`);
  await page.locator("#tab-xuatban-word.active").waitFor({ state: "visible", timeout: 20_000 });
  await select(page, "#word-publication-plan-select", { value: `${runId}-plan` });
  await page.locator(
    `#word-publication-package-select option[value="${packageData.id}"]`,
  ).waitFor({ state: "attached", timeout: 20_000 });
  await select(page, "#word-publication-package-select", { value: packageData.id });
  const wordExportButton = page.locator(
    '[data-word-publication-export="award_result_appraisal_report"]',
  );
  await wordExportButton.waitFor({ state: "visible", timeout: 20_000 });
  if (await wordExportButton.isDisabled()) {
    throw new Error("Assigned award-result Word publication is unexpectedly disabled");
  }
  await wordExportButton.click();
  const wordSelectionDialog = page.locator("#word-publication-export-dialog");
  await wordSelectionDialog.waitFor({ state: "visible", timeout: 10_000 });
  await wordSelectionDialog.locator(
    `[data-word-publication-template-row][data-filename="${uploadedTemplateFilename}"]`,
  ).waitFor({ state: "visible", timeout: 10_000 });
  const wordDownloadPromise = page.waitForEvent("download", { timeout: 30_000 })
    .then((download) => ({ type: "download", download }))
    .catch(() => null);
  const wordErrorPromise = page.locator("#modal-custom-dialog.active")
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(async () => ({ type: "error", message: await page.locator("#modal-custom-dialog").innerText() }))
    .catch(() => null);
  await wordSelectionDialog.locator("[data-word-publication-confirm]").click();
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
  await reloadReady(page);
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
    // Apply the entire lot in one event turn. Individual Playwright fill calls
    // cross animation-frame boundaries, which lets the batched ranking
    // projection observe a transient, partially-entered multi-lot row set.
    await scopedRows.evaluateAll((rows, {
      jointPriceValue,
      independentPriceValue,
      rejectJointValue,
    }) => {
      const change = (row, selector, value) => {
        const input = row.querySelector(selector);
        if (!input) throw new Error(`Missing evaluation input ${selector}`);
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      rows.forEach((row) => {
        const isJoint = row.textContent?.includes("Liên danh") === true;
        const price = isJoint ? jointPriceValue : independentPriceValue;
        change(row, ".mt-dg-hop-le", "Đạt");
        change(row, ".mt-dg-nang-luc", "Đạt");
        change(row, ".mt-dg-ky-thuat", "Đạt");
        change(row, ".mt-gia-xep-hang", price);
        change(row, ".mt-gia-de-nghi-trung-thau", price);
        if (isJoint && rejectJointValue) {
          const rejectRadio = row.querySelector('.mt-low-price-acceptance[value="false"]');
          if (!rejectRadio) throw new Error("Missing low-price rejection control");
          rejectRadio.checked = true;
          rejectRadio.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }, {
      jointPriceValue: jointPrice,
      independentPriceValue: independentPrice,
      rejectJointValue: rejectJoint,
    });
    // Wait for the concrete public UI projection before submitting the report
    // so the click cannot race a pending low-price/conclusion update.
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
      const diagnostics = await page.evaluate(() => {
        return {
          selectedMode: document.querySelector(
            'input[name="danhgiahsdt-scope-mode"][value="selected"]',
          )?.checked || false,
          detailPaneActive: document.getElementById("tab-goithau-detail")?.classList.contains("active") || false,
          activeWorkflowTab: document.querySelector("[data-workflow-tab][aria-selected='true']")
            ?.getAttribute("data-workflow-tab") || "",
          resultPanelRendered: Boolean(document.querySelector(
            "#detail-workflow-content-wrapper #approve-bidders-tbody, #detail-workflow-content-wrapper .award-result-card",
          )),
          saveControl: (() => {
            const button = document.getElementById("btn-danhgiahsdt-save");
            const packageSelect = document.getElementById("danhgiahsdt-goithau-select");
            const reportNumber = document.getElementById("danhgiahsdt-so-baocao");
            const reportDate = document.getElementById("danhgiahsdt-ngay-baocao");
            return {
              connected: button?.isConnected === true,
              disabled: Boolean(button?.disabled),
              packageId: packageSelect?.value || "",
              reportNumber: reportNumber?.value || "",
              reportDate: reportDate?.value || "",
              invalidFields: [...document.querySelectorAll(
                "#detail-workflow-content-wrapper :invalid, #detail-workflow-content-wrapper [aria-invalid='true']",
              )].map((input) => input.id || input.className || input.tagName),
            };
          })(),
          checkedLotIds: [...document.querySelectorAll(
            "#danhgiahsdt-lot-options [data-evaluation-lot-id]:checked",
          )].map((input) => input.getAttribute("data-evaluation-lot-id")),
          dialog: document.querySelector("#modal-custom-dialog.active")?.textContent?.trim() || "",
          toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.textContent?.trim()),
          rows: [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")].map((row) => ({
            text: row.innerText,
            proposedPrice: row.querySelector(".mt-gia-de-nghi-trung-thau")?.value || "",
            conclusion: row.querySelector(".mt-ketluan-cell")?.textContent?.trim() || "",
          })),
        };
      });
      throw new Error(`Lot ${lot.code} evaluation did not advance to result: ${JSON.stringify({
        diagnostics,
        httpErrors,
        pageErrors,
        responseTrace,
      })}; ${error.message}`);
    }
  };

  const approveLot = async ({ lot, sequence, winnerName, price }) => {
    const rows = page.locator("#approve-bidders-tbody tr[data-approve-bid-id]");
    const rowDiagnostics = await rows.evaluateAll((items) => items.map((row) => ({
      bidId: row.dataset.approveBidId || "",
      text: row.innerText,
      qualified: row.dataset.isQualified || "",
      status: row.querySelector(".row-status-select")?.value || "",
      statusDisabled: Boolean(row.querySelector(".row-status-select")?.disabled),
    })));
    if (rowDiagnostics.some((row) => !row.text.includes(lot.code))) {
      const packageState = await page.evaluate(() => {
        return {
          selectedMode: document.querySelector(
            'input[name="danhgiahsdt-scope-mode"][value="selected"]',
          )?.checked || false,
          checkedLotIds: [...document.querySelectorAll(
            "#danhgiahsdt-lot-options [data-evaluation-lot-id]:checked",
          )].map((input) => input.getAttribute("data-evaluation-lot-id")),
        };
      });
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
    // Choosing a winning bidder can rerender the approval form as its
    // dependent controls are enabled. Fill decision fields only once that
    // transient row update has settled, immediately before submission.
    await page.locator("#award-so-bctd").fill(`${runId}/BC-TD-LOT-${sequence}`);
    await page.locator("#award-ngay-bctd").fill(sequence === 1 ? testClock.date(-9) : testClock.date(-6));
    await page.locator("#award-decision-no").fill(`${runId}/QD-LOT-${sequence}`);
    await page.locator("#award-decision-date").fill(sequence === 1 ? testClock.date(-8) : testClock.date(-5));
    await page.locator("#btn-approve-award").click();
    try {
      await page.locator(".evaluation-round-card").waitFor({ state: "visible", timeout: 20_000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        dialog: document.querySelector("#modal-custom-dialog.active")?.textContent?.trim() || "",
        toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.textContent?.trim()),
        invalidFields: [...document.querySelectorAll("#detail-workflow-content-wrapper :invalid, #detail-workflow-content-wrapper [aria-invalid='true'], #detail-workflow-content-wrapper .form-group.invalid input")]
          .map((item) => ({ id: item.id || "", value: item.value || "", disabled: Boolean(item.disabled) })),
        decisionFields: [
          "award-so-bctd",
          "award-ngay-bctd",
          "award-decision-no",
          "award-decision-date",
        ].map((id) => {
          const input = document.getElementById(id);
          return {
            id,
            value: input?.value || "",
            disabled: Boolean(input?.disabled),
            invalid: Boolean(input?.closest(".form-group")?.classList.contains("invalid")),
          };
        }),
        approvalRows: [...document.querySelectorAll("#approve-bidders-tbody tr[data-approve-bid-id]")]
          .map((row) => ({
            text: row.textContent?.trim() || "",
            status: row.querySelector(".row-status-select")?.value || "",
            awardPrice: row.querySelector(".row-gia-trung")?.value || "",
            packageDuration: row.querySelector(".row-tg-goithau")?.value || "",
            contractDuration: row.querySelector(".row-tg-hopdong")?.value || "",
          })),
      }));
      throw new Error(
        `Lot ${lot.code} award approval did not render its official round: ${JSON.stringify({ diagnostics, httpErrors, pageErrors })}`,
        { cause: error },
      );
    }
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
  await twoEnvelopeEvaluationRows.evaluateAll((rows) => {
    const change = (row, selector, value) => {
      const input = row.querySelector(selector);
      if (!input) throw new Error(`Missing evaluation input ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    rows.forEach((row) => {
      change(row, ".mt-dg-hop-le", "Đạt");
      change(row, ".mt-dg-nang-luc", "Đạt");
      change(row, ".mt-dg-ky-thuat", row.textContent?.includes("Liên danh") ? "Đạt" : "Không đạt");
    });
  });
  await waitForTwoEnvelopeTechnicalEvaluation(page);
  await saveEvaluationAndWait(page, httpErrors, pageErrors);
  await activateWorkflowTab(page, "qualified");
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
