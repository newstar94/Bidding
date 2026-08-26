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
  return "application/octet-stream";
}

test("commercial-off storefront renders a controlled state without billing requests", async () => {
  const template = await readFile(join(root, "views/tabs/tab_commercial_storefront.html"), "utf8");
  let billingRequests = 0;
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Storefront</title></head><body>${template}</body></html>`);
        return;
      }
      if (pathname === "/api/public/commercial/offers") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ availability: "off", offers: [], creditPacks: [], quotaWarnings: [] }));
        return;
      }
      if (pathname.startsWith("/api/billing/")) {
        billingRequests += 1;
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: "BLOCKED_DECISION" }));
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
      const module = await import("/frontend/commercial-policy/CommercialStorefront.js");
      await module.mountCommercialStorefront({ model: { state: { activeuser: { id: "user-1" } } } });
    });

    assert.equal(billingRequests, 0);
    assert.match(await page.locator("#storefront-status").textContent(), /Cửa hàng đang tạm đóng/u);
    assert.match(await page.locator("#storefront-offers").textContent(), /Cửa hàng chưa mở bán/u);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
