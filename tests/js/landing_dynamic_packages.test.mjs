import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if (extname(pathname) === ".js" || extname(pathname) === ".mjs") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  if (extname(pathname) === ".webp") return "image/webp";
  return "application/octet-stream";
}

test("landing package cards are rendered from the public compatibility catalog", async () => {
  const template = await readFile(join(root, "views/components/landing_page.html"), "utf8");
  assert.doesNotMatch(template, /15\.000\.000|35\.000\.000|75\.000\.000/u);
  assert.doesNotMatch(template, /data-package-id=/u);

  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi" data-bf-shell="landing"><head><meta name="bf-app-debug" content="true"><title>Landing</title></head><body>${template}</body></html>`);
        return;
      }
      if (pathname === "/api/public/commercial/offers") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ availability: "off", offers: [], creditPacks: [] }));
        return;
      }
      if (pathname === "/api/public/packages") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ packages: [{
          id: "fixture-plan",
          name: "Gói từ API",
          price: "1234567",
          quota: 7,
          description: "Mô tả được cung cấp bởi catalog công khai.",
          capabilities: {
            "document.export.word": true,
            "document.export.excel": false,
            "document.export.award_result_excel": false,
          },
        }] }));
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
    await page.evaluate(async () => {
      const module = await import("/frontend/landing/LandingPage.js");
      await module.bootstrapLandingPage({ valid: false });
    });
    await page.locator("[data-package-id='fixture-plan']").waitFor();

    const card = page.locator("[data-package-id='fixture-plan']");
    assert.equal(await page.locator(".landing-price-card").count(), 1);
    assert.equal(await card.locator("h3").textContent(), "Gói từ API");
    assert.equal(await card.locator(".landing-price strong").textContent(), "1.234.567đ");
    assert.match(await card.locator(".landing-price-quota").textContent(), /Tối đa 7 nhân sự/u);
    assert.match(await card.textContent(), /Xuất biểu mẫu Word/u);
    assert.doesNotMatch(await card.textContent(), /Xuất dữ liệu Excel/u);
    assert.equal(await page.locator("#landing-pricing-grid").getAttribute("aria-busy"), null);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
