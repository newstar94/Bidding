import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));

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
  const template = await readFile(join(root, "views/tabs/tab_commercial_admin.html"), "utf8");
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Commercial Control Center</title></head><body>${template}</body></html>`);
        return;
      }
      if (pathname === "/api/commercial/admin/overview") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(overview));
        return;
      }
      if (pathname === "/api/commercial/drafts/draft-1") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(draft));
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
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await run(page);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Commercial Control Center renders a loaded policy document into the DOM", async () => {
  await withPage(async (page) => {
    await page.evaluate(async () => {
      const module = await import("/frontend/commercial-policy/CommercialControlCenter.js");
      await module.mountCommercialControlCenter({ view: { createIconsScoped() {} } });
    });

    const status = await page.locator("#commercial-status span:last-child").textContent();
    assert.doesNotMatch(status, /getElementById/u);
    await page.getByRole("heading", { name: "Chính sách & quyết định" }).waitFor();
    await page.getByRole("heading", { name: "Cổng thanh toán" }).waitFor();
    await page.getByText("Kỳ hạn gói cơ bản", { exact: true }).waitFor();
    assert.ok(await page.locator(".commercial-policy-list li").count() > 0);
    assert.equal(await page.getByText("Policy", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Payment provider", { exact: true }).count(), 0);
    await page.getByText("silver.internal.yearly", { exact: true }).waitFor();
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
