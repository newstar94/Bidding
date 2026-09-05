import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifest = process.env.UI_QA_BUNDLE === '1' ? JSON.parse(await readFile(join(root, 'dist/.vite/manifest.json'), 'utf8')) : null;
const moduleURL = manifest ? `/dist/${manifest['frontend/commercial-policy/CommercialControlCenter.js'].file}` : '/frontend/commercial-policy/CommercialControlCenter.js';

const overview = {
  runtime: { mode: "off" },
  currentRelease: null,
  scheduledRelease: null,
  readinessWarnings: [],
  money: { verifiedCollected: 0 },
  drafts: [{ id: "draft-1", revision: 1, status: "draft" }],
  orderActivationCounts: {},
  health: { webhook: {}, activation: {}, orders: {}, usage: {}, alerts: [] },
  recentOrders: [],
};

const draft = {
  id: "draft-1",
  revision: 1,
  status: "draft",
  document: {
    offers: [{
      code: "silver.internal.yearly",
      tier: "silver",
      variant: "internal",
      ownerKind: "organization",
      memberQuota: 5,
      includedProcurementQuota: 0,
      salesState: "sellable",
      price: { subtotal: 12_000_000, tax: 0, total: 12_000_000 },
      display: {
        name: "Bạc nội bộ",
        description: "Mô tả nội bộ",
        order: 0,
        badge: "",
        recommended: false,
        visibility: "public",
        variantLabel: "Nội bộ",
        periodLabel: "/ năm",
        benefits: ["Lợi ích nội bộ"],
      },
    }, {
      code: "silver.connected.yearly",
      tier: "silver",
      variant: "connected",
      ownerKind: "organization",
      memberQuota: 5,
      includedProcurementQuota: 3000,
      salesState: "sellable",
      price: { subtotal: 15_000_000, tax: 0, total: 15_000_000 },
      display: {
        name: "Bạc kết nối",
        description: "Mô tả kết nối",
        order: 1,
        badge: "Đề xuất",
        recommended: true,
        visibility: "public",
        variantLabel: "Kết nối",
        periodLabel: "/ năm",
        benefits: ["Lợi ích kết nối"],
      },
    }],
    creditPacks: [{ code: "procurement.20", quantity: 20, price: 99_000 }],
    policies: {
      baseTerm: { kind: "blocked_decision", reason: "Chờ quyết định" },
      renewalAnchor: { kind: "blocked_decision", reason: "Chờ quyết định" },
      partialBatch: { kind: "blocked_decision", reason: "Chờ quyết định" },
      creditPackExpiry: { kind: "fixed_days", days: 365 },
      graceDays: 0,
      organizationPurchaseAuthority: ["super_admin"],
    },
    providerProfiles: [],
  },
};

function contentType(pathname) {
  if (extname(pathname) === ".js" || extname(pathname) === ".mjs") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "application/octet-stream";
}

