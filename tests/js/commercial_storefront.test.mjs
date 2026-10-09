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

test("storefront matches the Admin card order and keeps configured rights visible with custom benefits", async () => {
  const source = offer("personal.connected.yearly", "account", "Cá nhân");
  source.tier = "personal";
  source.variant = "connected";
  source.memberQuota = 1;
  source.includedProcurementQuota = 1000;
  source.exportCapabilities = { "document.export.word": true, "document.export.excel": false, "document.export.award_result_excel": true };
  source.display.recommended = true;
  const catalog = { releaseId: "parity", releaseChecksum: "parity-checksum", offers: [source], creditPacks: [], quotaWarnings: [] };
  await renderScenario(catalog, { id: "user-1" }, async page => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-storefront-group="advanced"]').click();
    const card = page.locator('[data-commercial-offer-code="personal.connected.yearly"]');
    for (const label of ["Hạn mức thành viên: 1", "Lượt Mua Sắm Công kèm theo: 1.000", "Kiểm tra vi phạm nhà thầu: Không", "Xuất Word: Có", "Xuất Excel: Không", "Xuất kết quả lựa chọn nhà thầu: Có", "Lợi ích tùy chỉnh"]) assert.ok((await card.textContent()).includes(label), label);
    const layout = await card.evaluate(node => {
      const box = selector => node.querySelector(selector).getBoundingClientRect();
      const periods = box(".commercial-storefront__card-periods"), price = box(".commercial-storefront__price"), description = box(".commercial-storefront__description"), features = box("ul");
      return { ordered: periods.bottom <= price.top && price.bottom <= description.top && description.bottom <= features.top, priceAlign: getComputedStyle(node.querySelector(".commercial-storefront__price")).textAlign };
    });
    assert.equal(layout.ordered, true);
    assert.equal(layout.priceAlign, "center");
    await card.screenshot({ path: "artifacts/storefront-package-admin-parity-desktop.png" });
  });
});

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
      window.storefrontController = { model: { state: { activeuser: actor } } };
      await module.mountCommercialStorefront(window.storefrontController);
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
const pendingOrder = { publicId: "order-recovery", checkoutUrl: "https://example.test/payment", checkoutState: "open", paymentState: "unverified", activationState: "pending", totalAmount: 1000000, checkoutExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  paymentDetails: { qrCodeImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", accountNumber: "0123456789", accountName: "BIDDINGFLOW", description: "BIDDING 123" } };
const cancelledOrder = { ...pendingOrder, checkoutState: "cancelled" };

async function checkoutRoutes(page, { checkout, quote, order = pendingOrder, cancel, sessionUser = { id: "user-1", active_org_id: null, package_id: null, entitlements: {} } } = {}) {
  await page.evaluate(() => { document.cookie = "csrf_token=storefront-test-token; path=/"; });
  await page.route("**/api/billing/quotes", quote || ((route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ publicId: "quote-dialog" }) })));
  await page.route("**/api/billing/checkouts", checkout || ((route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) })));
  await page.route("**/api/billing/orders/order-recovery", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: typeof order === "function" ? order() : order }) }));
  await page.route("**/api/auth/check-session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ valid: true, user: sessionUser }) }));
  if (cancel) await page.route("**/api/billing/orders/order-recovery/cancel", cancel);
}

test("selecting a package displays QR in the app without opening a browser window", async () => {
  let checkoutRequests = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await page.evaluate(() => { document.cookie = "csrf_token=storefront-test-token; path=/"; window.browserPopupRequests = 0; window.open = () => { window.browserPopupRequests += 1; return null; }; });
    await page.route("**/api/billing/quotes", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ publicId: "quote-recovery" }) }));
    await page.route("**/api/billing/checkouts", (route) => {
      checkoutRequests += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) });
    });
    await page.route("**/api/billing/orders/order-recovery", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) }));
    await page.locator('[data-operation="purchase"]').click();
    const dialog = page.getByRole("dialog", { name: "Thanh toán gói dịch vụ" });
    await dialog.waitFor({ state: "visible" });
    await dialog.getByRole("img", { name: "Mã QR thanh toán" }).waitFor();
    assert.match(await dialog.textContent(), /1\.000\.000/u);
    assert.match(await dialog.textContent(), /0123456789/u);
    assert.equal(await page.evaluate(() => window.browserPopupRequests), 0);
    const recovery = page.locator('[data-order="order-recovery"] button');
    assert.equal(await recovery.count(), 1);
    const immediateRecovery = page.locator("#storefront-payment-action button");
    assert.equal(await immediateRecovery.count(), 1);
    assert.equal(await immediateRecovery.textContent(), "Mở QR thanh toán");
    assert.equal(checkoutRequests, 1);
  });
  assert.deepEqual(result.errors, []);
});

