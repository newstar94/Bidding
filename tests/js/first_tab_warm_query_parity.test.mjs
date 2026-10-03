import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

test("primary warming shares the real business-list renderer queries and avoids loading skeletons", async () => {
  const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
  const tables = ["kehoach", "goithau", "hopdong"];
  const markup = tables.map((table) => `<section id="tab-${table}" class="tab-pane active">
    <input id="search-${table}" value=""><table id="${table}-table"><tbody></tbody></table>
    <div id="${table}-pagination"></div></section>`).join("");
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head>
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
          </head><body>${markup}<select id="filter-goithau-trangthai"><option value=""></option></select>
          <select id="filter-goithau-hinhthuc"><option value=""></option></select></body></html>`);
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
    for (const filtered of [false, true]) {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const results = await page.evaluate(async (filtered) => {
        window.lucide = { createIcons() {} };
        const { BiddingController } = await import("/frontend/app/BiddingController.js");
        const { renderKeHoachTable } = await import("/frontend/plans/KeHoachView.js");
        const { renderGoiThauTable } = await import("/frontend/packages/GoiThauTable.js");
        const { renderHopDongTable } = await import("/frontend/contracts/HopDongComponent.js");
        const { setBusinessListFilters } = await import("/frontend/shared/BusinessListFilters.js");
        const tables = ["kehoach", "goithau", "hopdong"];
        const requests = [];
        window.fetch = async (url) => {
          const params = new URL(String(url), location.origin).searchParams;
          requests.push({ table: params.get("table"), filters: params.get("filters"), alertKey: params.get("alertKey") });
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return new Response(JSON.stringify({ items: [], totalItems: 0, hasMore: false, nextCursor: null }));
        };
        const model = {
          useServerSidePagination: true, pageSize: 10,
          getWorkspaceToken: () => "fixture:organization@1",
          workspaceScope: { key: "fixture:organization", userId: "fixture", organizationId: "organization" },
          state: { activetab: "dashboard", activerole: "manager", activeuser: { id: "fixture" },
            kehoach: [], goithau: [], hopdong: [], chudautu: [], nhathau: [], chuyengia: [], assignments: [] },
          currentPage: { kehoach: 1, goithau: 1, hopdong: 1 },
          sortState: { kehoach: { field: "maKeHoach", order: "asc" }, goithau: { field: "maGoiThau", order: "asc" }, hopdong: { field: "tenHopDong", order: "asc" } },
          normalizeRecordKeys: (record) => record, entityIndexes: { invalidate() {} },
          getLatestPackages: () => [], hasPermission: () => true,
          dashboardAlertFilter: filtered ? "overdueOpening" : "",
        };
        if (filtered) {
          for (const type of tables) setBusinessListFilters(model, type, [{
            field: type === "goithau" ? "keHoachId" : "chuDauTuId", operator: "in", value: ["fixture-reference"],
          }]);
        }
        const controller = Object.create(BiddingController.prototype);
        controller.model = model;
        controller.view = { elements: { navButtons: tables.map((tab) => ({
          hidden: false, getAttribute: (name) => name === "data-tab" ? tab : null,
        })) } };
        await controller.warmPrimaryTabData();
        const warmRequests = requests.length;
        const rendererResults = [];
        const view = { model, enhanceTableHeaders() {} };
        for (const [table, render] of [["kehoach", renderKeHoachTable], ["goithau", renderGoiThauTable], ["hopdong", renderHopDongTable]]) {
          model.state.activetab = table;
          const tbody = document.querySelector(`#${table}-table tbody`);
          let skeletonObserved = false;
          const observer = new MutationObserver(() => {
            skeletonObserved ||= Boolean(tbody.querySelector('[data-table-state="loading"]'));
          });
          observer.observe(tbody, { childList: true, subtree: true });
          const before = requests.length;
          await render.call(view);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          observer.disconnect();
          rendererResults.push({ table, paginationRequests: requests.length - before, skeletonObserved });
        }
        return { warmRequests, warmQueries: requests.slice(0, warmRequests), rendererResults };
      }, filtered);
      assert.equal(results.warmRequests, 3);
      assert.deepEqual(results.warmQueries, tables.map((table) => ({
        table,
        filters: JSON.stringify(filtered ? [{
          field: table === "goithau" ? "keHoachId" : "chuDauTuId", operator: "in", value: ["fixture-reference"],
        }] : []),
        alertKey: table === "goithau" ? (filtered ? "overdueOpening" : "") : null,
      })), `filtered=${filtered}: warming must preserve all filter and alert conditions`);
      assert.deepEqual(results.rendererResults, tables.map((table) => ({
        table, paginationRequests: 0, skeletonObserved: false,
      })), `filtered=${filtered}: warmed exact queries must be shared by the real renderers`);
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
