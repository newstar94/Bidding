import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import {
  captureModalReturnState,
  consumeModalReturnState,
  updateModalReturnAction,
} from "../../frontend/app/modalReturnState.js";

test("modal return state preserves list, detail, edit and nested origins", () => {
  for (const [tab, action] of [
    ["kehoach", null],
    ["kehoach-detail", "plan-a"],
    ["goithau-detail", "package-a"],
    ["kehoach", "chinhsua"],
  ]) {
    consumeModalReturnState();
    captureModalReturnState(tab, action);
    captureModalReturnState("goithau", "taomoi");
    assert.deepEqual(consumeModalReturnState("kehoach"), { tab, action });
  }
  captureModalReturnState("kehoach-detail", "plan-a");
  updateModalReturnAction("plan-new-version");
  assert.deepEqual(consumeModalReturnState("kehoach"), {
    tab: "kehoach-detail", action: "plan-new-version",
  });
  assert.deepEqual(consumeModalReturnState("kehoach"), { tab: "kehoach", action: null });
});

test("closing a reloaded create modal returns its own list and preserves other origins", () => {
  for (const tab of ["kehoach", "goithau", "hopdong"]) {
    captureModalReturnState(tab, "taomoi");
    assert.deepEqual(consumeModalReturnState(tab), { tab, action: null });
  }
  for (const [tab, defaultTab] of [
    ["kehoach-detail", "kehoach"],
    ["goithau-detail", "goithau"],
    ["hopdong-detail", "hopdong"],
    ["kehoach", "goithau"],
    ["goithau", "hopdong"],
  ]) {
    captureModalReturnState(tab, "taomoi");
    assert.deepEqual(consumeModalReturnState(defaultTab), { tab, action: "taomoi" });
  }
});

test("F5 on the plan create route allows both X and Cancel to close without reopening", async () => {
  const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
  const markup = await readFile(join(projectRoot, "views/modals/modal_kehoach.html"), "utf8");
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (!extname(pathname)) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head>
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
          </head><body><h1 id="page-title"></h1><section class="tab-pane" id="tab-kehoach"></section>${markup}</body></html>`);
        return;
      }
      const payload = await readFile(join(projectRoot, pathname.replace(/^\//u, "")));
      response.writeHead(200, {
        "content-type": [".js", ".mjs"].includes(extname(pathname))
          ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8",
      });
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
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const results = [];
    for (const selector of [".modal-close", '.modal-footer [data-close="modal-kehoach"]']) {
      await page.goto(`http://127.0.0.1:${server.address().port}/ke-hoach/tao-moi`);
      await page.reload();
      await page.evaluate(async () => {
        globalThis.lucide = { createIcons() {} };
        const { editKeHoach } = await import("/frontend/plans/KeHoachWorkflow.js");
        const { switchTab, closeModal } = await import("/frontend/app/BiddingControllerUI.js");
        const { setupActionListeners } = await import("/frontend/app/BiddingControllerForms.js");
        const pendingEditors = [];
        let opens = 0;
        const controller = {
          model: {
            state: { activetab: "dashboard", activeaction: null, kehoach: [] },
            db: {}, workspaceStorage: {}, workspaceScope: { key: "user:org-a" },
            getWorkspaceToken: () => "user:org-a@1",
            getLatestChuDauTu: () => [],
          },
          routeMap: { kehoach: "ke-hoach" }, actionMap: { taomoi: "tao-moi" },
          _workflowModulesReady: true, lazyTabPartials: {}, procurementPlanImport: null,
          makeSearchableSelect() {}, renderTabData() {},
          view: {
            elements: { pageTitle: document.getElementById("page-title") },
            areViewModulesReady: () => true,
            openModal(id) { opens += 1; document.getElementById(id).classList.add("active"); },
            closeModal(id) { document.getElementById(id).classList.remove("active"); },
          },
          switchTab(...args) { return switchTab.call(this, ...args); },
          closeModal(...args) { return closeModal.call(this, ...args); },
          plans: { edit(id) { const task = editKeHoach.call(controller, id); pendingEditors.push(task); return task; } },
        };
        setupActionListeners.call(controller);
        window.__modalReturnFixture = { controller, pendingEditors, getOpens: () => opens };
        await controller.switchTab("kehoach", "taomoi", false);
        await pendingEditors.at(-1);
      });
      assert.equal(await page.locator("#modal-kehoach").evaluate((modal) => modal.classList.contains("active")), true);
      await page.locator(selector).click();
      results.push(await page.evaluate(async () => {
        const { controller, pendingEditors, getOpens } = window.__modalReturnFixture;
        await pendingEditors.at(-1);
        // Let the same create-route auto-open microtask and subsequent paints settle.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          path: location.pathname,
          tab: controller.model.state.activetab,
          action: controller.model.state.activeaction,
          active: document.getElementById("modal-kehoach").classList.contains("active"),
          opens: getOpens(),
        };
      }));
    }
    assert.deepEqual(results, Array.from({ length: 2 }, () => ({
      path: "/ke-hoach", tab: "kehoach", action: null, active: false, opens: 1,
    })));
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
