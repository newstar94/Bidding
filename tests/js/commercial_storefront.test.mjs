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

async function renderScenario(catalog, activeuser = { id: "user-1" }) {
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
        writeJson(response, 200, { orders: [] });
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
    page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async (actor) => {
      const module = await import("/frontend/commercial-policy/CommercialStorefront.js");
      await module.mountCommercialStorefront({ model: { state: { activeuser: actor } } });
    }, activeuser);
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