test("the QR popup stays centered with the application reset stylesheet", async () => {
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addStyleTag({ url: "/views/css/base.css" });
    await checkoutRoutes(page);
    await page.locator('[data-operation="purchase"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("img", { name: "Mã QR thanh toán" }).waitFor();
    const bounds = await dialog.boundingBox();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - 720) <= 1, `QR dialog horizontal center was ${bounds.x + bounds.width / 2}`);
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - 500) <= 1, `QR dialog vertical center was ${bounds.y + bounds.height / 2}`);
  });
  assert.deepEqual(result.errors, []);
});

const checkoutDismissalCases = ["account", "organization"].flatMap((ownerKind) =>
  ["cancel", "close", "escape", "backdrop"].map((action) => ({ ownerKind, action })));
for (const { ownerKind, action } of checkoutDismissalCases) {
  test(`${ownerKind} ${action} cancels the server transaction before dismissing QR`, async () => {
    let cancelRequests = 0;
    let releaseCancel;
    const cancelGate = new Promise((resolve) => { releaseCancel = resolve; });
    const organization = ownerKind === "organization" ? "org-1" : "";
    const catalog = { ...recoveryCatalog, offers: [offer(`${ownerKind}.year`, ownerKind, "Gói thử nghiệm")] };
    const actor = { id: "user-1", activeOrganizationId: organization };
    const order = { ...pendingOrder, ownerKind };
    const result = await renderScenario(catalog, actor, async (page) => {
      await page.evaluate((scope) => sessionStorage.setItem("bf_active_org", scope), organization);
      await checkoutRoutes(page, {
        checkout: (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order }) }),
        order, cancel: async (route) => {
        cancelRequests += 1;
        assert.equal(route.request().method(), "POST");
        assert.equal(route.request().headers()["x-active-org"] || "", organization);
        assert.match(route.request().postDataJSON().reason, /đóng hoặc hủy/u);
        await cancelGate;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: { ...cancelledOrder, ownerKind } }) });
      } });
      await page.locator('[data-operation="purchase"]').click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("img", { name: "Mã QR thanh toán" }).waitFor();
      if (action === "cancel") await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).click();
      if (action === "close") await dialog.getByRole("button", { name: "Đóng và hủy giao dịch", exact: true }).click();
      if (action === "escape") await page.keyboard.press("Escape");
      if (action === "backdrop") await page.mouse.click(8, 8);
      await page.waitForFunction(() => document.getElementById("commercial-checkout-status")?.textContent.includes("Đang hủy giao dịch"));
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await dialog.getByRole("img").count(), 0);
      assert.equal(await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).isDisabled(), true);
      releaseCancel();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(cancelRequests, 1);
      assert.equal(await page.locator("#storefront-payment-action").isVisible(), false);
      assert.equal(await page.locator("#storefront-orders [data-storefront-resume]").count(), 0);
      assert.equal(await page.locator('[data-operation="purchase"]').isEnabled(), true);
      assert.match(await page.locator("#storefront-status").textContent(), /Đã hủy/u);
    });
    assert.deepEqual(result.errors, []);
  });
}

test("closing while checkout is being created cancels the returned order and never shows QR", async () => {
  let cancelRequests = 0;
  let releaseCheckout;
  let createStarted;
  const createGate = new Promise((resolve) => { releaseCheckout = resolve; });
  const started = new Promise((resolve) => { createStarted = resolve; });
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { checkout: async (route) => {
      createStarted();
      await createGate;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) });
    }, cancel: (route) => {
      cancelRequests += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: cancelledOrder }) });
    } });
    await page.locator('[data-operation="purchase"]').click();
    await started;
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await dialog.getByRole("img").count(), 0);
    assert.equal(cancelRequests, 0);
    releaseCheckout();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(cancelRequests, 1);
    assert.equal(await page.locator("#storefront-payment-action").isVisible(), false);
  });
  assert.deepEqual(result.errors, []);
});

