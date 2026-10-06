import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, test } from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const JOB_ID = "b".repeat(32);
const offer = {
  code: "gold.internal.yearly", tier: "gold", variant: "internal", ownerKind: "organization",
  memberQuota: 10, includedProcurementQuota: 0,
  price: { period: "yearly", currency: "VND", subtotal: 100, tax: 0, total: 100 },
  display: { name: "Original", benefits: [] },
  exportCapabilities: { "document.export.word": true }, salesState: "sellable",
};
const draft = (id) => ({
  id, revision: 1,
  document: { offers: [{ ...offer }], policies: { baseTerm: { kind: "fixed_days", days: 365 } } },
});
const job = { id: JOB_ID, operation: "render", recordType: "goi_thau", organizationId: "fixture", status: "failed", attemptCount: 1, retryAllowed: true };
let browser;
let server;
let origin;
let requests = [];
let interceptApi = null;

function defaultPayload(path, method) {
  if (path === "/api/commercial/admin/overview") return {
    currentRelease: { id: "release-1", versionLabel: "v1", nonSellable: false },
    drafts: [{ id: "draft-a", revision: 1 }, { id: "draft-b", revision: 1 }], releaseHistory: [],
  };
  if (path === "/api/public/commercial/offers") return { availability: "off", offers: [], creditPacks: [], quotaWarnings: [] };
  if (path.startsWith("/api/commercial/drafts/")) return draft(path.split("/").at(-1));
  if (path === "/api/commercial/drafts" && method === "POST") return draft("draft-new");
  if (path === "/api/admin/environment" && method === "GET") return { features: { aiEnabled: false, paymentCheckoutEnabled: false }, configuration: { writable: true } };
  if (path === "/api/admin/system/jobs") return { items: [job], pagination: { page: 1, totalPages: 1, totalRows: 1 } };
  if (path === `/api/admin/system/jobs/${JOB_ID}`) return { job };
  if (path === "/api/admin/audit") return { items: [{ id: "audit-1", action: "admin.example", result: "success", targetType: "organization", targetId: "fixture" }], pagination: { page: 1, totalPages: 1, totalRows: 1 } };
  return {};
}

