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

test("user navigation no longer exposes the commercial storefront", async () => {
  const sidebar = await readFile(join(root, "views/components/sidebar.html"), "utf8");
  assert.doesNotMatch(sidebar, /commercial-storefront/u);
  assert.doesNotMatch(sidebar, /Gói dịch vụ &amp; thanh toán/u);
});

test("account profile renders Vietnamese personal purchase history", async () => {
  const template = await readFile(join(root, "views/tabs/tab_profile.html"), "utf8");
  let activeOrganizationHeader = "";
  let orderRequests = 0;
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Tài khoản</title></head><body>${template}</body></html>`);
        return;
      }
      if (pathname === "/api/billing/orders") {
        orderRequests += 1;
        activeOrganizationHeader = String(request.headers["x-active-org"] || "");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          orders: [{
            publicId: "order-personal-00000001",
            ownerKind: "account",
            operation: "credit_pack",
            totalAmount: 99000,
            checkoutState: "open",
            paymentState: "unverified",
            activationState: "not_ready",
            createdAt: "2026-08-27 09:30:00",
          }],
        }));
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
      sessionStorage.setItem("bf_active_org", "organization-active");
      const module = await import("/frontend/billing/ProfilePurchaseHistory.js");
      await module.mountProfilePurchaseHistory({ view: { createIconsScoped() {} } });
    });

    assert.equal(orderRequests, 1);
    assert.equal(activeOrganizationHeader, "organization-active");
    assert.equal(await page.getByText("Mua thêm lượt tra cứu", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Chờ thanh toán", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Chưa sẵn sàng", { exact: true }).count(), 1);
    assert.equal(await page.getByText("99.000 ₫", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Đã tải 1 giao dịch gần nhất.", { exact: true }).count(), 1);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
