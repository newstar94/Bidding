import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("leaving the plans route before its module loads does not start obsolete API requests", async () => {
  const apiRequests = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname.startsWith("/admin")) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head>
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
          </head><body>
          <script id="bf-admin-session" type="application/json">{"valid":true,"user":{"name":"Admin","platform_role":"super_admin"}}</script>
          <div id="admin-app"></div>
          <script type="module" src="/frontend/admin-platform/AdminApp.js"></script>
          </body></html>`);
        return;
      }
      if (pathname.startsWith("/api/")) {
        apiRequests.push(pathname);
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      const path = resolve(root, `.${pathname}`);
      if (!path.startsWith(`${root}${sep}`)) throw new Error("Invalid fixture path");
      response.writeHead(200, { "content-type": extname(path) === ".css"
        ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
      response.end(await readFile(path));
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  let releaseModule;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let moduleRequested;
    const requested = new Promise((resolveRequest) => { moduleRequested = resolveRequest; });
    const gate = new Promise((release) => { releaseModule = release; });
    await page.route("**/frontend/admin-platform/AdminPlans.js", async (route) => {
      moduleRequested();
      await gate;
      await route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/admin/plans`);
    await requested;
    await page.locator('[data-admin-link="/admin/security"]').click();
    await page.waitForFunction(() => document.title === "Bảo mật | BiddingFlow Admin");
    releaseModule();
    await page.evaluate(async () => {
      await import("/frontend/admin-platform/AdminPlans.js");
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });

    assert.equal(apiRequests.includes("/api/commercial/admin/overview"), false);
    assert.equal(apiRequests.includes("/api/public/commercial/offers"), false);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/commercial/admin/overview")),
      page.waitForResponse((response) => response.url().endsWith("/api/public/commercial/offers")),
      page.locator('[data-admin-link="/admin/plans"]').click(),
    ]);
    assert.equal(apiRequests.filter((path) => path === "/api/commercial/admin/overview").length, 1);
    assert.equal(apiRequests.filter((path) => path === "/api/public/commercial/offers").length, 1);
    assert.deepEqual(errors, []);
  } finally {
    releaseModule?.();
    await browser?.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