before(async () => {
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/admin")) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "csrf_token=fixture; Path=/" });
        response.end(`<!doctype html><html lang="vi" data-bs-theme="light"><head><link rel="stylesheet" href="/node_modules/@tabler/core/dist/css/tabler.min.css"><link rel="stylesheet" href="/frontend/admin-platform/admin.css"><link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css"></head><body><script id="bf-admin-session" type="application/json">{"valid":true,"user":{"name":"Admin","platform_role":"super_admin"}}</script><div id="admin-app"></div><script type="module" src="/frontend/admin-platform/AdminApp.js"></script></body></html>`);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        let body = "";
        for await (const chunk of request) body += chunk;
        const entry = { path: url.pathname, query: Object.fromEntries(url.searchParams), method: request.method, body: body ? JSON.parse(body) : null };
        requests.push(entry);
        const result = await interceptApi?.(entry);
        response.writeHead(result?.status || 200, { "content-type": "application/json" });
        response.end(JSON.stringify(result?.payload ?? defaultPayload(entry.path, entry.method)));
        return;
      }
      const mapped = url.pathname.startsWith("/vendor/") ? `/views${url.pathname}` : url.pathname;
      const path = resolve(root, `.${mapped}`);
      if (!path.startsWith(`${root}${sep}`)) throw new Error("Invalid fixture path");
      const source = await readFile(path);
      response.writeHead(200, { "content-type": extname(path) === ".css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
      response.end(source);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end("");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
beforeEach(() => { requests = []; interceptApi = null; });
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise((done) => server.close(done));
});

async function withPage(path, operation) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}${path}`);
    await operation(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
async function openDraft(page, id = "draft-a") {
  await page.locator(`[data-admin-draft-open="${id}"]`).click();
  await page.locator(`[data-draft-id="${id}"]`).waitFor();
}
function nextDialog(page, accept) { page.once("dialog", (dialog) => accept ? dialog.accept() : dialog.dismiss()); }

test("admin bootstraps and saves a package when the public catalog has no effective release", async () => {
  let saved = null;
  interceptApi = async (entry) => {
    if (entry.path === "/api/commercial/admin/overview") return { payload: { currentRelease: null, scheduledRelease: null, drafts: saved ? [{ id: "first", revision: 2 }] : [], releaseHistory: [] } };
    if (entry.path === "/api/public/commercial/offers") return { status: 503, payload: { code: "COMMERCIAL_POLICY_DECISION_REQUIRED", error: "Chưa có bản phát hành thương mại hợp lệ cho giao dịch mới." } };
    if (entry.path === "/api/commercial/drafts" && entry.method === "POST") return { payload: { id: "first", revision: 1, document: { schemaVersion: 1, currency: "VND", offers: [], policies: { baseTerm: { kind: "fixed_days", days: 365 } }, unknown: { keep: true } } } };
    if (entry.path === "/api/commercial/drafts/first" && entry.method === "PATCH") {
      saved = entry.body.document;
      return { payload: { id: "first", revision: 2, document: saved } };
    }
    if (entry.path === "/api/commercial/drafts/first" && entry.method === "GET") return { payload: { id: "first", revision: 2, document: saved } };
    if (entry.path.endsWith("/validate")) return { payload: { errors: [{ path: "offers", code: "OFFER_MATRIX_INCOMPLETE", message: "Chưa đủ khung 8 gói năm" }] } };
    return null;
  };
  await withPage("/admin/plans", async page => {
    await page.getByRole("button", { name: "Tạo gói đầu tiên", exact: true }).click();
    await page.locator("#admin-new-package-name").waitFor();
    assert.equal(requests.find(entry => entry.path === "/api/commercial/drafts" && entry.method === "POST").body.templateMode, "empty");
    await page.locator("#admin-new-package-name").fill("Cá nhân do Admin tạo");
    nextDialog(page, false);
    await page.locator('[data-admin-link="/admin/security"]').click();
    assert.equal(new URL(page.url()).pathname, "/admin/plans");
    await page.locator('[data-admin-plan-action="save"]').click();
    assert.equal(requests.filter(entry => entry.method === "PATCH").length, 0);
    assert.equal(await page.locator("#admin-new-package-name").inputValue(), "Cá nhân do Admin tạo");
    await page.locator("#admin-new-package-month").check();
    await page.locator('[data-admin-plan-action="confirm-package"]').click();
    await page.locator('[data-admin-package-step="1"]').click();
    const annual = page.locator('[data-admin-offer-editor][data-offer-index="0"]');
    await annual.locator('[data-admin-offer-field="price.subtotal"]').fill("1200000");
    await page.locator("#admin-offer-vat-0").fill("10");
    await page.locator('[data-admin-vat-calculate="0"]').click();
    assert.match(await page.locator("[data-admin-package-live-preview]").textContent(), /1[.]320[.]000/u);
    await page.locator('[data-admin-package-live-preview] [data-admin-package-period="1"]').click();
    const monthly = page.locator('[data-admin-offer-editor][data-offer-index="1"]');
    await monthly.locator('[data-admin-offer-field="price.subtotal"]').fill("150000");
    await page.locator("#admin-offer-vat-1").fill("0");
    await page.locator('[data-admin-vat-calculate="1"]').click();
    const policies = page.locator(".bf-admin-package-policies");
    await policies.locator("summary").click();
    await page.locator("#admin-monthly-term-days").fill("30");
    await page.locator('[data-admin-plan-action="save"]').click();
    await page.locator('[data-admin-plan-action="validate"]:enabled').waitFor();
    assert.equal(saved.offers.length, 2);
    assert.equal(saved.offers[0].price.total, 1320000);
    assert.equal(saved.offers[1].price.total, 150000);
    assert.equal(saved.offers[0].exportCapabilities, null);
    assert.equal(saved.offers[1].exportCapabilities, null);
    assert.deepEqual(saved.unknown, { keep: true });
    assert.equal(saved.policies.monthlyBaseTerm.days, 30);
    assert.equal(saved.policies.baseTerm.days, 365);
    assert.equal(saved.offers[0].salesState, "non_sellable");
    await page.locator('[data-admin-plan-action="validate"]').click();
    await page.getByText("Chưa đủ khung 8 gói năm").waitFor();
    assert.equal(await page.locator('[data-admin-plan-action="publish"]').isDisabled(), true);
    await page.locator('[data-admin-package-step="2"]').click();
    await monthly.locator('[data-admin-plan-action="configure-exports"]').click();
    await page.locator('.modal button[type="submit"]').click();
    await monthly.locator('[data-admin-offer-field="capability:document.export.word"]').check();
    assert.equal(await page.locator('[data-admin-plan-action="validate"]').isDisabled(), true);
    await page.locator('[data-admin-plan-action="save"]').click();
    await page.locator('[data-admin-plan-action="validate"]:enabled').waitFor();
    assert.equal(saved.offers[1].exportCapabilities["document.export.word"], true);
    assert.equal(saved.offers[0].exportCapabilities, null);
    await page.locator('[data-admin-plan-action="close"]').click();
    await openDraft(page, "first");
    await page.locator('[data-admin-package-edit="0"]').first().click();
    await page.locator('[data-admin-package-live-preview] [data-admin-package-period="1"]').click();
    await page.locator('[data-admin-package-step="2"]').click();
    assert.equal(await monthly.locator('[data-admin-offer-field="capability:document.export.word"]').isChecked(), true);
    assert.match(await page.locator("[data-admin-package-live-preview]").textContent(), /150[.]000/u);
    if (process.env.BIDDING_ADMIN_PACKAGE_CAPTURE_DIR) await page.locator("#admin-commercial-editor").screenshot({ path: resolve(process.env.BIDDING_ADMIN_PACKAGE_CAPTURE_DIR, "admin-package-implemented.png") });
  });
});

test("a failed package save keeps edited content and blocks publish until authoritative retry succeeds", async () => {
  let fail = true;
  let documentValue = null;
  interceptApi = async entry => {
    if (entry.path === "/api/commercial/drafts/draft-a" && entry.method === "PATCH") {
      if (fail) return { status: 503, payload: { error: "Lưu thất bại" } };
      documentValue = entry.body.document;
      return { payload: { id: "draft-a", revision: 2, document: documentValue } };
    }
    return null;
  };
  await withPage("/admin/plans", async page => {
    await openDraft(page);
    await page.locator('[data-admin-offer-field="display.name"]').fill("Nội dung cần giữ");
    await page.locator('[data-admin-plan-action="save"]').click();
    await page.getByText("Lưu thất bại", { exact: true }).waitFor();
    assert.equal(await page.locator('[data-admin-offer-field="display.name"]').inputValue(), "Nội dung cần giữ");
    assert.equal(await page.locator('[data-admin-plan-action="publish"]').isDisabled(), true);
    assert.equal(await page.locator('[data-admin-plan-action="validate"]').isDisabled(), true);
    fail = false;
    await page.locator('[data-admin-plan-action="save"]').click();
    await page.locator('[data-admin-plan-action="validate"]:enabled').waitFor();
    assert.equal(documentValue.offers[0].display.name, "Nội dung cần giữ");
  });
});

test("admin draft selection preserves independent package periods and unedited source data", async () => {
  await withPage("/admin/plans", async page => {
    await openDraft(page);
    await page.locator('[data-admin-offer-field="display.name"]').fill("Tên mới");
    await page.locator('[data-admin-package-back]').click();
    await page.locator('[data-admin-package-manager="draft"] [data-admin-package-layout="cards"]').click();
    assert.match(await page.locator('[data-admin-package-manager="draft"] [data-admin-package-cards]').textContent(), /Tên mới/u);
    await page.locator('[data-admin-package-edit="0"]').last().click();
    assert.equal(await page.locator('[data-admin-offer-field="display.name"]').inputValue(), "Tên mới");
    assert.equal(await page.locator('[data-admin-plan-action="validate"]').isDisabled(), true);
  });
});

test("an unauthorized admin overview never shows bootstrap actions", async () => {
  interceptApi = async entry => entry.path === "/api/commercial/admin/overview"
    ? { status: 403, payload: { code: "FORBIDDEN", error: "Không có quyền" } } : null;
  await withPage("/admin/plans", async page => {
    await page.locator('[data-admin-state="permission"]').waitFor();
    assert.equal(await page.locator('[data-admin-plan-action="create"]').count(), 0);
    assert.equal(requests.filter(entry => entry.method === "POST").length, 0);
  });
});

test("dirty commercial editor cancels create clone and route changes and confirms discard", async () => {
  await withPage("/admin/plans", async (page) => {
    await openDraft(page);
    await page.locator('[data-admin-offer-field="display.name"]').fill("Edited unsaved");
    for (const action of ["create", "clone"]) {
      nextDialog(page, false);
      await page.locator(`[data-admin-plan-action="${action}"]`).click();
      assert.equal(await page.locator('[data-admin-offer-field="display.name"]').inputValue(), "Edited unsaved");
      assert.equal(await page.locator(".modal").count(), 0);
    }
    nextDialog(page, false);
    await page.locator('[data-admin-link="/admin/security"]').click();
    assert.equal(new URL(page.url()).pathname, "/admin/plans");
    assert.equal(await page.locator('[data-admin-offer-field="display.name"]').inputValue(), "Edited unsaved");
    assert.equal(requests.filter((entry) => entry.method === "POST").length, 0);
    assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }))), true);
    nextDialog(page, true);
    await page.locator('[data-admin-plan-action="create"]').click();
    await page.locator('[data-draft-id="draft-new"]').waitFor();
    assert.equal(await page.locator('[data-admin-offer-field="display.name"]').inputValue(), "Original");
    assert.equal(requests.filter((entry) => entry.path === "/api/commercial/drafts" && entry.method === "POST").length, 1);
  });
});

test("dirty commercial editor keeps content and URL when Browser Back is cancelled", async () => {
  await withPage("/admin/security", async (page) => {
    await page.locator('[data-admin-link="/admin/plans"]').click();
    await openDraft(page);
    await page.locator('[data-admin-offer-field="display.name"]').fill("Edited unsaved");
    nextDialog(page, false);
    await page.goBack();
    await page.waitForFunction(() => location.pathname === "/admin/plans");
    assert.equal(await page.locator('[data-admin-offer-field="display.name"]').inputValue(), "Edited unsaved");
    nextDialog(page, true);
    await page.goBack();
    await page.waitForFunction(() => document.title === "Bảo mật | BiddingFlow Admin");
    assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }))), false);
    await page.goForward();
    await page.waitForFunction(() => document.title === "Gói dịch vụ | BiddingFlow Admin");
  });
});

test("opening a newer draft prevents a slow previous draft from replacing it", async () => {
  let release;
  let requested;
  const gate = new Promise((done) => { release = done; });
  const started = new Promise((done) => { requested = done; });
  interceptApi = async (entry) => {
    if (entry.path !== "/api/commercial/drafts/draft-a") return null;
    requested(); await gate; return { payload: draft("draft-a") };
  };
  try {
    await withPage("/admin/plans", async (page) => {
      await page.locator('[data-admin-draft-open="draft-a"]').click();
      await started;
      await openDraft(page, "draft-b");
      release();
      await page.evaluate(() => new Promise((done) => setTimeout(done, 40)));
      assert.equal(await page.locator("[data-draft-id]").getAttribute("data-draft-id"), "draft-b");
    });
  } finally { release(); }
});

test("analytics preset applies every filter currently shown in the form", async () => {
  await withPage("/admin/analytics", async (page) => {
    await page.locator('[data-admin-analytics-results][aria-busy="false"]').waitFor();
    await page.locator('[name="view"]').selectOption("retention", { force: true });
    await page.locator('[name="ownerKind"]').selectOption("organization", { force: true });
    await page.locator('[name="bucket"]').selectOption("hour", { force: true });
    const productResponse = page.waitForResponse((response) => response.url().includes("/api/admin/product-analytics/dashboard") && response.url().includes("view=retention"));
    await page.locator('[data-analytics-preset="7d"]').click();
    await productResponse;
    const product = requests.filter((entry) => entry.path === "/api/admin/product-analytics/dashboard").at(-1);
    const usage = requests.filter((entry) => entry.path === "/api/admin/usage-analytics/summary").at(-1);
    assert.equal(product.query.view, "retention");
    assert.equal(product.query.ownerKind, "organization");
    assert.equal(usage.query.bucket, "hour");
    assert.equal(new URL(page.url()).searchParams.get("view"), "retention");
  });
});

test("settings save locks the submitted form and marks later edits unsaved", async () => {
  let release;
  let requested;
  const gate = new Promise((done) => { release = done; });
  const started = new Promise((done) => { requested = done; });
  interceptApi = async (entry) => {
    if (entry.path !== "/api/admin/environment" || entry.method !== "POST") return null;
    requested(); await gate; return { payload: { success: true } };
  };
  try {
    await withPage("/admin/settings", async (page) => {
      const input = page.locator('[data-admin-feature="aiEnabled"]');
      await input.check();
      await page.locator('[data-admin-settings-save]').click();
      await started;
      assert.equal(await input.isDisabled(), true);
      assert.equal(await page.locator('[data-admin-feature="paymentCheckoutEnabled"]').isDisabled(), true);
      assert.equal(requests.find((entry) => entry.path === "/api/admin/environment" && entry.method === "POST").body.features.aiEnabled, true);
      release();
      await page.locator('[data-admin-settings-save]:enabled').waitFor();
      await input.uncheck();
      assert.match(await page.locator('[data-admin-settings-status]').textContent(), /chưa lưu/u);
    });
  } finally { release(); }
});

test("cancelled job retry remains usable after confirmation or privileged reauthentication", async () => {
  interceptApi = async (entry) => entry.path.endsWith("/retry")
    ? { status: 403, payload: { error: "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm." } } : null;
  await withPage("/admin/system/jobs", async (page) => {
    await page.locator('[data-admin-job-detail-id]').click();
    const retry = page.locator('[data-admin-job-retry]');
    await retry.click();
    await page.locator('[data-admin-prompt-cancel]').click();
    await page.locator('[data-admin-job-retry]:enabled').waitFor();
    assert.match(await page.locator('[data-admin-job-retry-status]').textContent(), /Đã hủy/u);
    assert.equal(requests.filter((entry) => entry.method === "POST").length, 0);
    await retry.click();
    await page.locator('.modal input[name="value"]').fill(JOB_ID);
    await page.locator('.modal button[type="submit"]').click();
    await page.locator('.modal input[type="password"]').waitFor();
    await page.locator('[data-admin-prompt-cancel]').click();
    await page.locator('[data-admin-job-retry]:enabled').waitFor();
    assert.match(await page.locator('[data-admin-job-retry-status]').textContent(), /Đã hủy/u);
  });
});

test("job and audit drawers dispose when Browser Back leaves their route", async () => {
  for (const [path, opener, drawer, backdrop] of [
    ["/admin/system/jobs", "[data-admin-job-detail-id]", "[data-admin-job-detail]", "[data-admin-job-detail-backdrop]"],
    ["/admin/audit", "[data-admin-security-detail-index]", "[data-admin-audit-detail-drawer]", "[data-admin-audit-detail-backdrop]"],
  ]) {
    await withPage("/admin", async (page) => {
      await page.locator(`[data-admin-link="${path}"]`).click();
      await page.locator(opener).click();
      await page.locator(drawer).waitFor();
      await page.goBack();
      await page.waitForFunction(() => document.title === "Tổng quan | BiddingFlow Admin");
      assert.equal(await page.locator(drawer).count(), 0);
      assert.equal(await page.locator(backdrop).count(), 0);
    });
  }
});

test("commercial draft fields have working associated labels including enhanced selects", async () => {
  await withPage("/admin/plans", async (page) => {
    await openDraft(page);
    const name = page.getByLabel("Tên hiển thị", { exact: true });
    await page.locator('label', { hasText: "Tên hiển thị" }).click();
    assert.equal(await name.evaluate((element) => document.activeElement === element), true);
    assert.equal(await page.getByLabel("Trạng thái bán", { exact: true }).getAttribute("role"), "combobox");
    const unnamed = await page.locator('[data-admin-offer-field]:not(select)').evaluateAll((elements) => elements.filter((element) => element.type !== "checkbox" && !element.labels?.length && !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby")).map((element) => element.dataset.adminOfferField));
    assert.deepEqual(unnamed, []);
    assert.equal(await page.getByLabel("Cấu hình chính sách nâng cao (JSON)", { exact: true }).count(), 1);
  });
});
