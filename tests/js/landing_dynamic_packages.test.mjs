import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

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

async function renderScenario({ commercial, legacy = { status: 200, payload: { packages: [compatibilityPackage] } } }) {
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
        if (commercial.networkError) {
          request.socket.destroy();
          return;
        }
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
      const relativePath = pathname.startsWith("/assets/")
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
  try {
    page = await browser.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.location().url} ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const module = await import("/frontend/landing/LandingPage.js");
      await module.bootstrapLandingPage({ valid: false });
    });
    await page.waitForFunction(() => {
      const pricingGrid = document.getElementById("landing-pricing-grid");
      return pricingGrid && !pricingGrid.hasAttribute("aria-busy");
    });
    return {
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
    await page?.close();
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
