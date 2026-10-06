import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const shell = `<!doctype html><html><head><link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css"></head><body>
<section id="tab-goithau-timeline">
<select id="timeline-plan-select"><option value="">Chọn kế hoạch</option></select>
<select id="timeline-package-select"><option value="">Chọn gói thầu</option></select>
<select id="timeline-status-filter"><option value="">Tất cả</option></select>
<div id="timeline-empty"></div><div id="timeline-loading" hidden></div><div id="timeline-error" hidden></div>
<div id="timeline-table-wrap" hidden><table><tbody id="timeline-table-body"></tbody></table></div>
<button id="timeline-save">Lưu</button><button id="timeline-export-excel">Xuất</button>
<button id="timeline-refresh-auto"></button><button id="timeline-copy-previous"></button>
<p id="timeline-live-status"></p></section></body></html>`;

test("timeline waits for mutation confirmation and blocks export on rejected or pending saves", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html" }).end(shell);
        return;
      }
      const file = resolve(root, `.${pathname}`);
      assert.ok(file.startsWith(root + sep));
      response.setHeader("content-type", extname(file) === ".css" ? "text/css" : extname(file) === ".json" ? "application/json" : "text/javascript");
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const cases = [
      { result: { ok: false, status: 400 }, action: "save" },
      { result: { ok: false, status: 409, conflict: true }, action: "save" },
      { result: { ok: false, transport: true }, action: "save" },
      { result: { ok: true, localMutationsPending: true }, action: "save" },
      { result: { ok: false, status: 400 }, action: "export-excel" },
      { result: { ok: true }, action: "save" },
      { result: { ok: true }, action: "save", editDuringSync: true },
    ];
    for (const { result, action, editDuringSync = false } of cases) {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(async ({ result, action, editDuringSync }) => {
        const { renderPackageTimeline } = await import("/frontend/packages/PackageTimelineView.js");
        const { setAppController } = await import("/frontend/app/controllerRef.js");
        const fixture = { pushes: 0, pulls: 0, exports: 0, alerts: [], updates: [] };
        const pkg = { id: "pkg", rootId: "pkg", keHoachId: "plan", canEdit: true, timelineItems: [] };
        const model = {
          getWorkspaceToken: () => "user:org@1", workspaceScope: { key: "user:org" },
          state: { activeuser: { wordExportEnabled: true }, kehoach: [], goithau: [pkg], hopdong: [] },
          async updateRecord(table, row) { fixture.updates.push({ table, row }); this.state.goithau = [row]; },
        };
        const view = { model, initFlatpickr() {}, createIconsScoped() {}, showToast(...args) { fixture.alerts.push(args); } };
        renderPackageTimeline.call(view);
        const state = view._packageTimelineState;
        state.package = pkg;
        state.rows = [{ id: "row", milestoneKey: "manual", sourceMode: "MANUAL", applicability: "APPLICABLE", soVanBan: "ENTERED" }];
        state.dirty = true;
        fixture.state = state;
        setAppController({
          model,
          async autoSync() {
            fixture.pushes += 1;
            if (editDuringSync) state.rows[0].soVanBan = "NEW-EDIT";
            return result;
          },
          async forceSyncData() { fixture.pulls += 1; return { ok: true }; },
          async prepareExportSnapshot() { fixture.exports += 1; throw new Error("unexpected export"); },
        });
        window.__timelineSave = fixture;
        const button = document.getElementById(`timeline-${action}`);
        button.disabled = false;
        button.click();
      }, { result, action, editDuringSync });
      await page.waitForFunction(() => window.__timelineSave.alerts.length > 0);
      const snapshot = await page.evaluate(() => {
        const f = window.__timelineSave;
        return { pushes: f.pushes, dirty: f.state.dirty, rows: f.state.rows, exports: f.exports,
          success: f.alerts.some(([title]) => title === "Thành công"), updates: f.updates };
      });
      assert.equal(snapshot.pushes, 1, `must send mutations, not rely on a successful pull: ${JSON.stringify(snapshot)}`);
      assert.equal(snapshot.success, result.ok === true && !result.localMutationsPending && !editDuringSync, JSON.stringify(snapshot));
      assert.equal(snapshot.dirty, !snapshot.success, JSON.stringify(snapshot));
      assert.equal(snapshot.rows[0].soVanBan, editDuringSync ? "NEW-EDIT" : "ENTERED");
      assert.equal(snapshot.exports, 0, "failed save cannot prepare an export");
      assert.equal(snapshot.updates[0].row.timelineItems[0].soVanBan, "ENTERED");
    }
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise((done) => server.close(done));
  }
});
