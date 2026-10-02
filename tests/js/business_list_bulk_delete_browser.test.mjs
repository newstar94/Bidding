import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const types = ["kehoach", "goithau", "hopdong"];

test("selected-row delete controls use canonical confirmation and preserve data until one synthetic server ACK", async () => {
  const templates = await Promise.all([...types.map((type) => `views/tabs/tab_${type}.html`), "views/modals/modal_custom_dialog.html"].map((path) => readFile(resolve(projectRoot, path), "utf8")));
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Selected rows</title>
          <link rel="stylesheet" href="/views/css/tokens.css"><link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css"><link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/generated-static-styles.css"><link rel="stylesheet" href="/views/css/ui-redesign.css">
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
        </head><body><main>${templates.join("")}</main></body></html>`);
        return;
      }
      if (pathname.startsWith("/api/")) throw new Error("The fixture never reaches a real backend.");
      const path = resolve(projectRoot, `.${pathname}`);
      if (!path.startsWith(`${projectRoot}${sep}`)) throw new Error("Invalid fixture path");
      const content = await readFile(path);
      response.writeHead(200, { "content-type": [".js", ".mjs"].includes(extname(path)) ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8" });
      response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    const apiRequests = [];
    let submitRoute;
    let unknown = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      apiRequests.push({ method: request.method(), path: url.pathname, body: request.postData() });
      const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (url.pathname === "/api/sync-version") return json({ syncVersion: "11" });
      if (url.pathname === "/api/record") {
        const table = url.searchParams.get("table");
        const id = url.searchParams.get("lookup");
        const item = await page.evaluate(({ table, id }) => window.bulkFixture.canonical[table].find((row) => row.id === id), { table, id });
        return json({ item });
      }
      if (url.pathname === "/api/paginate") return json({ items: [], totalItems: 0, hasMore: false });
      if (url.pathname === "/api/sync") {
        if (unknown) {
          await page.evaluate(() => { window.bulkFixture.model.visibilityRevision = "2"; });
          return json({ message: "No authoritative outcome" }, 500);
        }
        submitRoute = route;
        return;
      }
      return json({ error: "Unexpected fixture route" }, 400);
    });
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;
    await page.context().addCookies([{ name: "csrf_token", value: "synthetic-csrf-token", url: fixtureUrl }]);
    await page.goto(fixtureUrl);
    await page.evaluate(async () => {
      const [{ BiddingView }, controls, selection, { setAppController }, { installDialogAccessibility }] = await Promise.all([
        import("/frontend/app/BiddingView.js"), import("/frontend/shared/BusinessListControls.js"),
        import("/frontend/shared/BusinessListSelection.js"), import("/frontend/app/controllerRef.js"), import("/frontend/shared/dialogAccessibility.js"),
      ]);
      window.lucide = { createIcons() {} };
      installDialogAccessibility();
      const canonical = {};
      const names = { kehoach: "tenKeHoach", goithau: "tenGoiThau", hopdong: "tenHopDong" };
      for (const type of ["kehoach", "goithau", "hopdong"]) {
        canonical[type] = Array.from({ length: 24 }, (_, index) => ({
          id: `synthetic-${type}-${index}`, rootId: `synthetic-${type}-${index}`, phienBan: "00", isLatest: 1, rowVersion: index + 2,
          [names[type]]: `Dữ liệu giả lập ${index + 1} có tên dài để kiểm tra danh sách xác nhận trên điện thoại`,
          allVersions: [{ id: `synthetic-${type}-${index}`, phienBan: "00" }],
        }));
      }
      const model = {
        state: { activeuser: { id: "synthetic-user" }, activerole: "admin", ...structuredClone(canonical) },
        workspaceScope: { key: "synthetic-user:synthetic-org", organizationId: "synthetic-org" },
        getWorkspaceToken() { return this.workspaceScope.key; }, hasPendingMutationOutboxChanges: () => false,
        currentPage: { kehoach: 1, goithau: 1, hopdong: 1 }, savePage() {},
        db: { applySyncChanges: async () => {} }, entityIndexes: { invalidate() {} },
      };
      const view = new BiddingView(model);
      const toasts = [];
      view.showToast = (...args) => toasts.push(args);
      async function render(type) {
        await controls.ensureBusinessListControls(view, type);
        const items = model.state[type];
        const table = document.getElementById(`${type}-table`);
        table.querySelector("tbody").replaceChildren();
        for (const row of items) {
          const tr = document.createElement("tr");
          tr.insertAdjacentHTML("beforeend", controls.renderBusinessListSelectionCell(view, type, row));
          table.querySelector("tbody").appendChild(tr);
        }
        controls.updateBusinessListSelection(view, type, { items, totalItems: items.length, query: {} });
      }
      view.renderKeHoachTable = () => render("kehoach");
      view.renderGoiThauTable = () => render("goithau");
      view.renderHopDongTable = () => render("hopdong");
      const controller = { model, view, forceSyncData: async () => ({ ok: true }) };
      setAppController(controller);
      for (const type of ["kehoach", "goithau", "hopdong"]) { await controls.ensureBusinessListControls(view, type); await render(type); }
      window.bulkFixture = { model, view, controller, canonical, selection, controls, render, toasts };
    });
    const dialog = page.locator("#modal-custom-dialog");
    const posts = () => apiRequests.filter((request) => request.method === "POST");
    async function waitForSubmission() {
      for (let attempt = 0; !submitRoute && attempt < 100; attempt += 1) await new Promise((done) => setTimeout(done, 20));
      assert.ok(submitRoute, `Expected a synthetic sync POST; last request: ${JSON.stringify(apiRequests.at(-1))}`);
    }
    for (const type of types) {
      await page.evaluate((type) => document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `tab-${type}`)), type);
      const bar = page.locator(`#${type}-row-selection`);
      await page.locator(`#${type}-table tbody [data-list-select-row]`).first().check();
      assert.equal(await bar.locator("[data-list-selection-action='delete']").isVisible(), true);
      await page.evaluate(async (type) => {
        const { model, render, selection } = window.bulkFixture;
        model.state.activerole = "employee";
        await render(type);
        selection.toggleBusinessListRow(model, type, model.state[type][0], true);
      }, type);
      assert.equal(await bar.locator("[data-list-selection-action='delete']").count(), 0);
      await page.evaluate(async (type) => {
        const { model, render, selection } = window.bulkFixture;
        model.state.activerole = "admin";
        await render(type);
        selection.selectBusinessListPage(model, type, model.state[type]);
      }, type);
      const before = posts().length;
      await bar.locator("[data-list-selection-action='delete']").click();
      await page.waitForFunction(() => document.getElementById("modal-custom-dialog").classList.contains("active"));
      assert.match(await dialog.locator("#dialog-message").textContent(), /Dữ liệu giả lập 24/u);
      assert.equal(await dialog.locator("#dialog-message").evaluate((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === "auto"), true, "long confirmation lists scroll within the shared dialog");
      const bounds = await dialog.locator(".modal-card").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844);
      const cancelBounds = await dialog.locator("#btn-dialog-cancel").boundingBox();
      assert.ok(cancelBounds.y >= 0 && cancelBounds.y + cancelBounds.height <= 844, "confirmation actions remain visible on mobile");
      if (type === "goithau" && process.env.BF_BULK_DELETE_SCREENSHOT) {
        await dialog.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
        await page.screenshot({ path: process.env.BF_BULK_DELETE_SCREENSHOT });
      }
      await dialog.locator("#btn-dialog-cancel").click();
      await page.waitForFunction((type) => !document.querySelector(`#${type}-row-selection [data-list-selection-action='delete']`).disabled, type);
      assert.equal(posts().length, before, "canceling the final confirmation sends no mutation");
      assert.equal(await page.locator(`#${type}-table tbody [data-list-select-row]`).count(), 24);
      await bar.locator("[data-list-selection-action='delete']").click();
      await page.waitForFunction(() => document.getElementById("modal-custom-dialog").classList.contains("active"));
      await dialog.locator("#btn-dialog-ok").click();
      await page.waitForFunction(() => document.getElementById("app-long-task-loading")?.hidden === false);
      await waitForSubmission();
      assert.equal(posts().length, before + 1, "the selected records produce one server mutation");
      assert.equal(await page.locator(`#${type}-table tbody [data-list-select-row]`).count(), 24, "local rows remain until the server acknowledgement");
      const command = JSON.parse(posts().at(-1).body);
      assert.equal(command.deletions.length, 24);
      assert.equal(command.expectedSyncVersion, "11");
      assert.equal(new Set(command.deletions.map((row) => row.id)).size, 24);
      await submitRoute.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "success", syncVersion: "12" }) });
      submitRoute = null;
      await bar.waitFor({ state: "hidden" });
      assert.equal(await page.locator(`#${type}-table tbody [data-list-select-row]`).count(), 0);
      assert.equal(await page.evaluate((type) => window.bulkFixture.selection.getBusinessListSelection(window.bulkFixture.model, type).count, type), 0);
      assert.equal(await page.evaluate(() => window.bulkFixture.toasts.at(-1)[2]), "success");
    }
    await page.evaluate(async () => {
      const { model, canonical, render, selection } = window.bulkFixture;
      model.state.kehoach = structuredClone(canonical.kehoach);
      document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === "tab-kehoach"));
      await render("kehoach");
      selection.toggleBusinessListRow(model, "kehoach", model.state.kehoach[0], true);
    });
    unknown = true;
    const bar = page.locator("#kehoach-row-selection");
    await bar.locator("[data-list-selection-action='delete']").click();
    await page.waitForFunction(() => document.getElementById("modal-custom-dialog").classList.contains("active"));
    await dialog.locator("#btn-dialog-ok").click();
    await page.getByText("Chưa xác định kết quả xóa", { exact: true }).waitFor({ state: "visible" });
    await dialog.locator("#btn-dialog-cancel").click();
    await page.waitForFunction(() => document.querySelector("#kehoach-row-selection [data-list-selection-action='delete']")?.textContent === "Kiểm tra kết quả xóa");
    const originalBody = posts().at(-1).body;
    await page.evaluate(() => window.bulkFixture.selection.clearBusinessListSelection(window.bulkFixture.model, "kehoach"));
    assert.equal(await bar.isVisible(), true, "unresolved delete remains reachable after the checkbox selection becomes empty");
    await page.evaluate(async () => { window.bulkFixture.model.visibilityRevision = "3"; await window.bulkFixture.render("kehoach"); });
    assert.equal(await bar.locator("[data-list-selection-action='delete']").textContent(), "Kiểm tra kết quả xóa", "authorization revision refreshes preserve recovery for the same identity and workspace");
    unknown = false;
    await bar.locator("[data-list-selection-action='delete']").click();
    await page.getByText("Chưa xác định kết quả xóa", { exact: true }).waitFor({ state: "visible" });
    await dialog.locator("#btn-dialog-ok").click();
    await waitForSubmission();
    assert.equal(posts().at(-1).body, originalBody, "later retry uses exactly the previously confirmed request body");
    await submitRoute.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "success", syncVersion: "12" }) });
    await bar.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#kehoach-table tbody [data-list-select-row]").count(), 23);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise((done) => server.close(done));
  }
});
