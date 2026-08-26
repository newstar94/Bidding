import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if (extname(pathname) === ".js") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  if (extname(pathname) === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

test("local fake hosted checkout is usable, responsive and clearly simulated", async () => {
  const template = await readFile(join(root, "views/fake_checkout.html"), "utf8");
  const actions = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/thanh-toan-gia-lap/provider-fake-v1/303") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(template);
        return;
      }
      if (pathname === "/api/billing/fake-checkout/provider-fake-v1/303") {
        if (request.method === "POST") {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          actions.push(JSON.parse(Buffer.concat(chunks).toString("utf8")).action);
          response.writeHead(202, { "content-type": "application/json" });
          response.end(JSON.stringify({ accepted: true, providerStatus: "PAID" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          simulator: true,
          order: {
            publicId: "order-public-fake-303",
            totalAmount: 129000,
            paymentState: "unverified",
            activationState: "not_ready",
          },
        }));
        return;
      }
      if (pathname === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }
      const relativePath = pathname.startsWith("/vendor/")
        ? `views${pathname}`
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

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/thanh-toan-gia-lap/provider-fake-v1/303`,
      { waitUntil: "networkidle" },
    );

    assert.match(await page.locator("body").innerText(), /MÔI TRƯỜNG GIẢ LẬP/u);
    assert.match(await page.locator("#fake-order-amount").textContent(), /129[.\s]000/u);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `fake checkout overflowed by ${overflow}px`);

    await page.locator('[data-fake-action="complete"]').click();
    await page.waitForFunction(() => document.getElementById("fake-checkout-status")?.textContent.includes("Đã nhận"));
    assert.deepEqual(actions, ["complete"]);
    assert.deepEqual(consoleErrors, []);

    const accessibility = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(
      accessibility.violations.filter((item) => ["serious", "critical"].includes(item.impact)),
      [],
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