test("a lost checkout response is resolved with the same key before cancelling the transaction", async () => {
  const checkoutKeys = [];
  let cancelRequests = 0;
  let releaseCheckout;
  let createStarted;
  const gate = new Promise((resolve) => { releaseCheckout = resolve; });
  const started = new Promise((resolve) => { createStarted = resolve; });
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { checkout: async (route) => {
      checkoutKeys.push(route.request().headers()["idempotency-key"]);
      if (checkoutKeys.length === 1) {
        createStarted();
        await gate;
        await route.abort("failed");
      } else {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder, replayed: true }) });
      }
    }, cancel: (route) => {
      cancelRequests += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: cancelledOrder }) });
    } });
    await page.locator('[data-operation="purchase"]').click();
    await started;
    const dialog = page.getByRole("dialog");
    await page.keyboard.press("Escape");
    releaseCheckout();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(checkoutKeys.length, 2);
    assert.ok(checkoutKeys[0]);
    assert.equal(checkoutKeys[0], checkoutKeys[1]);
    assert.equal(cancelRequests, 1);
    assert.equal(await page.locator("#storefront-payment-action").isVisible(), false);
  });
  assert.deepEqual(result.errors, []);
});

test("an unresolved checkout stays cancellable after repeated transport failures", async () => {
  const checkoutKeys = [];
  let cancelRequests = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { checkout: async (route) => {
      checkoutKeys.push(route.request().headers()["idempotency-key"]);
      if (checkoutKeys.length < 3) await route.abort("failed");
      else await route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder, replayed: true }) });
    }, cancel: (route) => {
      cancelRequests += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: cancelledOrder }) });
    } });
    await page.locator('[data-operation="purchase"]').click();
    const dialog = page.getByRole("dialog");
    await page.waitForFunction(() => document.getElementById("commercial-checkout-status")?.textContent.includes("Chưa xác định được giao dịch"));
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).count(), 1);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(checkoutKeys.length, 3);
    assert.equal(new Set(checkoutKeys).size, 1);
    assert.equal(cancelRequests, 1);
  });
  assert.deepEqual(result.errors, []);
});

test("a checkout initially creating displays QR when polling returns the open order", async () => {
  let orderReads = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { checkout: (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: { ...pendingOrder, checkoutState: "creating", paymentDetails: null, checkoutUrl: null } }) }),
      order: () => { orderReads += 1; return pendingOrder; } });
    await page.locator('[data-operation="purchase"]').click();
    await page.getByRole("dialog").getByRole("img", { name: "Mã QR thanh toán" }).waitFor();
    assert.equal(orderReads, 1);
  });
  assert.deepEqual(result.errors, []);
});

test("a stale open poll response cannot restore QR after confirmed cancellation", async () => {
  let releasePoll;
  let pollStarted;
  let pollFinished;
  const gate = new Promise((resolve) => { releasePoll = resolve; });
  const started = new Promise((resolve) => { pollStarted = resolve; });
  const finished = new Promise((resolve) => { pollFinished = resolve; });
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { cancel: (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: cancelledOrder }) }) });
    await page.route("**/api/billing/orders/order-recovery", async (route) => {
      pollStarted();
      await gate;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) });
      pollFinished();
    });
    await page.locator('[data-operation="purchase"]').click();
    await started;
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    releasePoll();
    await finished;
    assert.equal(await page.locator("#storefront-payment-action").isVisible(), false);
    assert.equal(await page.locator("#storefront-orders [data-storefront-resume]").count(), 0);
  });
  assert.deepEqual(result.errors, []);
});

