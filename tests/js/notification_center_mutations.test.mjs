import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function scenario(mode, inspect) {
  let read = false;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const json = (status, data) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(data));
    };
    if (pathname === "/") {
      response.writeHead(200, { "content-type": "text/html", "set-cookie": "csrf_token=fixture; Path=/" });
      response.end(`<!doctype html><html lang="vi"><body><div id="notification-center"><button id="notification-trigger">Thông báo</button><span id="notification-badge"></span><section id="notification-panel"><button id="notification-read-all">Đọc tất cả</button><div id="notification-list"></div></section></div></body></html>`);
      return;
    }
    if (pathname === "/api/notifications") {
      json(200, { items: [{ id: "n1", kind: "assignment_added", title: "Công việc", message: "Thông báo", targetType: "plan", targetId: "p1", route: "/ke-hoach/p1", readAt: read ? 1 : 0, createdAt: 1791200000 }], unreadCount: read ? 0 : 1 });
      return;
    }
    if (["/api/notifications/n1/read", "/api/notifications/read-all"].includes(pathname)) {
      if (mode === "network") { response.destroy(); return; }
      if (mode === "http") { json(500, { error: "fixture failure" }); return; }
      read = true;
      json(200, { ok: true });
      return;
    }
    const file = resolve(`.${pathname}`);
    if (!file.startsWith(process.cwd() + sep)) { response.writeHead(404).end(); return; }
    try {
      const payload = await readFile(file);
      response.writeHead(200, { "content-type": [".js", ".mjs"].includes(extname(file)) ? "text/javascript" : "application/octet-stream" });
      response.end(payload);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const { initializeNotificationCenter } = await import("/frontend/app/NotificationCenter.js");
      window.auditNotifications = { navigation: [], toasts: [] };
      window.auditNotificationCenter = initializeNotificationCenter({
        model: { state: { activeuser: { id: "a" } }, workspaceScope: { key: "org" }, dashboardSummary: { alertItems: [] } },
        switchTab: (...args) => window.auditNotifications.navigation.push(args),
        view: { showToast: (...args) => window.auditNotifications.toasts.push(args) },
      });
    });
    await page.locator('[data-notification-id="n1"]').waitFor();
    await inspect(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.evaluate(() => window.auditNotificationCenter?.dispose()).catch(() => {});
    await page.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

for (const mode of ["http", "network"]) {
  test(`notification ${mode} read failure retains unread status and still opens its target`, async () => {
    await scenario(mode, async (page) => {
      await page.locator('[data-notification-id="n1"]').click();
      await page.waitForFunction(() => window.auditNotifications.navigation.length === 1);
      assert.equal(await page.locator("#notification-badge").textContent(), "1");
      assert.equal(await page.locator('[data-notification-id="n1"]').evaluate((node) => node.classList.contains("is-unread")), true);
      assert.deepEqual(await page.evaluate(() => window.auditNotifications.navigation), [["kehoach-detail", "p1"]]);
      assert.equal(await page.evaluate(() => window.auditNotifications.toasts.length), 1);
    });
  });
}

test("read-all failure has feedback and leaves the action available for retry", async () => {
  await scenario("http", async (page) => {
    await page.locator("#notification-read-all").click();
    await page.waitForFunction(() => window.auditNotifications.toasts.length === 1);
    assert.equal(await page.locator("#notification-badge").textContent(), "1");
    assert.equal(await page.locator("#notification-read-all").isDisabled(), false);
  });
});

test("successful read updates the badge after server confirmation", async () => {
  await scenario("success", async (page) => {
    await page.locator('[data-notification-id="n1"]').click();
    await page.waitForFunction(() => window.auditNotifications.navigation.length === 1);
    assert.equal(await page.locator("#notification-badge").textContent(), "0");
    assert.equal(await page.locator("#notification-badge").evaluate((node) => node.hidden), true);
    assert.deepEqual(await page.evaluate(() => window.auditNotifications.toasts), []);
  });
});