async function withPage(run) {
  const stored = structuredClone(draft);
  const requests = [];
  const template = await readFile(join(root, "views/tabs/tab_commercial_admin.html"), "utf8");
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "csrf_token=test-token; Path=/; SameSite=Lax" });
        response.end(`<!doctype html><html lang="vi"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/views/css/variables.css"><link rel="stylesheet" href="/views/css/tokens.css"><title>Commercial Control Center</title></head><body>${template}</body></html>`);
        return;
      }
      if (pathname === "/api/commercial/admin/overview") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(overview));
        return;
      }
      if (pathname === "/api/commercial/drafts/draft-1") {
        if (request.method === 'PATCH') {
          let body = ''; for await (const chunk of request) body += chunk;
          const parsed = JSON.parse(body);
          requests.push({ method: 'PATCH', body: parsed });
          stored.document = parsed.document;
          stored.revision++;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(stored));
        return;
      }
      if (pathname.endsWith('/validate') || pathname.endsWith('/publish')) {
        let body = ''; for await (const chunk of request) body += chunk;
        requests.push({ method: pathname.endsWith('/validate') ? 'VALIDATE' : 'PUBLISH', body: JSON.parse(body) });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ errors: [], warnings: [], validationDigest: 'digest-test' }));
        return;
      }
      const payload = await readFile(join(root, pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await ({ chromium, firefox, webkit }[process.env.UI_QA_BROWSER || 'chromium']).launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(url => { window.commercialModuleURL = url; }, moduleURL);
    for (const name of ['base', 'components', 'ui-redesign']) {
      await page.addStyleTag({ url: `/views/css/${name}.css` });
    }
    await page.addStyleTag({ content: 'body {height:auto;overflow:auto;padding:24px} #tab-commercial-admin {display:block} .commercial-control {max-width:1400px;margin:auto}' });
    await run(page, requests);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Commercial Control Center renders a loaded policy document into the DOM", async () => {
  await withPage(async (page) => {
    await page.evaluate(async () => {
      const module = await import(window.commercialModuleURL);
      await module.mountCommercialControlCenter({ view: { createIconsScoped() {} } });
    });

    const status = await page.locator("#commercial-status span:last-child").textContent();
    assert.doesNotMatch(status, /getElementById/u);
    assert.equal(await page.locator('.commercial-offer-item[open]').count(), 0);
    await page.getByRole('button', { name: 'Chính sách', exact: true }).click();
    await page.getByRole("heading", { name: "Chính sách & quyết định" }).waitFor();
    await page.getByText("Kỳ hạn gói cơ bản", { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cổng thanh toán', exact: true }).click();
    await page.getByRole("heading", { name: "Cổng thanh toán" }).waitFor();
    await page.getByRole('button', { name: 'Gói dịch vụ', exact: true }).click();
    await page.locator('[data-commercial-offer-row="silver.internal.yearly"] > summary').click();
    assert.ok(await page.locator(".commercial-policy-list li").count() > 0);
    assert.equal(await page.getByText("Policy", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Payment provider", { exact: true }).count(), 0);
    assert.equal(await page.getByText("silver.internal.yearly", { exact: true }).count(), 1);
    assert.equal(await page.locator("[data-offer-code='silver.internal.yearly']").count() >= 4, true);
    assert.equal(
      await page.locator("[data-offer-code='silver.internal.yearly'][data-field='price.total']").inputValue(),
      "12.000.000",
    );
    assert.equal(
      await page.locator("[data-pack-index='0']").inputValue(),
      "99.000",
    );

    const yearlyPrice = page.locator("[data-offer-code='silver.internal.yearly'][data-field='price.total']");
    await yearlyPrice.fill("13000000");
    await yearlyPrice.dispatchEvent("change");
    assert.equal(
      await page.locator("[data-offer-code='silver.internal.yearly'][data-field='price.total']").inputValue(),
      "13.000.000",
    );
    assert.equal(await page.locator('#commercial-validate').isDisabled(), true);
    assert.equal(await page.locator('#commercial-publish').isDisabled(), true);
    await page.locator('#commercial-effective-at').fill('2026-12-01T12:30');

    const includedQuota = page.locator("[data-offer-code='silver.internal.yearly'][data-field='includedProcurementQuota']");
    await includedQuota.fill("3000");
    await includedQuota.dispatchEvent("change");
    assert.equal(
      await page.locator("[data-offer-code='silver.internal.yearly'][data-field='includedProcurementQuota']").inputValue(),
      "3.000",
    );

    const displayName = page.locator("[data-offer-code='silver.internal.yearly'][data-field='display.name']");
    await displayName.fill("Tên hiển thị tùy chỉnh");
    await displayName.dispatchEvent("change");
    assert.equal(await displayName.inputValue(), "Tên hiển thị tùy chỉnh");
    assert.equal(await page.locator('#commercial-effective-at').inputValue(), '2026-12-01T12:30');
    assert.equal(await page.locator('[data-commercial-preview="silver.internal.yearly"] h3').textContent(), 'Tên hiển thị tùy chỉnh');

    const benefits = page.locator("[data-offer-code='silver.internal.yearly'][data-field='display.benefits']");
    await benefits.fill("Lợi ích thứ nhất\nLợi ích thứ hai");
    await benefits.dispatchEvent("change");
    assert.equal(await benefits.inputValue(), "Lợi ích thứ nhất\nLợi ích thứ hai");

    await page.locator("[data-offer-code='silver.internal.yearly'][data-offer-move='down']").click();
    assert.deepEqual(
      await page.locator("[data-commercial-offer-row]").evaluateAll(
        (rows) => rows.map((row) => row.getAttribute("data-commercial-offer-row")),
      ),
      ["silver.connected.yearly", "silver.internal.yearly"],
    );

    assert.match(
      await page.locator("#commercial-offers-content").textContent(),
      /Thêm, xóa hoặc đổi định danh offer cần quyết định sản phẩm/u,
    );

  });
});

test("commercial mutations keep the shared password step-up recovery enabled", async () => {
  const source = await readFile(join(root, "frontend/commercial-policy/CommercialControlCenter.js"), "utf8");
  assert.match(source, /handleHttpErrors:\s*true/u);
});

test('commercial edits preserve focus, validate the saved revision, and publish only on confirmation', async () => {
  await withPage(async (page, requests) => {
    await page.evaluate(async () => {
      const module = await import(window.commercialModuleURL);
      await module.mountCommercialControlCenter({ view: { createIconsScoped() {}, customConfirm: async () => false, customPrompt: async () => 'UX test on isolated fixture' } });
    });
    await page.locator('.commercial-offer-item > summary').first().click();
    const name = page.locator('[data-field="display.name"]').first();
    await name.fill('Gói được chỉnh');
    await name.dispatchEvent('change');
    assert.equal(await name.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.locator('#commercial-validate').isDisabled(), true);
    await page.locator('#commercial-refresh').click();
    assert.equal(await name.inputValue(), 'Gói được chỉnh');
    await page.locator('[data-field="display.visibility"]').first().selectOption('hidden');
    assert.equal(await page.locator('[data-field="salesState"]').first().inputValue(), 'sellable');
    await page.locator('#commercial-save').click();
    await page.waitForFunction(() => !document.querySelector('#commercial-validate').disabled);
    await page.locator('#commercial-validate').click();
    await page.waitForFunction(() => !document.querySelector('#commercial-publish').disabled);
    await page.locator('#commercial-publish').click();
    await page.waitForFunction(() => document.querySelector('#commercial-status').textContent.includes('Đã xuất bản'));
    assert.deepEqual(requests.map(item => item.method), ['PATCH', 'VALIDATE', 'PUBLISH']);
    assert.equal(requests[1].body.expectedRevision, 2);
    assert.equal(requests[2].body.expectedRevision, 2);
    assert.equal(requests[2].body.validationDigest, 'digest-test');
    assert.equal(requests[0].body.document.offers[0].display.visibility, 'hidden');
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (process.env.COMMERCIAL_QA_CAPTURE_DIR) {
        await mkdir(process.env.COMMERCIAL_QA_CAPTURE_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.COMMERCIAL_QA_CAPTURE_DIR, `commercial-${width}.png`), fullPage: true });
      }
    }
  });
});

test('stale save retains local edits and can be retried without duplicated handlers', async () => {
  await withPage(async page => {
    await page.evaluate(async () => {
      const module = await import(window.commercialModuleURL);
      await module.mountCommercialControlCenter({ view: { createIconsScoped() {}, customConfirm: async () => false } });
    });
    let calls = 0;
    await page.route('**/api/commercial/drafts/draft-1', async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      calls++;
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'COMMERCIAL_POLICY_STALE', error: 'Bản nháp đã thay đổi trên máy chủ.' }) });
    });
    await page.locator('.commercial-offer-item > summary').first().click();
    const name = page.locator('[data-field="display.name"]').first();
    await name.fill('Nháp cần giữ');
    await name.dispatchEvent('change');
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.locator('#commercial-save').click();
      await page.waitForFunction(() => !document.getElementById('commercial-save').disabled);
      assert.equal(await name.inputValue(), 'Nháp cần giữ');
      assert.equal(calls, attempt);
    }
    assert.equal(await page.locator('#commercial-publish').isDisabled(), true);
  });
});