test("closing during quote prevents checkout creation", async () => {
  let checkoutRequests = 0;
  let releaseQuote;
  let quoteStarted;
  let quoteFinished;
  const gate = new Promise((resolve) => { releaseQuote = resolve; });
  const started = new Promise((resolve) => { quoteStarted = resolve; });
  const finished = new Promise((resolve) => { quoteFinished = resolve; });
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { quote: async (route) => {
      quoteStarted();
      await gate;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ publicId: "quote-cancelled" }) });
      quoteFinished();
    }, checkout: (route) => {
      checkoutRequests += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) });
    } });
    await page.locator('[data-operation="purchase"]').click();
    await started;
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    releaseQuote();
    await finished;
    await page.waitForFunction(() => document.getElementById("storefront-status")?.textContent.includes("Chưa tạo giao dịch"));
    assert.equal(checkoutRequests, 0);
  });
  assert.deepEqual(result.errors, []);
});

test("provider cancellation pending keeps dialog until order confirms cancelled", async () => {
  let cancelled = false;
  let afterCancelReads = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await page.evaluate(() => {
      const setTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => setTimeout(callback, delay === 3000 ? 80 : delay, ...args);
    });
    await checkoutRoutes(page, { order: () => {
      if (cancelled) { afterCancelReads += 1; return cancelledOrder; }
      return pendingOrder;
    }, cancel: (route) => {
      cancelled = true;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) });
    } });
    await page.locator('[data-operation="purchase"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("img").waitFor();
    await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(afterCancelReads, 1);
    assert.match(await page.locator("#storefront-status").textContent(), /Đã hủy/u);
  });
  assert.deepEqual(result.errors, []);
});

test("a failed cancellation keeps the transaction visible and allows a cancellation retry", async () => {
  let cancelRequests = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { cancel: (route) => {
      cancelRequests += 1;
      return route.fulfill(cancelRequests === 1
        ? { status: 503, contentType: "application/json", body: JSON.stringify({ code: "PROVIDER_BUSY", error: "payOS tạm thời chưa phản hồi" }) }
        : { contentType: "application/json", body: JSON.stringify({ order: cancelledOrder }) });
    } });
    await page.locator('[data-operation="purchase"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("img").waitFor();
    await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).click();
    const retry = dialog.getByRole("button", { name: "Thử hủy lại", exact: true });
    await retry.waitFor();
    assert.equal(await dialog.isVisible(), true);
    assert.match(await dialog.textContent(), /Chưa hủy được giao dịch/u);
    assert.equal(await dialog.getByRole("img").count(), 0);
    await retry.click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(cancelRequests, 2);
  });
  assert.deepEqual(result.errors, []);
});

test("a payment verified during cancellation takes precedence over a cancelled checkout", async () => {
  let paid = false;
  let cancelRequests = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { order: () => paid ? { ...cancelledOrder, paymentState: "verified_paid", activationState: "applied" } : pendingOrder,
      cancel: (route) => {
        paid = true;
        cancelRequests += 1;
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "PAYMENT_ALREADY_VERIFIED", error: "Đã thanh toán" }) });
      } });
    await page.locator('[data-operation="purchase"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("img").waitFor();
    await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).click();
    const close = dialog.getByRole("button", { name: "Đóng", exact: true });
    await close.waitFor();
    assert.match(await dialog.textContent(), /đã được máy chủ xác minh/u);
    assert.equal(await dialog.getByRole("img").count(), 0);
    await close.click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(cancelRequests, 1);
    assert.equal(await page.locator("#storefront-payment-action").isVisible(), false);
  });
  assert.deepEqual(result.errors, []);
});

