import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));
const template = await readFile(join(root, "views/components/landing_page.html"), "utf8");
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
  if (extname(pathname) === ".webp") return "image/webp";
  if (extname(pathname) === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function writeJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const compatibilityPackage = {
  id: "fixture-plan",
  name: "Gói từ API tương thích",
  price: "1234567",
  quota: 7,
  description: "Mô tả được cung cấp bởi catalog công khai.",
  capabilities: {
    "document.export.word": true,
    "document.export.excel": false,
    "document.export.award_result_excel": false,
  },
};

function commercialOffer(code, name, overrides = {}) {
  return {
    code,
    tier: overrides.tier || "opaque-tier",
    variant: overrides.variant || "opaque-variant",
    ownerKind: overrides.ownerKind || "organization",
    salesState: "sellable",
    memberQuota: 3,
    includedProcurementQuota: 20,
    violationCheckEnabled: false,
    price: { period: "yearly", currency: "VND", subtotal: 900000, tax: 0, total: 900000 },
    display: {
      name,
      description: `${name} có mô tả riêng từ release.`,
      order: 0,
      badge: "Nhãn riêng",
      recommended: false,
      visibility: "public",
      variantLabel: "Phương án riêng",
      periodLabel: "/ chu kỳ",
      benefits: ["Lợi ích riêng từ release"],
    },
    ...overrides,
  };
}

async function renderScenario({ commercial, legacy = { status: 200, payload: { packages: [compatibilityPackage] } }, inspect, session = { valid: false } }) {
  const requests = { commercial: 0, legacy: 0 };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi" data-bf-shell="landing"><head><meta name="bf-app-debug" content="true"><title>Landing</title></head><body>${template}</body></html>`);
        return;
      }
      if (pathname === "/api/public/commercial/offers") {
        requests.commercial += 1;
        if (commercial.body !== undefined) {
          response.writeHead(commercial.status, { "content-type": "application/json" });
          response.end(commercial.body);
          return;
        }
        writeJson(response, commercial.status, commercial.payload);
        return;
      }
      if (pathname === "/api/public/packages") {
        requests.legacy += 1;
        writeJson(response, legacy.status, legacy.payload);
        return;
      }
      const relativePath = pathname.startsWith("/assets/") || pathname.startsWith("/vendor/")
        ? join("views", pathname.replace(/^\//u, ""))
        : pathname.replace(/^\//u, "");
      const payload = await readFile(join(root, relativePath));
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  let page;
  let context;
  try {
    context = await browser.newContext();
    page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.location().url} ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    if (commercial.networkError) {
      await page.route("**/api/public/commercial/offers", async (route) => {
        requests.commercial += 1;
        await route.abort("failed");
      });
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async (initialSession) => {
      const module = await import("/frontend/landing/LandingPage.js");
      await module.bootstrapLandingPage(initialSession);
    }, session);
    await page.waitForFunction(() => {
      const pricingGrid = document.getElementById("landing-pricing-grid");
      return pricingGrid && !pricingGrid.hasAttribute("aria-busy");
    });
    const inspection = inspect ? await inspect(page) : null;
    return {
      inspection,
      requests,
      cardCount: await page.locator(".landing-price-card, .landing-commercial-tier").count(),
      compatibilityCardCount: await page.locator("[data-package-id='fixture-plan']").count(),
      commercialCardCodes: await page.locator("[data-commercial-offer-code]").evaluateAll(
        (nodes) => nodes.map((node) => node.getAttribute("data-commercial-offer-code")),
      ),
      pricingText: await page.locator("#landing-pricing-grid").textContent(),
      noticeHidden: await page.locator("[data-landing-pricing-notice]").getAttribute("hidden"),
      noticeText: await page.locator("[data-landing-pricing-notice]").textContent(),
      errors,
    };
  } finally {
    await context?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("landing template does not contain legacy price cards", () => {
  assert.doesNotMatch(template, /15\.000\.000|35\.000\.000|75\.000\.000/u);
  assert.doesNotMatch(template, /data-package-id=/u);
});

test("commercial off is authoritative and never falls back to legacy packages", async () => {
  const result = await renderScenario({
    commercial: { status: 200, payload: { availability: "off", offers: [], creditPacks: [] } },
  });

  assert.deepEqual(result.requests, { commercial: 1, legacy: 0 });
  assert.equal(result.cardCount, 0);
  assert.equal(result.noticeHidden, null);
  assert.match(result.noticeText, /chưa được mở bán/u);
});

test("valid empty commercial catalog is authoritative", async () => {
  const result = await renderScenario({
    commercial: {
      status: 200,
      payload: {
        releaseId: "release-empty",
        releaseChecksum: "checksum-empty",
        offers: [],
        creditPacks: [],
        quotaWarnings: [],
      },
    },
  });

  assert.deepEqual(result.requests, { commercial: 1, legacy: 0 });
  assert.equal(result.cardCount, 0);
  assert.match(result.noticeText, /Chưa có gói dịch vụ/u);
});

test("malformed HTTP 200 commercial payload never falls back", async () => {
  const result = await renderScenario({ commercial: { status: 200, body: "{" } });

  assert.deepEqual(result.requests, { commercial: 1, legacy: 0 });
  assert.equal(result.cardCount, 0);
  assert.match(result.noticeText, /Không thể cập nhật bảng giá/u);
});

test("commercial 5xx never falls back", async () => {
  const result = await renderScenario({
    commercial: { status: 503, payload: { code: "COMMERCIAL_UNAVAILABLE" } },
  });

  assert.deepEqual(result.requests, { commercial: 1, legacy: 0 });
  assert.equal(result.cardCount, 0);
  assert.match(result.noticeText, /đang được kiểm tra/u);
});

test("commercial network failure never falls back", async () => {
  const result = await renderScenario({ commercial: { networkError: true } });

  assert.ok(result.requests.commercial >= 1);
  assert.equal(result.requests.legacy, 0);
  assert.equal(result.cardCount, 0);
  assert.match(result.noticeText, /Không thể cập nhật bảng giá/u);
});

test("missing commercial endpoint never falls back to legacy packages", async () => {
  const result = await renderScenario({
    commercial: { status: 404, payload: { code: "NOT_FOUND" } },
  });

  assert.deepEqual(result.requests, { commercial: 1, legacy: 0 });
  assert.equal(result.cardCount, 0);
  assert.equal(result.compatibilityCardCount, 0);
  assert.match(result.noticeText, /đang được kiểm tra/u);
});

test("commercial renderer preserves authoritative offer count, order, and display metadata", async () => {
  const offers = [
    commercialOffer("offer-z", "Tên Z", { tier: "diamond" }),
    commercialOffer("offer-a", "Tên A", { tier: "personal" }),
    commercialOffer("offer-m", "Tên M", { tier: "silver" }),
    commercialOffer("offer-b", "Tên B", { tier: "gold" }),
    commercialOffer("offer-long", "Tên tùy chỉnh rất dài từ release thương mại"),
  ];
  const result = await renderScenario({
    commercial: {
      status: 200,
      payload: {
        releaseId: "release-five",
        releaseChecksum: "checksum-five",
        offers,
        creditPacks: [],
        quotaWarnings: [70, 90, 100],
      },
    },
  });

  assert.deepEqual(result.requests, { commercial: 1, legacy: 0 });
  assert.equal(result.cardCount, 5);
  assert.deepEqual(result.commercialCardCodes, offers.map((offer) => offer.code));
  assert.match(result.pricingText, /Tên tùy chỉnh rất dài từ release thương mại/u);
  assert.match(result.pricingText, /Nhãn riêng/u);
  assert.match(result.pricingText, /Phương án riêng/u);
  assert.match(result.pricingText, /Lợi ích riêng từ release/u);
  assert.match(result.pricingText, /\/ chu kỳ/u);
  assert.doesNotMatch(result.pricingText, /DÀNH CHO CÁ NHÂN|DÀNH CHO TỔ CHỨC|CÓ GÓI KẾT NỐI/u);
  assert.deepEqual(result.errors, []);
});

test("commercial renderer supports any published offer count without creating placeholder tiers", async () => {
  for (const count of [1, 2, 3, 4, 6]) {
    const offers = Array.from({ length: count }, (_, index) => (
      commercialOffer(`configured-${count}-${index + 1}`, `Gói cấu hình ${index + 1}`)
    ));
    const result = await renderScenario({
      commercial: {
        status: 200,
        payload: {
          releaseId: `release-${count}`,
          releaseChecksum: `checksum-${count}`,
          offers,
          creditPacks: [],
          quotaWarnings: [],
        },
      },
    });

    assert.equal(result.cardCount, count);
    assert.deepEqual(result.commercialCardCodes, offers.map((offer) => offer.code));
    assert.equal(result.compatibilityCardCount, 0);
  }
});

function pricingMatrix(periods = ["yearly", "monthly"]) {
  return periods.flatMap((period) => ["internal", "connected"].flatMap((variant) => (
    ["personal", "silver", "gold", "diamond"].map((tier, index) => commercialOffer(
      `${tier}.${variant}.${period}`, `Tên ${tier} do Admin đặt`, {
        tier, variant, ownerKind: tier === "personal" ? "account" : "organization",
        includedProcurementQuota: variant === "internal" ? 0 : 20,
        memberQuota: [1, 5, 15, 50][index],
        price: { period, currency: "VND", subtotal: period === "monthly" ? 123456 : 987654, tax: 0, total: period === "monthly" ? 123456 : 987654 },
        display: { name: `Tên ${tier} do Admin đặt`, benefits: [] },
      },
    ))
  )));
}

const pricingCatalog = (offers) => ({ status: 200, payload: {
  releaseId: "matrix", releaseChecksum: "matrix-checksum", offers, creditPacks: [], quotaWarnings: [],
} });

test("public cards match the Admin preview layout and show every configured right", async () => {
  const offers = pricingMatrix(["yearly"]);
  for (const item of offers) {
    item.display.description = "Quản lý công việc và dữ liệu đã cấu hình.";
    item.display.benefits = ["Nội dung bổ sung từ Admin"];
    item.exportCapabilities = { "document.export.word": true, "document.export.excel": false, "document.export.award_result_excel": true };
    item.violationCheckEnabled = item.variant === "connected";
  }
  await renderScenario({ commercial: pricingCatalog(offers), inspect: async page => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addStyleTag({ url: "/views/css/landing.css" });
    await page.locator('[data-pricing-group="advanced"]').click();
    const card = page.locator('[data-commercial-offer-code="personal.connected.yearly"]');
    for (const label of ["Hạn mức thành viên: 1", "Lượt lấy dữ liệu tự động kèm theo: 20", "Kiểm tra vi phạm nhà thầu: Có", "Xuất Word: Có", "Xuất Excel: Không", "Xuất kết quả lựa chọn nhà thầu: Có", "Nội dung bổ sung từ Admin"]) {
      assert.ok((await card.textContent()).includes(label), label);
    }
    const layout = await card.evaluate(node => {
      const box = selector => node.querySelector(selector).getBoundingClientRect();
      const periods = box(".landing-pricing-periods"), price = box(".landing-commercial-price"), description = box(".landing-price-description"), features = box("ul");
      const bounds = node.getBoundingClientRect();
      return { ordered: periods.bottom <= price.top && price.bottom <= description.top && description.bottom <= features.top, centered: Math.abs((price.left + price.right - bounds.left - bounds.right) / 2) < 2, priceAlign: getComputedStyle(node.querySelector(".landing-commercial-price")).textAlign };
    });
    assert.equal(layout.ordered, true);
    assert.equal(layout.centered, true);
    assert.equal(layout.priceAlign, "center");
    await card.screenshot({ path: "artifacts/public-package-admin-parity-desktop.png" });
    await page.locator('[data-pricing-group="basic"]').click();
    assert.ok((await page.locator('[data-commercial-offer-code="personal.internal.yearly"]').textContent()).includes("Không lấy dữ liệu tự động"));
  } });
});

test("signed-in landing starts the QR popup directly from the Bắt đầu button", async () => {
  const checkoutOrder = {
    publicId: "landing-order",
    checkoutUrl: "https://example.test/payment",
    checkoutState: "open",
    paymentState: "unverified",
    activationState: "pending",
    totalAmount: 2000,
    paymentDetails: { qrCodeImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" },
  };
  await renderScenario({
    commercial: pricingCatalog([commercialOffer("personal.internal.yearly", "Cá nhân", { tier: "personal", variant: "internal", ownerKind: "account", price: { period: "yearly", currency: "VND", subtotal: 2000, tax: 0, total: 2000 } })]),
    session: { valid: true, user: { id: "user-1", active_org_id: "personal:user-1", package_id: "free", entitlements: {} } },
    inspect: async page => {
      await page.evaluate(() => { document.cookie = "csrf_token=landing-test-token; path=/"; });
      await page.route("**/api/billing/quotes", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ publicId: "landing-quote" }) }));
      await page.route("**/api/billing/checkouts", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: checkoutOrder }) }));
      await page.route("**/api/billing/orders/landing-order", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: checkoutOrder }) }));
      const button = page.getByRole("link", { name: "Bắt đầu" });
      assert.equal(await button.count(), 1);
      assert.equal(await button.getAttribute("href"), "/goi-va-thanh-toan?checkout=personal.internal.yearly&period=yearly");
      await button.click();
      const dialog = page.getByRole("dialog", { name: "Thanh toán gói dịch vụ" });
      await dialog.getByRole("img", { name: "Mã QR thanh toán" }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/");
      assert.match(await dialog.textContent(), /2\.000/u);
      assert.doesNotMatch(await page.locator("body").textContent(), /Bắt đầu với gói này/u);
    },
  });
});

