import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));
const template = await readFile(join(root, "views/tabs/tab_commercial_storefront.html"), "utf8");
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

function contentType(pathname) {
  if (extname(pathname) === ".js" || extname(pathname) === ".mjs") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function writeJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function offer(code, ownerKind, name) {
  return {
    code,
    tier: "opaque-tier",
    variant: "opaque-variant",
    ownerKind,
    salesState: "sellable",
    memberQuota: 4,
    includedProcurementQuota: 25,
    violationCheckEnabled: false,
    price: { period: "yearly", currency: "VND", subtotal: 1000000, tax: 0, total: 1000000 },
    display: {
      name,
      description: `${name} — mô tả tùy chỉnh`,
      order: 0,
      badge: "Nhãn cấu hình",
      recommended: false,
      visibility: "public",
      variantLabel: "Phương án tùy chỉnh",
      periodLabel: "/ chu kỳ riêng",
      benefits: ["Lợi ích tùy chỉnh"],
    },
  };
}

async function renderScenario(catalog, activeuser = { id: "user-1" }, inspect, orders = []) {
  let billingRequests = 0;
  const billingPaths = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Storefront</title></head><body>${template}</body></html>`);
        return;
      }
      if (pathname === "/api/public/commercial/offers") {
        writeJson(response, 200, catalog);
        return;
      }
      if (pathname.startsWith("/api/billing/usage")) {
        billingRequests += 1;
        billingPaths.push(pathname);
        writeJson(response, 200, null);
        return;
      }
      if (pathname.startsWith("/api/billing/orders")) {
        billingRequests += 1;
        billingPaths.push(pathname);
        writeJson(response, 200, { orders });
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

  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async (actor) => {
      const module = await import("/frontend/commercial-policy/CommercialStorefront.js");
      await module.mountCommercialStorefront({ model: { state: { activeuser: actor } } });
    }, activeuser);
    if (inspect) await inspect(page);
    return {
      billingRequests,
      billingPaths,
      cardCodes: await page.locator("[data-commercial-offer-code]").evaluateAll(
        (nodes) => nodes.map((node) => node.getAttribute("data-commercial-offer-code")),
      ),
      offersText: await page.locator("#storefront-offers").textContent(),
      statusText: await page.locator("#storefront-status").textContent(),
      errors,
    };
  } finally {
    await page?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("commercial-off storefront renders a controlled state without billing requests", async () => {
  const result = await renderScenario({ availability: "off", offers: [], creditPacks: [], quotaWarnings: [] });

  assert.equal(result.billingRequests, 0);
  assert.match(result.statusText, /Cửa hàng đang tạm đóng/u);
  assert.match(result.offersText, /Cửa hàng chưa mở bán/u);
  assert.deepEqual(result.errors, []);
});

const recoveryCatalog = { releaseId: "recovery", releaseChecksum: "recovery", offers: [offer("account.year", "account", "Cá nhân")], creditPacks: [], quotaWarnings: [] };
const pendingOrder = { publicId: "order-recovery", checkoutUrl: "https://example.test/payment", checkoutState: "open", paymentState: "unverified", activationState: "pending", totalAmount: 1000000, checkoutExpiresAt: Math.floor(Date.now() / 1000) + 3600 };

test("popup-blocked checkout immediately offers recovery without creating another order", async () => {
  let checkoutRequests = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await page.evaluate(() => { document.cookie = "csrf_token=storefront-test-token; path=/"; window.open = () => null; });
    await page.route("**/api/billing/quotes", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ publicId: "quote-recovery" }) }));
    await page.route("**/api/billing/checkouts", (route) => {
      checkoutRequests += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) });
    });
    await page.route("**/api/billing/orders/order-recovery", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) }));
    await page.locator('[data-operation="purchase"]').click();
    await page.waitForFunction(() => document.getElementById("storefront-status").textContent.includes("chặn cửa sổ"));
    const recovery = page.locator('[data-order="order-recovery"] a');
    assert.equal(await recovery.count(), 1);
    assert.equal(await recovery.getAttribute("href"), pendingOrder.checkoutUrl);
    assert.equal(await recovery.getAttribute("target"), "_blank");
    assert.match(await recovery.getAttribute("rel"), /noopener/u);
    assert.equal(checkoutRequests, 1);
  });
  assert.deepEqual(result.errors, []);
});

test("history resumes only unexpired open unpaid checkouts", async () => {
  const orders = [pendingOrder,
    { ...pendingOrder, publicId: "paid", paymentState: "verified_paid", activationState: "applied" },
    { ...pendingOrder, publicId: "expired", checkoutState: "expired" },
    { ...pendingOrder, publicId: "past-expiry", checkoutExpiresAt: 1 },
    { ...pendingOrder, publicId: "unsafe-url", checkoutUrl: "javascript:alert(1)" },
  ];
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    assert.equal(await page.locator("#storefront-orders a").count(), 1);
    assert.equal(await page.locator('[data-order="order-recovery"] a').getAttribute("href"), pendingOrder.checkoutUrl);
    assert.equal(await page.locator("[data-order]").count(), orders.length);
  }, orders);
  assert.deepEqual(result.errors, []);
});

test("storefront filters by authoritative owner and preserves response presentation order", async () => {
  const result = await renderScenario({
    releaseId: "release-storefront",
    releaseChecksum: "checksum-storefront",
    offers: [
      offer("account-z", "account", "Tên Z"),
      offer("organization-only", "organization", "Không dành cho tài khoản"),
      offer("account-a", "account", "Tên A"),
    ],
    creditPacks: [],
    quotaWarnings: [70, 90, 100],
  });

  assert.deepEqual(result.billingPaths, ["/api/billing/usage", "/api/billing/orders"], result.statusText);
  assert.deepEqual(result.cardCodes, ["account-z", "account-a"]);
  assert.match(result.offersText, /Tên Z/u);
  assert.match(result.offersText, /Tên A/u);
  assert.match(result.offersText, /Nhãn cấu hình/u);
  assert.match(result.offersText, /Phương án tùy chỉnh/u);
  assert.match(result.offersText, /\/ chu kỳ riêng/u);
  assert.match(result.offersText, /Lợi ích tùy chỉnh/u);
  assert.doesNotMatch(result.offersText, /Không dành cho tài khoản|Nội bộ|Kết nối/u);
  assert.deepEqual(result.errors, []);
});

test("storefront group and period switches keep the workspace owner and selected checkout SKU", async () => {
  const offers = ["account", "organization"].flatMap((ownerKind) => ["internal", "connected"].flatMap((variant) => ["yearly", "monthly"].map((period) => ({
    ...offer(`${ownerKind}.${variant}.${period}`, ownerKind, `Tên ${ownerKind}`), variant,
    price: { period, currency: "VND", subtotal: period === "monthly" ? 123456 : 987654, tax: 0, total: period === "monthly" ? 123456 : 987654 },
  }))));
  const result = await renderScenario({ releaseId: "matrix", releaseChecksum: "matrix", offers, creditPacks: [{ code: "procurement.20", quantity: 20, price: 99000 }], quotaWarnings: [] },
    { id: "user-1", activeOrganizationId: "org-1" }, async (page) => {
      await page.locator('[data-storefront-group="advanced"]').click();
      await page.locator('[data-storefront-period="monthly"]').click();
      const cards = page.locator("[data-commercial-offer-code]");
      assert.equal(await cards.count(), 1);
      assert.equal(await cards.first().getAttribute("data-commercial-offer-code"), "organization.connected.monthly");
      assert.equal(await cards.locator('button[data-operation="purchase"]').getAttribute("data-sku"), "organization.connected.monthly");
      assert.match(await cards.textContent(), /123\.456/u);
      assert.doesNotMatch(await cards.textContent(), /987\.654/u);
      assert.equal(await page.locator('[data-operation="credit_pack"]').count(), 1);
      assert.equal(await page.locator('[data-storefront-period="monthly"]').getAttribute("aria-pressed"), "true");
      await page.evaluate(() => { document.cookie = "csrf_token=storefront-test-token; path=/"; });
      let quoteRequest;
      await page.route("**/api/billing/quotes", async (route) => {
        quoteRequest = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ publicId: "quote-fixture" }) });
      });
      await page.route("**/api/billing/checkouts", async (route) => {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "FIXTURE_STOP", error: "Stop before payment" }) });
      });
      await cards.locator('button[data-operation="purchase"]').click();
      await page.waitForFunction(() => document.getElementById("storefront-status").textContent.includes("FIXTURE_STOP"));
      assert.deepEqual(quoteRequest, { ownerKind: "organization", ownerId: "org-1", operation: "purchase", skuCode: "organization.connected.monthly" });
    });
  assert.deepEqual(result.cardCodes, ["organization.connected.monthly"]);
  assert.deepEqual(result.errors, []);
});

test("renewal sends the selected SKU and owner and shows authoritative rejection without checkout", async () => {
  let quoteRequest;
  let checkoutRequests = 0;
  const result = await renderScenario({ ...recoveryCatalog, offers: [offer("organization.yearly", "organization", "Tổ chức")] },
    { id: "user-1", activeOrganizationId: "org-1" }, async page => {
      await page.evaluate(() => { document.cookie = "csrf_token=storefront-test-token; path=/"; window.open = () => null; });
      await page.route("**/api/billing/quotes", route => {
        quoteRequest = route.request().postDataJSON();
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "RENEWAL_PLAN_TRANSITION_REVIEW_REQUIRED", error: "Gia hạn cần chọn đúng gói đang dùng." }) });
      });
      await page.route("**/api/billing/checkouts", route => { checkoutRequests += 1; return route.fulfill({ status: 500, body: "{}" }); });
      assert.equal(await page.getByRole("button", { name: "Chọn gói", exact: true }).count(), 1);
      const renew = page.getByRole("button", { name: "Gia hạn gói này", exact: true });
      await renew.click();
      await page.waitForFunction(() => document.getElementById("storefront-status").textContent.includes("RENEWAL_PLAN_TRANSITION_REVIEW_REQUIRED"));
      assert.deepEqual(quoteRequest, { ownerKind: "organization", ownerId: "org-1", operation: "renew", skuCode: "organization.yearly" });
      assert.equal(checkoutRequests, 0);
      assert.match(await page.locator(".storefront-checkout-error").textContent(), /Gia hạn cần chọn đúng gói đang dùng/u);
      assert.equal(await renew.isEnabled(), true);
    });
  assert.deepEqual(result.errors, []);
});

test("a paid scheduled renewal shows its activation date and stops payment polling", async () => {
  let orderRequests = 0;
  let quoteOperation;
  const scheduled = { ...pendingOrder, operation: "renew", paymentState: "verified_paid", activationState: "pending", activationScheduled: true, activationStartsAt: 1800000000, activationExpiresAt: 1831536000 };
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async page => {
    await page.evaluate(() => {
      document.cookie = "csrf_token=storefront-test-token; path=/";
      window.open = () => null;
      window.paymentPollingDelays = [];
      const originalSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 3000) window.paymentPollingDelays.push(delay);
        return originalSetTimeout(callback, delay, ...args);
      };
    });
    await page.route("**/api/billing/quotes", route => {
      quoteOperation = route.request().postDataJSON().operation;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ publicId: "quote-scheduled" }) });
    });
    await page.route("**/api/billing/checkouts", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) }));
    await page.route("**/api/billing/orders/order-recovery", route => { orderRequests += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: scheduled }) }); });
    await page.locator('[data-operation="renew"]').click();
    await page.waitForFunction(() => document.getElementById("storefront-status").textContent.includes("quyền lợi sẽ kích hoạt từ"));
    assert.equal(orderRequests, 1);
    assert.equal(quoteOperation, "renew");
    assert.deepEqual(await page.evaluate(() => window.paymentPollingDelays), []);
    assert.match(await page.locator('[data-order="order-recovery"]').textContent(), /Chờ đến kỳ kích hoạt/u);
    assert.equal(await page.locator('[data-order="order-recovery"] a').count(), 0);
  });
  assert.deepEqual(result.errors, []);
});