test("an activated payment refreshes the authoritative session and shows the selected package without reloading", async () => {
  const activated = { ...pendingOrder, paymentState: "verified_paid", activationState: "applied" };
  const result = await renderScenario(recoveryCatalog, { id: "user-1", package_id: "free", wordExportEnabled: false }, async (page) => {
    await page.evaluate(() => {
      window.subscriptionRefreshes = 0;
      window.returnedTabs = [];
      window.storefrontController.switchTab = tab => window.returnedTabs.push(tab);
      window.storefrontController._checkSessionNow = async () => {
        window.subscriptionRefreshes += 1;
        window.storefrontController.model.state.activeuser.package_id = "account.year";
        window.storefrontController.model.state.activeuser.wordExportEnabled = true;
      };
    });
    await checkoutRoutes(page, { order: activated, sessionUser: { id: "user-1", active_org_id: null, package_id: "account.year", entitlements: { word_export: true } } });
    await page.locator('[data-operation="purchase"]').click();
    await page.waitForFunction(() => window.subscriptionRefreshes === 1);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Đóng", exact: true }).waitFor();
    assert.match(await dialog.textContent(), /Cá nhân.*đã được kích hoạt/u);
    assert.match(await dialog.textContent(), /Phương án tùy chỉnh/u);
    assert.equal(await dialog.getByRole("img").count(), 0);
    assert.deepEqual(await page.evaluate(() => ({ packageId: window.storefrontController.model.state.activeuser.package_id, wordExport: window.storefrontController.model.state.activeuser.wordExportEnabled })), { packageId: "account.year", wordExport: true });
    await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.returnedTabs), ["dashboard"]);
  });
  assert.deepEqual(result.errors, []);
});

test("successful activation closes after five seconds and returns to the overview", async () => {
  const activated = { ...pendingOrder, paymentState: "verified_paid", activationState: "applied" };
  const result = await renderScenario(recoveryCatalog, { id: "user-1", package_id: "free" }, async (page) => {
    await page.evaluate(() => {
      window.returnedTabs = [];
      window.storefrontController.switchTab = tab => window.returnedTabs.push(tab);
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(callback, delay === 5000 ? 40 : delay, ...args);
    });
    await checkoutRoutes(page, { order: activated, sessionUser: { id: "user-1", active_org_id: null, package_id: "account.year", entitlements: {} } });
    await page.locator('[data-operation="purchase"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Đóng", exact: true }).waitFor();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.returnedTabs), ["dashboard"]);
  });
  assert.deepEqual(result.errors, []);
});

test("a paid cancellation result continues activation polling and refreshes the session when applied", async () => {
  let paid = false;
  let activatedReads = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await page.evaluate(() => {
      window.subscriptionRefreshes = 0;
      window.storefrontController._checkSessionNow = async () => { window.subscriptionRefreshes += 1; };
    });
    await checkoutRoutes(page, {
      order: () => {
        if (paid) { activatedReads += 1; return { ...pendingOrder, paymentState: "verified_paid", activationState: "applied" }; }
        return pendingOrder;
      },
      cancel: (route) => {
        paid = true;
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: { ...pendingOrder, paymentState: "verified_paid", activationState: "pending" } }) });
      },
    });
    await page.locator('[data-operation="purchase"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("img").waitFor();
    await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).click();
    await page.waitForFunction(() => window.subscriptionRefreshes === 1);
    assert.equal(activatedReads, 1);
    assert.equal(await dialog.getByRole("button", { name: "Đóng", exact: true }).isEnabled(), true);
    assert.match(await dialog.textContent(), /đã được kích hoạt/u);
    assert.equal(await dialog.getByRole("img").count(), 0);
  });
  assert.deepEqual(result.errors, []);
});

test("an unpaid poll from before cancellation cannot overwrite the later paid receipt", async () => {
  let orderReads = 0;
  let releaseOldPoll;
  let oldPollStarted;
  const gate = new Promise((resolve) => { releaseOldPoll = resolve; });
  const started = new Promise((resolve) => { oldPollStarted = resolve; });
  const activated = { ...pendingOrder, paymentState: "verified_paid", activationState: "applied" };
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await page.evaluate(() => {
      window.subscriptionRefreshes = 0;
      window.storefrontController._checkSessionNow = async () => { window.subscriptionRefreshes += 1; };
    });
    await checkoutRoutes(page, { cancel: (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: { ...activated, activationState: "pending" } }) }) });
    await page.route("**/api/billing/orders/order-recovery", async (route) => {
      orderReads += 1;
      if (orderReads === 1) {
        oldPollStarted();
        await gate;
        await route.fulfill({ contentType: "application/json", headers: { "X-Fixture": "stale-poll" }, body: JSON.stringify({ order: pendingOrder }) });
      } else await route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: activated }) });
    });
    await page.route("**/api/billing/orders", (route) => route.fulfill({ contentType: "application/json", headers: { "X-Fixture": "activated-history" }, body: JSON.stringify({ orders: [activated] }) }));
    const appliedHistory = page.waitForResponse((response) => response.headers()["x-fixture"] === "activated-history");
    await page.locator('[data-operation="purchase"]').click();
    await started;
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Hủy thanh toán", exact: true }).click();
    await page.waitForFunction(() => window.subscriptionRefreshes === 1);
    await appliedHistory;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const staleResponse = page.waitForResponse((response) => response.headers()["x-fixture"] === "stale-poll");
    releaseOldPoll();
    await staleResponse;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(await page.locator('[data-order="order-recovery"]').textContent(), /verified_paid.*applied/u);
    assert.equal(await page.locator("#storefront-payment-action").isVisible(), false);
    assert.equal(await dialog.getByRole("img").count(), 0);
  });
  assert.deepEqual(result.errors, []);
});