test("each pricing card selects its own period without changing other cards", async () => {
  const result = await renderScenario({
    commercial: pricingCatalog(pricingMatrix()),
    inspect: async (page) => {
      const codes = () => page.locator("[data-commercial-offer-code]").evaluateAll((nodes) => nodes.map((node) => node.dataset.commercialOfferCode));
      assert.deepEqual(await codes(), ["personal", "silver", "gold", "diamond"].map((tier) => `${tier}.internal.yearly`));
      assert.equal(await page.locator('[data-pricing-audience="account"] article').count(), 1);
      assert.equal(await page.locator('[data-pricing-audience="organization"] article').count(), 3);
      assert.equal(await page.locator('.landing-pricing-controls [data-pricing-period]').count(), 0);
      assert.equal(await page.locator('article [data-pricing-period="monthly"]').count(), 4);
      assert.doesNotMatch(await page.locator("#landing-pricing-grid").textContent(), /lượt lấy dữ liệu tự động/u);
      await page.locator('[data-pricing-group="advanced"]').focus();
      await page.keyboard.press("Enter");
      assert.deepEqual(await codes(), ["personal", "silver", "gold", "diamond"].map((tier) => `${tier}.connected.yearly`));
      assert.match(await page.locator("#landing-pricing-grid").textContent(), /Lượt lấy dữ liệu tự động kèm theo: 20/u);
      await page.locator('[data-pricing-audience="account"] [data-pricing-period="monthly"]').click();
      assert.deepEqual(await codes(), ["personal.connected.monthly", "silver.connected.yearly", "gold.connected.yearly", "diamond.connected.yearly"]);
      const personal = page.locator('[data-pricing-audience="account"] article');
      assert.match(await personal.textContent(), /123\.456/u);
      assert.doesNotMatch(await personal.textContent(), /987\.654/u);
      assert.equal(await personal.locator('[data-pricing-period="monthly"]').getAttribute("aria-pressed"), "true");
      await page.locator('[data-commercial-offer-code="silver.connected.yearly"] [data-pricing-period="monthly"]').click();
      assert.deepEqual(await codes(), ["personal.connected.monthly", "silver.connected.monthly", "gold.connected.yearly", "diamond.connected.yearly"]);
      assert.match(await page.locator("#landing-pricing-grid").textContent(), /Tên personal do Admin đặt/u);
      const packageLink = new URL(await page.locator(".landing-commercial-option a").first().getAttribute("href"), page.url());
      assert.equal(packageLink.pathname, "/dang-nhap");
      assert.equal(packageLink.searchParams.get("checkout"), "personal.connected.monthly");
      await page.addStyleTag({ url: "/views/css/tokens.css" });
      await page.addStyleTag({ url: "/views/css/variables.css" });
      await page.addStyleTag({ url: "/views/css/base.css" });
      await page.addStyleTag({ url: "/views/css/landing.css" });
      for (const width of [320, 375, 414, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
        assert.ok(dimensions.scroll <= dimensions.client + 1, `Grouped pricing overflow at ${width}: ${JSON.stringify(dimensions)}`);
      }
      const accessibility = await new AxeBuilder({ page }).include("#bang-gia").analyze();
      assert.deepEqual(accessibility.violations.filter((item) => ["serious", "critical"].includes(item.impact))
        .map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })), []);
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.locator("#bang-gia").screenshot({ path: `artifacts/pricing-card-periods-${process.pid}-desktop.png`, style: ".landing-header, .landing-skip-link { visibility: hidden; }" });
      await page.setViewportSize({ width: 375, height: 900 });
      await page.locator("#bang-gia").screenshot({ path: `artifacts/pricing-card-periods-${process.pid}-mobile.png`, style: ".landing-header, .landing-skip-link { visibility: hidden; }" });
    },
  });
  assert.deepEqual(result.requests, { commercial: 1, legacy: 0 });
  assert.deepEqual(result.errors, []);
});

