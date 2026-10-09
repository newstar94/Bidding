import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("admin startup waits for overview and health data while showing the shell immediately", async () => {
  const pending = new Map();
  let overviewRequested, healthRequested;
  const overviewRequest = new Promise((done) => { overviewRequested = done; });
  const healthRequest = new Promise((done) => { healthRequested = done; });
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    try {
      if (pathname === "/admin") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html><body><script id="bf-admin-session" type="application/json">{"valid":true,"user":{"name":"Admin","platform_role":"super_admin"}}</script><div id="admin-app"></div><script type="module" src="/frontend/admin-platform/AdminApp.js"></script></body></html>`);
        return;
      }
      if (pathname.startsWith("/api/")) {
        pending.set(pathname, response);
        if (pathname === "/api/admin/overview") overviewRequested();
        if (pathname === "/api/admin/health") healthRequested();
        return;
      }
      const file = resolve(root, `.${pathname}`);
      if (!file.startsWith(`${root}${sep}`)) throw new Error("invalid fixture path");
      response.writeHead(200, { "content-type": extname(file) === ".css" ? "text/css" : "text/javascript" });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404); response.end("Not found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  const send = (pathname, payload) => {
    const response = pending.get(pathname);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload)); pending.delete(pathname);
  };
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/admin`, { waitUntil: "domcontentloaded" });
    await Promise.all([overviewRequest, healthRequest]);
    await page.waitForFunction(() => document.querySelector("#admin-route-content [aria-busy='true']") || document.querySelector("#admin-route-content")?.getAttribute("aria-busy") === "true");
    assert.equal(await page.evaluate(() => performance.getEntriesByName("bf:loader:hidden").length), 0);
    send("/api/admin/overview", { metrics: { organizations: 37 }, charts: [] });
    await page.locator('[data-admin-metric="organizations"]').waitFor();
    assert.equal(await page.evaluate(() => performance.getEntriesByName("bf:loader:hidden").length), 0);
    send("/api/admin/health", { resources: { application: { status: "healthy" } } });
    await page.waitForFunction(() => performance.getEntriesByName("bf:loader:hidden").length === 1);
    assert.match(await page.locator('[data-admin-metric="organizations"]').innerText(), /37/u);
    assert.deepEqual(errors, []);
  } finally {
    for (const response of pending.values()) response.end("{}");
    await browser?.close(); server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