for (const source of ["cancel response", "cancel poll"]) {
  test(`a stale ${source} cannot change a newly selected workspace`, async () => {
    let releaseReply;
    let requestStarted;
    let orderReads = 0;
    const gate = new Promise((resolve) => { releaseReply = resolve; });
    const started = new Promise((resolve) => { requestStarted = resolve; });
    const result = await renderScenario(recoveryCatalog, { id: "user-1", activeOrganizationId: "personal:user-1" }, async (page) => {
      await page.evaluate(() => {
        const setTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => setTimeout(callback, delay === 3000 ? 80 : delay, ...args);
      });
      await checkoutRoutes(page, { cancel: async (route) => {
        if (source === "cancel response") {
          requestStarted();
          await gate;
          await route.fulfill({ contentType: "application/json", headers: { "X-Fixture": "old-workspace" }, body: JSON.stringify({ order: cancelledOrder }) });
        } else await route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) });
      } });
      await page.route("**/api/billing/orders/order-recovery", async (route) => {
        orderReads += 1;
        if (source === "cancel poll" && orderReads > 1) {
          requestStarted();
          await gate;
          await route.fulfill({ contentType: "application/json", headers: { "X-Fixture": "old-workspace" }, body: JSON.stringify({ order: cancelledOrder }) });
        } else await route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) });
      });
      await page.locator('[data-operation="purchase"]').click();
      await page.getByRole("dialog").getByRole("img").waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "Hủy thanh toán", exact: true }).click();
      await started;
      await page.evaluate(() => {
        window.storefrontController.model.state.activeuser = { id: "user-1", activeOrganizationId: "org-new" };
        document.getElementById("storefront-status").textContent = "Trạng thái không gian mới";
        document.getElementById("storefront-orders").textContent = "Lịch sử không gian mới";
      });
      const staleResponse = page.waitForResponse((response) => response.headers()["x-fixture"] === "old-workspace");
      releaseReply();
      await staleResponse;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator("#storefront-status").textContent(), "Trạng thái không gian mới");
      assert.equal(await page.locator("#storefront-orders").textContent(), "Lịch sử không gian mới");
    });
    assert.deepEqual(result.errors, []);
  });
}

test("activation refresh continues after closing a verified paid popup", async () => {
  let orderReads = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    let releaseCatalog;
    const catalogGate = new Promise((resolve) => { releaseCatalog = resolve; });
    // Hold the post-activation refresh so the assertion cannot consume the
    // initial success message before refresh() replaces it with loading text.
    await page.route("**/api/public/commercial/offers", async (route) => {
      await catalogGate;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(recoveryCatalog) });
    });
    await page.evaluate(() => {
      window.subscriptionRefreshes = 0;
      window.storefrontController._checkSessionNow = async () => { window.subscriptionRefreshes += 1; };
      const setTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => setTimeout(callback, delay === 3000 ? 300 : delay, ...args);
    });
    await checkoutRoutes(page, { order: () => {
      orderReads += 1;
      return { ...pendingOrder, paymentState: "verified_paid", activationState: orderReads === 1 ? "pending" : "applied" };
    } });
    await page.locator('[data-operation="purchase"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => window.subscriptionRefreshes === 1);
    assert.equal(orderReads, 2);
    try {
      await page.waitForFunction(() => document.getElementById("storefront-status")?.textContent === "Đang đồng bộ bảng giá và số dư…");
    } finally { releaseCatalog(); }
    await page.waitForFunction(() => document.getElementById("storefront-status")?.textContent.includes("đã được kích hoạt"));
    assert.match(await page.locator("#storefront-status").textContent(), /đã được kích hoạt/u);
  });
  assert.deepEqual(result.errors, []);
});