test("year-only catalogs disable monthly per group and unavailable groups never retain old cards", async () => {
  const offers = pricingMatrix(["yearly"]).filter((item) => item.variant === "internal");
  offers.push(commercialOffer("custom.once", "Gói riêng", { price: { period: "one_time", currency: "VND", total: 789 } }));
  const result = await renderScenario({
    commercial: pricingCatalog(offers),
    inspect: async (page) => {
      assert.equal(await page.locator('[data-pricing-period="monthly"]').count(), 4);
      assert.equal(await page.locator('[data-pricing-period="monthly"]:disabled').count(), 4);
      await page.locator('[data-pricing-group="advanced"]').click();
      assert.equal(await page.locator('[data-commercial-group="basic"]').count(), 0);
      assert.match(await page.locator("#landing-pricing-grid").textContent(), /Chưa có gói Nâng cao đang bán/u);
      assert.equal(await page.locator('[data-commercial-offer-code="custom.once"]').count(), 1);
      await page.locator('[data-pricing-group="basic"]').click();
      assert.equal(await page.locator('[data-commercial-group="basic"]').count(), 4);
    },
  });
  assert.deepEqual(result.errors, []);
});

test("monthly availability is independent for each card and selections survive group changes", async () => {
  const offers = pricingMatrix().filter((item) => item.price.period === "yearly" || (item.variant === "connected" && item.tier === "personal"));
  await renderScenario({
    commercial: pricingCatalog(offers),
    inspect: async (page) => {
      assert.equal(await page.locator('[data-pricing-period="monthly"]:disabled').count(), 4);
      await page.locator('[data-pricing-group="advanced"]').click();
      assert.equal(await page.locator('[data-pricing-audience="account"] [data-pricing-period="monthly"]').isDisabled(), false);
      assert.equal(await page.locator('[data-pricing-audience="organization"] [data-pricing-period="monthly"]:disabled').count(), 3);
      await page.locator('[data-pricing-audience="account"] [data-pricing-period="monthly"]').click();
      await page.locator('[data-pricing-group="basic"]').click();
      assert.equal(await page.locator('[data-commercial-offer-code$="internal.yearly"]').count(), 4);
      await page.locator('[data-pricing-group="advanced"]').click();
      assert.equal(await page.locator('[data-commercial-offer-code="personal.connected.monthly"]').count(), 1);
    },
  });
});
