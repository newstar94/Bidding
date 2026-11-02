import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const types = ["kehoach", "goithau", "hopdong"];

test("selected-row bulk actions follow row-level visibility and commit one canonical sync batch", async () => {
  const templates = await Promise.all([...types.map((type) => `views/tabs/tab_${type}.html`), "views/modals/modal_custom_dialog.html"].map((path) => readFile(resolve(projectRoot, path), "utf8")));
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Bulk actions</title>
          <link rel="stylesheet" href="/views/css/tokens.css"><link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css"><link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/views.css">
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const syncBodies = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (url.pathname === "/api/sync-version") return json({ syncVersion: "11" });
      if (url.pathname === "/api/record") {
        const table = url.searchParams.get("table");
        const id = url.searchParams.get("lookup");
        const item = await page.evaluate(({ table, id }) => window.bulkFixture.canonical[table].find((row) => row.id === id), { table, id });
        return json({ item });
      }
      if (url.pathname === "/api/paginate") {
        if (url.searchParams.get("table") === "assignments") {
          return json({ items: [{ id: "as-existing", empId: "emp-2", targetId: "synthetic-goithau-0", type: "goithau", rowVersion: 3 }], totalItems: 1, hasMore: false });
        }
        return json({ items: [], totalItems: 0, hasMore: false });
      }
      if (url.pathname === "/api/sync") {
        const body = JSON.parse(request.postData());
        syncBodies.push(body);
        const rowVersions = (body.hopdong || []).map((row) => ({ table: "hop_dong", id: row.id, rowVersion: row.expectedVersion + 1 }));
        return json({ status: "success", syncVersion: "12", rowVersions });
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
        canonical[type] = Array.from({ length: 4 }, (_, index) => ({
          id: `synthetic-${type}-${index}`, rootId: `synthetic-${type}-${index}`, phienBan: "00", isLatest: 1, rowVersion: index + 2,
          [names[type]]: `Dữ liệu giả lập ${index + 1}`,
          ...(type === "hopdong" ? { soHopDong: `HD-${index + 1}`, trangThaiHopDong: "Đang thực hiện", goiThauIds: [] } : {}),
          allVersions: [{ id: `synthetic-${type}-${index}`, phienBan: "00" }],
        }));
      }
      const model = {
        state: {
          activeuser: { id: "synthetic-user", wordExportEnabled: false }, activerole: "manager", ...structuredClone(canonical),
          customcontractstatuses: [{ name: "Đang thực hiện" }, { name: "Hoàn thành" }],
          employees: [{ id: "emp-1", name: "Nhân sự Một", email: "mot@example.test" }, { id: "emp-2", name: "Nhân sự Hai", email: "hai@example.test" }],
          assignments: [{ id: "as-existing", empId: "emp-2", targetId: "synthetic-goithau-0", type: "goithau", rowVersion: 3 }],
        },
        workspaceScope: { key: "synthetic-user:synthetic-org", organizationId: "synthetic-org" },
        getWorkspaceToken() { return this.workspaceScope.key; }, hasPendingMutationOutboxChanges: () => false,
        currentPage: { kehoach: 1, goithau: 1, hopdong: 1 }, savePage() {},
        db: { applySyncChanges: async () => {} }, entityIndexes: { invalidate() {} },
        replaceTableState(type, rows) { this.state[type] = rows; return rows; },
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
      setAppController({ model, view, forceSyncData: async () => ({ ok: true }) });
      for (const type of ["kehoach", "goithau", "hopdong"]) await render(type);
      window.bulkFixture = { model, view, canonical, selection, render, toasts };
    });

    const actionIds = async (type) => page.locator(`#${type}-row-selection [data-list-selection-action]`).evaluateAll(
      (buttons) => buttons.map((button) => button.dataset.listSelectionAction),
    );
    const showTab = (type) => page.evaluate((type) => document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `tab-${type}`)), type);
    const expected = { kehoach: ["word", "delete", "clear"], goithau: ["assign", "word", "delete", "clear"], hopdong: ["assign", "status", "word", "delete", "clear"] };
    for (const type of types) {
      await showTab(type);
      await page.locator(`#${type}-table tbody [data-list-select-row]`).first().check();
      assert.deepEqual(await actionIds(type), expected[type], `${type} offers the row-equivalent bulk actions`);
      const word = page.locator(`#${type}-row-selection [data-list-selection-action='word']`);
      assert.equal(await word.isDisabled(), true, "Word export follows the workspace entitlement");
      assert.match(await word.getAttribute("title"), /gói trả phí/u);
      await page.evaluate(async (type) => {
        const { model, render, selection } = window.bulkFixture;
        model.state.activerole = "employee";
        await render(type);
        selection.toggleBusinessListRow(model, type, model.state[type][0], true);
      }, type);
      assert.equal((await actionIds(type)).includes("assign"), false, "employees cannot assign from the list, as in the record form");
      // A role change starts a new list scope; the app re-renders every list.
      await page.evaluate(async () => {
        const { model, render } = window.bulkFixture;
        model.state.activerole = "manager";
        for (const listType of ["kehoach", "goithau", "hopdong"]) await render(listType);
      });
    }

    const dialog = page.locator("#modal-custom-dialog");
    // Contract status: choose a status, confirm, one sync with in-place updates.
    await showTab("hopdong");
    const contractRows = page.locator("#hopdong-table tbody [data-list-select-row]");
    await contractRows.nth(0).check();
    await contractRows.nth(1).check();
    await page.locator("#hopdong-row-selection [data-list-selection-action='status']").click();
    await page.locator("#dialog-custom-select").waitFor();
    await page.locator("#dialog-custom-select").selectOption("Hoàn thành");
    await page.locator("#btn-dialog-ok").click();
    await dialog.locator("#dialog-title", { hasText: "Xác nhận đổi trạng thái" }).waitFor();
    assert.match(await page.locator("#dialog-message").textContent(), /Đổi 2\/2 hợp đồng sang trạng thái “Hoàn thành”/u);
    await page.locator("#btn-dialog-ok").click();
    await page.waitForFunction(() => window.bulkFixture.toasts.length > 0);
    assert.equal(syncBodies.length, 1);
    assert.equal(syncBodies[0].expectedSyncVersion, "11");
    assert.deepEqual(syncBodies[0].hopdong.map((row) => [row.id, row.trangThaiHopDong, row.expectedVersion, row.goiThauIds]), [
      ["synthetic-hopdong-0", "Hoàn thành", 2, []], ["synthetic-hopdong-1", "Hoàn thành", 3, []],
    ]);
    assert.deepEqual(await page.evaluate(() => window.bulkFixture.model.state.hopdong.slice(0, 3).map((row) => [row.trangThaiHopDong, row.rowVersion])), [
      ["Hoàn thành", 3], ["Hoàn thành", 4], ["Đang thực hiện", 4],
    ]);

    // Assignment: the picker must have a choice before Continue; replace removes others.
    await showTab("goithau");
    await page.evaluate(() => { window.bulkFixture.toasts.length = 0; });
    await page.locator("#goithau-table tbody [data-list-select-row]").first().check();
    await page.locator("#goithau-row-selection [data-list-selection-action='assign']").click();
    await page.locator("#business-list-bulk-assignees").waitFor({ state: "attached" });
    assert.equal(await page.locator("#btn-dialog-ok").isDisabled(), true);
    await page.evaluate(() => {
      const select = document.getElementById("business-list-bulk-assignees");
      select.querySelector("option[value='emp-1']").selected = true;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("input[name='business-list-bulk-assignment-mode'][value='replace']").check();
    assert.equal(await page.locator("#btn-dialog-ok").isDisabled(), false);
    await page.locator("#btn-dialog-ok").click();
    await dialog.locator("#dialog-title", { hasText: "Xác nhận phân công" }).waitFor();
    assert.match(await page.locator("#dialog-message").textContent(), /Thêm 1 phân công, gỡ 1 phân công/u);
    await page.locator("#btn-dialog-ok").click();
    await page.waitForFunction(() => window.bulkFixture.toasts.length > 0);
    assert.equal(syncBodies.length, 2);
    assert.deepEqual(syncBodies[1].assignments.map(({ empId, targetId, type }) => ({ empId, targetId, type })), [
      { empId: "emp-1", targetId: "synthetic-goithau-0", type: "goithau" },
    ]);
    assert.deepEqual(syncBodies[1].deletions, [{ table: "assignments", id: "as-existing", expectedVersion: 3 }]);
    assert.equal(await page.locator(".business-list-bulk-dialog").count(), 0, "the injected picker is removed after the dialog");
    assert.equal(await page.locator("#btn-dialog-ok").isDisabled(), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
});
