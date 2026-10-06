import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const shell = `<!doctype html><html lang="vi"><head>
  <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
</head><body><main><div id="detail-workflow-content-wrapper"></div></main></body></html>`;

// These isolated scenarios exercise confirmation boundaries with a normal
// success receipt. Injected timing does not identify the live browser cause.
for (const waitingBoundary of ["cache", "paint"]) {
  test(waitingBoundary === "cache"
    ? "qualified approval diagnoses local row-version cache completion after server ACK"
    : "qualified approval save completes after background server ACK with animation frames suspended", async (t) => {
    const received = [];
    let releaseAck;
    const ackGate = new Promise((resolve) => { releaseAck = resolve; });
    let requestArrived;
    const requestArrival = new Promise((resolve) => { requestArrived = resolve; });
    const server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (pathname === "/api/sync") {
          let body = "";
          for await (const chunk of request) body += chunk;
          received.push(JSON.parse(body));
          requestArrived();
          if (waitingBoundary === "paint") await ackGate;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({
            status: "success", syncVersion: 2,
            rowVersions: [{ table: "goithau", id: "pkg", rowVersion: 2 }],
          }));
          return;
        }
        const extension = extname(pathname);
        response.setHeader("content-type", [".js", ".mjs"].includes(extension)
          ? "text/javascript" : extension === ".css" ? "text/css"
            : extension === ".json" ? "application/json" : "text/html");
        response.end(pathname === "/" ? shell
          : await readFile(join(projectRoot, pathname.replace(/^\//u, ""))));
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(async (waitingBoundary) => {
        const { renderQualifiedApprovalPanel } = await import("/frontend/packages/detail/QualifiedApprovalPanel.js");
        const { autoSync } = await import("/frontend/app/SyncPushService.js");
        const { BiddingModel } = await import("/frontend/app/BiddingModel.js");
        const { WorkspaceMutationOutbox } = await import("/frontend/app/WorkspaceMutationOutbox.js");
        const { setupSyncUx } = await import("/frontend/app/SyncCoordinator.js");
        document.cookie = "csrf_token=fixture-token; path=/";
        let releaseWrite;
        const rowVersionWriteCompletion = new Promise((resolve) => { releaseWrite = resolve; });
        const fixture = globalThis.qualifiedConfirmationFixture = {
          releaseWrite, rowVersionWriteStarted: false, settled: false, alerts: [], renders: [],
        };
        const pkg = {
          id: "pkg", rootId: "pkg", rowVersion: 1, phienBan: "00", isLatest: 1, canEdit: true,
          trangThai: "Chuẩn bị", keHoachId: "plan", phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
          hinhThucLuaChon: "Chào hàng cạnh tranh", giaGoiThau: 1000,
          danhGiaHsdtMetadata: JSON.stringify({ is1G2T: true, technical: { saved: true }, financial: {} }),
        };
        const outbox = new WorkspaceMutationOutbox({
          store: { persist() {}, async flush() {} },
          getBaseSyncVersion: () => "1", createId: () => "qualified-confirmation-receipt",
          onChange: (summary) => model.onMutationBatchChanged?.(summary),
        });
        const model = fixture.model = {
          workspaceScope: { key: "fixture:org", organizationId: "org" },
          workspaceStorage: { getItem: () => null, removeItem() {}, setItem() {} },
          getWorkspaceToken: () => "fixture:org@1", isWorkspaceCurrent: (token) => token === "fixture:org@1",
          state: { activetab: "goithau-detail", goithau: [pkg],
            thongtinmothau: [{ id: "bid", goiThauId: "pkg", tenNhaThau: "Fixture", danhGiaKetLuan: "Đạt" }],
            kehoach: [], chudautu: [], nhathau: [], assignments: [], chuyengia: [] },
          db: { stores: ["goithau"], putRecord(table, record) {
            fixture.rowVersionWriteStarted = true;
            fixture.ackAt = performance.now();
            fixture.cachedRecord = { table, record: structuredClone(record) };
            return waitingBoundary === "cache" ? rowVersionWriteCompletion : Promise.resolve();
          } },
          _getMutationOutbox: () => outbox,
          applyCommittedRowVersions: BiddingModel.prototype.applyCommittedRowVersions,
          clearCommittedMutationBatch: (receipt) => outbox.ack(receipt),
          buildMutationSyncPayload() { return outbox.snapshotForSync(this.state); },
          getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
          hasPendingMutationOutboxChanges: () => Boolean(outbox.snapshotForSync(model.state)),
          async updateRecord(table, record) {
            this.state[table] = [record];
            outbox.enqueue({ kind: "upsert", table, records: [record] });
          },
          async persistChanges() {}, async flushMutationOutbox() { await outbox.flush(); },
          getLatestPlan: () => null, getStorageHydrationStatus: () => ({ state: "ready" }),
          getCurrentDateTimeString: () => "2026-10-06 12:00:00",
          formatVND: (value) => String(value || ""), formatCurrency: (value) => String(value || ""),
          formatDate: (value) => value,
          formatForDateInput: (value) => value, convertDMYToYMD: () => "2026-10-06",
        };
        const view = fixture.view = {
          model, _currentWorkflowPackageId: "pkg", _editingState: { qualified: true },
          initFlatpickr() {}, createIconsScoped() {}, focusInvalidControl() {},
          showToast(...args) { fixture.alerts.push(args); },
          async customAlert(...args) { fixture.alerts.push(args); },
          async showPackageDetails(...args) { fixture.renders.push(args); },
        };
        const controller = { model, view, autoSync, updateSyncState(patch = {}) {
          fixture.syncState = patch;
          if (patch.phase === "serverSaved") fixture.serverAckApplied = true;
        } };
        if (waitingBoundary === "paint") {
          setupSyncUx.call(controller);
          const originalRequestFrame = window.requestAnimationFrame.bind(window);
          const suspendedFrames = [];
          window.requestAnimationFrame = (callback) => {
            suspendedFrames.push(callback);
            return suspendedFrames.length;
          };
          fixture.releaseInitialFrames = () => {
            // The original loader waits for two nested paint callbacks. Restore
            // those two only, leaving the server-stage update's callbacks held.
            suspendedFrames.shift()?.(performance.now());
            suspendedFrames.shift()?.(performance.now());
          };
          fixture.restoreFrames = () => {
            let drained = 0;
            while (suspendedFrames.length && drained++ < 10) {
              suspendedFrames.shift()?.(performance.now());
            }
            window.requestAnimationFrame = originalRequestFrame;
          };
        }
        const contentWrapper = document.getElementById("detail-workflow-content-wrapper");
        renderQualifiedApprovalPanel(view, { contentWrapper, pkg, isTechEvalSaved: true, appController: controller });
        for (const [id, value] of [["qualified-so-qd", "ACK-DECISION"], ["qualified-ngay-qd", "06/10/2026"]]) {
          const input = contentWrapper.querySelector(`#${id}`);
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        fixture.startedAt = performance.now();
        fixture.save = contentWrapper.querySelector("#btn-save-qualified-decision").onclick()
          .finally(() => { fixture.settled = true; });
      }, waitingBoundary);
      if (waitingBoundary === "paint") {
        await requestArrival;
        const beforeAck = await page.evaluate(async () => {
          // Keep the response held beyond the 150ms cosmetic paint fallback.
          await new Promise((resolve) => setTimeout(resolve, 250));
          const fixture = globalThis.qualifiedConfirmationFixture;
          return {
            overlayVisible: document.getElementById("app-long-task-loading")?.hidden === false,
            callerSettled: fixture.settled,
            rowVersion: fixture.model.state.goithau[0].rowVersion,
            successCount: fixture.alerts.filter(([title]) => title === "Thành công").length,
          };
        });
        assert.equal(beforeAck.overlayVisible, true, "the paint deadline must not dismiss a save awaiting ACK");
        assert.equal(beforeAck.callerSettled, false, "the paint deadline must not settle an unconfirmed save");
        assert.equal(beforeAck.rowVersion, 1);
        assert.equal(beforeAck.successCount, 0, "the paint deadline must never announce save success");
        releaseAck();
      }
      await page.waitForFunction(() => globalThis.qualifiedConfirmationFixture.rowVersionWriteStarted,
        null, { timeout: 3000, polling: 10 });
      let backgroundAckPhase;
      if (waitingBoundary === "paint") {
        await page.waitForFunction(() => globalThis.qualifiedConfirmationFixture.serverAckApplied,
          null, { timeout: 3000, polling: 10 });
        backgroundAckPhase = await page.evaluate(() => globalThis.qualifiedConfirmationFixture.serverAckApplied
          ? "serverSaved" : "");
        await page.evaluate(() => globalThis.qualifiedConfirmationFixture.releaseInitialFrames());
        await page.waitForFunction(() => document.querySelector("#app-long-task-loading [data-stage='server']")
          ?.getAttribute("data-state") === "active", null, { timeout: 3000, polling: 10 });
        await page.waitForFunction(() => globalThis.qualifiedConfirmationFixture.settled,
          null, { timeout: 750, polling: 50 }).catch(() => {});
      }
      const atAck = await page.evaluate(() => {
        const fixture = globalThis.qualifiedConfirmationFixture;
        const overlay = document.getElementById("app-long-task-loading");
        return {
          overlayVisible: overlay?.hidden === false,
          callerSettled: fixture.settled,
          rowVersion: fixture.model.state.goithau[0].rowVersion,
          pendingReceipt: fixture.model.hasPendingMutationOutboxChanges(),
          elapsedToAckMs: fixture.ackAt - fixture.startedAt,
          successCount: fixture.alerts.filter(([title]) => title === "Thành công").length,
          syncPhase: fixture.syncState?.phase,
        };
      });
      t.diagnostic(`${waitingBoundary}: ACK ${Math.round(atAck.elapsedToAckMs)}ms; caller ${atAck.callerSettled ? "settled" : "pending"}`);
      assert.equal(received.length, 1);
      assert.equal(JSON.parse(received[0].goithau[0].danhGiaHsdtMetadata).technical.soQdPheDuyetKt, "ACK-DECISION");
      assert.equal(atAck.rowVersion, 2);
      assert.equal(atAck.pendingReceipt, false);
      if (waitingBoundary === "cache") {
        assert.equal(atAck.overlayVisible, true, "local cache reconciliation remains an awaited save boundary");
        assert.equal(atAck.callerSettled, false);
        assert.equal(atAck.successCount, 0, "save success follows local cache reconciliation");
      }
      await page.evaluate(async (waitingBoundary) => {
        const fixture = globalThis.qualifiedConfirmationFixture;
        fixture.releaseWrite();
        fixture.restoreFrames?.();
        if (waitingBoundary === "cache") await fixture.save;
      }, waitingBoundary);
      if (waitingBoundary === "cache") {
        assert.equal(await page.locator("#app-long-task-loading").isVisible(), false,
          "normal completion must release the overlay once the injected cache-write hold is released");
      }
      if (waitingBoundary === "paint") {
        assert.equal(backgroundAckPhase, "serverSaved", "the background sync completed with its normal ACK");
        assert.equal(atAck.overlayVisible, false,
          "the server-wait overlay remains visible solely because the cosmetic paint callbacks are suspended");
        assert.equal(atAck.callerSettled, true);
      }
    } finally {
      releaseAck();
      await browser?.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