test("activation waits for an older session check then refreshes the post-payment session", async () => {
  const result = await renderScenario(recoveryCatalog, { id: "user-1", package_id: "free" }, async (page) => {
    await page.evaluate(() => {
      window.subscriptionRefreshes = 0;
      window.storefrontController._sessionCheckInFlight = new Promise((resolve) => { window.finishOlderSessionCheck = resolve; });
      window.storefrontController._checkSessionNow = async () => {
        window.subscriptionRefreshes += 1;
        window.storefrontController.model.state.activeuser.package_id = "account.year";
      };
    });
    await checkoutRoutes(page, { order: { ...pendingOrder, paymentState: "verified_paid", activationState: "applied" }, sessionUser: { id: "user-1", active_org_id: null, package_id: "account.year", entitlements: {} } });
    await page.locator('[data-operation="purchase"]').click();
    await page.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.subscriptionRefreshes), 0);
    await page.evaluate(() => { window.storefrontController.model.state.activeuser.package_id = "free"; window.finishOlderSessionCheck(); });
    await page.waitForFunction(() => window.subscriptionRefreshes === 1);
    assert.equal(await page.evaluate(() => window.storefrontController.model.state.activeuser.package_id), "account.year");
  });
  assert.deepEqual(result.errors, []);
});

test("a swallowed session refresh failure keeps activation success but clearly reports access refresh pending", async () => {
  const result = await renderScenario(recoveryCatalog, { id: "user-1", package_id: "free", wordExportEnabled: false }, async (page) => {
    await page.evaluate(() => {
      window.storefrontController._checkSessionNow = async () => undefined;
    });
    await checkoutRoutes(page, { order: { ...pendingOrder, paymentState: "verified_paid", activationState: "applied" }, sessionUser: { id: "user-1", active_org_id: null, package_id: "account.year", entitlements: { word_export: true } } });
    await page.locator('[data-operation="purchase"]').click();
    await page.waitForFunction(() => document.getElementById("commercial-checkout-status")?.textContent.includes("Phiên làm việc đang chờ cập nhật quyền lợi"));
    const dialog = page.getByRole("dialog");
    assert.match(await dialog.textContent(), /đã được kích hoạt/u);
    assert.equal(await dialog.getByRole("button", { name: "Đóng", exact: true }).isEnabled(), true);
    assert.deepEqual(await page.evaluate(() => ({ packageId: window.storefrontController.model.state.activeuser.package_id, wordExport: window.storefrontController.model.state.activeuser.wordExportEnabled })), { packageId: "free", wordExport: false });
    assert.equal(await page.locator("#storefront-status").getAttribute("data-tone"), "warning");
  });
  assert.deepEqual(result.errors, []);
});

test("history reopens the existing QR dialog without creating another transaction", async () => {
  let checkoutRequests = 0;
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { checkout: (route) => { checkoutRequests += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: pendingOrder }) }); } });
    await page.locator("#storefront-payment-action button").click();
    await page.getByRole("dialog").getByRole("img", { name: "Mã QR thanh toán" }).waitFor();
    assert.equal(checkoutRequests, 0);
  }, [pendingOrder]);
  assert.deepEqual(result.errors, []);
});

test("a legacy order without QR offers a hosted checkout fallback inside the dialog", async () => {
  const legacy = { ...pendingOrder, paymentDetails: null };
  const result = await renderScenario(recoveryCatalog, { id: "user-1" }, async (page) => {
    await checkoutRoutes(page, { order: legacy });
    await page.locator("#storefront-payment-action button").click();
    const link = page.getByRole("dialog").getByRole("link", { name: "Mở trang thanh toán payOS" });
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), pendingOrder.checkoutUrl);
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.match(await link.getAttribute("rel"), /noopener/u);
  }, [legacy]);
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
    assert.equal(await page.locator("#storefront-orders button").count(), 1);
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
