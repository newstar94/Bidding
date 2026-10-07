import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("sidebar brand returns home by mouse and keyboard while collapse remains separate", async () => {
  const sidebar = await readFile(join(root, "views/components/sidebar.html"), "utf8");
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end('<!doctype html><html lang="vi"><title>Trang chủ</title><h1>Trang chủ BiddingFlow</h1></html>');
        return;
      }
      if (pathname === "/workspace") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Ứng dụng</title><link rel="stylesheet" href="/views/css/app.css"></head><body><div class="app-container">${sidebar}<main><button id="sidebar-toggle" type="button">Điều hướng</button><span id="test-current-date"></span></main></div></body></html>`);
        return;
      }
      const payload = await readFile(join(root, pathname.replace(/^\//u, "")));
      const types = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
      response.writeHead(200, { "content-type": types[extname(pathname)] || "application/octet-stream" });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const mount = async () => {
      await page.goto(`${origin}/workspace`);
      await page.evaluate(async () => {
        const { setupSidebar } = await import("/frontend/app/BiddingControllerUI.js");
        setupSidebar.call({
          model: { formatDate: () => "08/10/2026" },
          view: {
            elements: {
              sidebar: document.getElementById("sidebar"),
              sidebarToggle: document.getElementById("sidebar-toggle"),
              currentDateSpan: document.getElementById("test-current-date"),
              navButtons: [],
            },
            createIconsScoped() {},
          },
        });
      });
    };
    await mount();
    const brand = page.getByRole("link", { name: "BiddingFlow — Trang chủ" });
    assert.equal(await brand.getAttribute("href"), "/");
    await brand.getByText("BiddingFlow", { exact: true }).click();
    await page.waitForURL(`${origin}/`);
    assert.equal(await page.getByRole("heading", { name: "Trang chủ BiddingFlow" }).count(), 1);

    await mount();
    await page.getByRole("button", { name: "Thu gọn thanh bên", exact: true }).click();
    const expand = page.getByRole("button", { name: "Mở rộng thanh bên", exact: true });
    assert.equal(await expand.isVisible(), true);
    const icon = page.locator(".sidebar-brand-home .brand-icon");
    assert.equal(await icon.getAttribute("role"), null);
    assert.equal(await icon.getAttribute("aria-hidden"), "true");
    const logoBounds = await brand.boundingBox();
    const expandBounds = await expand.boundingBox();
    assert.ok(logoBounds && expandBounds && logoBounds.y + logoBounds.height <= expandBounds.y);
    await expand.click();
    assert.equal(await page.getByRole("button", { name: "Thu gọn thanh bên", exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "Thu gọn thanh bên", exact: true }).click();
    await brand.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`${origin}/`);
    assert.equal(await page.getByRole("heading", { name: "Trang chủ BiddingFlow" }).count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
