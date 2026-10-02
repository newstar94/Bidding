import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

test("partner create forms initialize once and respect navigation while address data is pending", async () => {
  const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
  const markup = (await Promise.all(["nhathau", "chudautu"].map(
    (name) => readFile(join(projectRoot, `views/modals/modal_${name}.html`), "utf8"),
  ))).join("");
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (!extname(pathname)) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head>
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
          </head><body>
          <h1 id="page-title"></h1>
          <section class="tab-pane" id="tab-nhathau"></section>
          <section class="tab-pane" id="tab-chudautu"></section>
          <button id="btn-add-nhathau">Thêm Nhà thầu mới</button>
          <button id="btn-add-chudautu">Thêm Chủ đầu tư mới</button>${markup}</body></html>`);
        return;
      }
      const payload = await readFile(join(projectRoot, pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": extname(pathname) === ".css"
        ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
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
    for (const tab of ["nhathau", "chudautu"]) {
      for (const entry of ["button", "route", "navigation-away", "lazy-navigation-away"]) {
        await page.goto(`http://127.0.0.1:${server.address().port}/${tab}`);
        await page.evaluate(async ({ tab, entry }) => {
          const { editNhaThau } = await import("/frontend/partners/NhaThauWorkflow.js");
          const { editChuDauTu } = await import("/frontend/partners/ChuDauTuWorkflow.js");
          const { switchTab } = await import("/frontend/app/BiddingControllerUI.js");
          const { setupActionListeners } = await import("/frontend/app/BiddingControllerForms.js");
          let releaseAddress;
          let addressStarts = 0;
          let editorStarts = 0;
          let opens = 0;
          const alerts = [];
          const pendingEditors = [];
          const addressReady = new Promise((resolve) => { releaseAddress = resolve; });
          const controller = {
            model: {
              state: { activetab: tab, activeaction: null, activeuser: { id: "specialist" }, nhathau: [], chudautu: [] },
              hasPermission: () => true,
              formatForDateInput: (value) => value,
              getLatestNhaThau: () => [], getLatestChuDauTu: () => [],
            },
            routeMap: { nhathau: "nha-thau", chudautu: "chu-dau-tu" },
            actionMap: { taomoi: "tao-moi" }, _workflowModulesReady: true, lazyTabPartials: {},
            view: {
              elements: { pageTitle: document.getElementById("page-title") },
              areViewModulesReady: () => true,
              openModal(id) { opens += 1; document.getElementById(id).classList.add("active"); },
              customAlert(title, message) { alerts.push({ title, message }); },
            },
            renderTabData() { return new Promise((resolve) => requestAnimationFrame(resolve)); },
            switchTab(...args) { return switchTab.call(this, ...args); },
            async initAddressDropdowns() { addressStarts += 1; await addressReady; },
          };
          if (entry === "lazy-navigation-away") {
            const modal = document.getElementById(`modal-${tab}`);
            modal.remove();
            controller.ensureLazyModal = async () => {
              await addressReady;
              document.body.appendChild(modal);
            };
          }
          const startEditor = (implementation, id) => {
            editorStarts += 1;
            // Bound the broken recursion so this regression can report its cause.
            if (editorStarts > 4) return Promise.resolve();
            const task = implementation.call(controller, id);
            pendingEditors.push(task);
            return task;
          };
          controller.partners = {
            editContractor: (id) => startEditor(editNhaThau, id),
            editInvestor: (id) => startEditor(editChuDauTu, id),
          };
          setupActionListeners.call(controller);
          window.__partnerCreateFixture = {
            releaseAddress, pendingEditors, controller,
            state: () => ({ editorStarts, addressStarts, opens, alerts }),
          };
          if (entry === "route") await controller.switchTab(tab, "taomoi", false);
          else document.getElementById(`btn-add-${tab}`).click();
        }, { tab, entry });
        const started = await page.evaluate(() => window.__partnerCreateFixture.state());
        assert.equal(started.addressStarts, entry === "lazy-navigation-away" ? 0 : 1,
          JSON.stringify({ tab, entry, started, pageErrors }));
        const beforeAddress = await page.evaluate(async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return window.__partnerCreateFixture.state();
        });
        const addressStarts = entry === "lazy-navigation-away" ? 0 : 1;
        assert.deepEqual(beforeAddress, { editorStarts: 1, addressStarts, opens: 0, alerts: [] }, `${tab} ${entry}`);
        const destination = tab === "nhathau" ? "chudautu" : "nhathau";
        const navigatesAway = entry.endsWith("navigation-away");
        if (navigatesAway) {
          await page.evaluate((destination) => (
            window.__partnerCreateFixture.controller.switchTab(destination, null, true)
          ), destination);
        }
        const afterAddress = await page.evaluate(async (tab) => {
          const fixture = window.__partnerCreateFixture;
          fixture.releaseAddress();
          await Promise.all(fixture.pendingEditors);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return {
            ...fixture.state(), path: location.pathname,
            tab: fixture.controller.model.state.activetab, action: fixture.controller.model.state.activeaction,
            active: document.getElementById(`modal-${tab}`).classList.contains("active"),
          };
        }, tab);
        const expectedTab = navigatesAway ? destination : tab;
        const expectedPath = expectedTab === "nhathau" ? "/nha-thau" : "/chu-dau-tu";
        assert.deepEqual(afterAddress, {
          editorStarts: 1, addressStarts, opens: navigatesAway ? 0 : 1, alerts: [],
          path: expectedPath + (navigatesAway ? "" : "/tao-moi"),
          tab: expectedTab, action: navigatesAway ? null : "taomoi",
          active: !navigatesAway,
        }, `${tab} ${entry}`);
      }
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
