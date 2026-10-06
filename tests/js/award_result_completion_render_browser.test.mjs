import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
async function fillAwardForm(page) {
  await page.locator("#award-so-bctd").fill("01/BCTĐ-E2E");
  await page.locator("#award-ngay-bctd").fill("06/10/2026");
  await page.locator("#award-decision-no").fill("1041/QĐ-BVHN");
  await page.locator("#award-decision-date").fill("06/10/2026");
  await page.locator(".row-status-select").selectOption("trung");
  await page.locator(".row-gia-trung").fill("4.374.840.000");
  await page.locator(".row-tg-goithau").fill("27 tháng");
}

async function withAwardPanel(exercise) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end('<!doctype html><html><head><link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css"></head><body><div id="lazy-tab-root"></div></body></html>');
        return;
      }
      if (pathname.startsWith("/api/")) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ contractors: [], results: [] }));
        return;
      }
      const source = pathname.startsWith("/tabs/") ? `/views${pathname}` : pathname;
      const path = resolve(root, `.${source}`);
      if (!path.startsWith(`${root}${sep}`)) throw new Error("Invalid fixture path");
      response.setHeader("content-type", extname(path) === ".html" ? "text/html; charset=utf-8"
        : extname(path) === ".css" ? "text/css" : "text/javascript");
      response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const [{ BiddingController }, { BiddingView }, detail, refs, runtime, formatters, workspace] = await Promise.all([
        import("/frontend/app/BiddingController.js"), import("/frontend/app/BiddingView.js"),
        import("/frontend/packages/GoiThauDetail.js"), import("/frontend/app/controllerRef.js"),
        import("/frontend/shared/runtimeState.js"), import("/frontend/shared/formatters.js"),
        import("/frontend/packages/detail/PackageWorkspaceState.js"),
      ]);
      window.lucide = { createIcons() {} };
      runtime.setHolidays({});
      const pkg = { id: "pkg", rootId: "pkg", rowVersion: 3, phienBan: "00", isLatest: 1,
        tenGoiThau: "Gói tư vấn", maGoiThau: "IB2600512536", keHoachId: "plan",
        trangThai: "Đang đánh giá", linhVuc: "Tư vấn", phanLo: "Không",
        phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ", hinhThucLuaChon: "Đấu thầu rộng rãi",
        phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá", giaGoiThau: 5000000000,
        thoiGianThucHien: "27 tháng", thoiGianMoThau: "2026-09-17 08:28:31",
        thoiGianMoEhsdxtc: "2026-09-29 08:45:00",
        danhGiaHsdtMetadata: JSON.stringify({ is1G2T: true, technical: { saved: true, qualifiedSaved: true },
          financial: { saved: true }, result: {} }) };
      const alerts = [], writes = [];
      let finishSync;
      const sync = new Promise((done) => { finishSync = done; });
      const model = { ...formatters,
        state: { goithau: [pkg], nhathau: [{ id: "contractor", rootId: "contractor", phienBan: "00", isLatest: 1,
          maNhaThau: "vn0101272842", tenNhaThau: "Trung tâm Kinh Tế và Quy Hoạch Thủy Sản" }],
          thongtinmothau: [{ id: "bid", goiThauId: "pkg", nhaThauId: "contractor", maNhaThau: "vn0101272842",
            tenNhaThau: "Trung tâm Kinh Tế và Quy Hoạch Thủy Sản", danhGiaKetLuan: "Đạt", danhGiaKyThuat: 97.05,
            diemTongHop: 100, xepHang: 1, giaDuThau: 4374840000, giaSauGiamGia: 4374840000,
            giaDeNghiTrungThau: 4374840000, thoiGianThucHien: "27 tháng" }],
          kehoach: [{ id: "plan", tenKeHoach: "Kế hoạch" }], chudautu: [], assignments: [] },
        getLatestPackage: (id) => model.state.goithau.find((item) => item.id === String(id)),
        getLatestPlan: () => model.state.kehoach[0], getLatestNhaThau: () => model.state.nhathau,
        getStorageHydrationStatus: () => ({ state: "ready" }), commitLocalMutation() {},
        async persistChanges(table, changes) { writes.push({ table, changes: structuredClone(changes) }); },
        async flushMutationOutbox() {},
      };
      const view = { model, elements: {}, _editingState: {},
        getActiveElement: BiddingView.prototype.getActiveElement,
        initFlatpickr() {}, createIconsScoped() {}, enhanceVisibleContent() {}, renderGoiThauTable() {},
        getStatusBadge: (value) => value, focusInvalidControl() {},
        async customAlert(title, message) { alerts.push({ title, message }); },
        isGoiThauDetailTabActive: () => true,
      };
      const controller = new BiddingController(model, view);
      controller.renderMoThauPanel = () => {};
      controller.renderDanhGiaHsdtPanel = () => {};
      controller.setupExcelImportEvents = () => {};
      controller.autoSync = async () => {
        window.__award.syncStarted = true;
        const result = await sync;
        window.__award.committed = structuredClone(model.state);
        return result;
      };
      view.showPackageDetails = (...args) => detail.showPackageDetails.call(view, ...args);
      refs.setAppController(controller);
      const pane = await controller.ensureLazyTab("goithau-detail");
      pane.classList.add("active");
      view._currentWorkflowPackageId = pkg.id;
      view._currentWorkflowTab = "result";
      await view.showPackageDetails(pkg.id);
      window.__award = { model, view, pkg, controller, alerts, writes, finishSync,
        dirty: () => workspace.packageWorkspaceFor(view).isDirty(),
        clearDirty: () => workspace.completePackageWorkspaceEdit(view),
      };
    });
    await exercise(page);
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise((done) => server.close(done));
  }
}

for (const dirty of [true, false]) {
test(`confirmed whole-package award renders completed results with dirty=${dirty}`, async () => {
  await withAwardPanel(async (page) => {
    await fillAwardForm(page);
    assert.equal(await page.evaluate(() => window.__award.dirty()), true);
    if (!dirty) await page.evaluate(() => window.__award.clearDirty());
    await page.evaluate(() => { window.pendingApproval = document.querySelector("#btn-approve-award").onclick(); });
    await page.waitForFunction(() => window.__award.syncStarted);
    assert.equal(await page.locator("#btn-approve-award").count(), 1, "approval remains while canonical confirmation is pending");
    assert.equal(await page.evaluate(() => window.__award.alerts.some((item) => item.title === "Chúc mừng")), false);
    const after = await page.evaluate(async () => {
      const fixture = window.__award;
      fixture.finishSync({ ok: true });
      await window.pendingApproval;
      return { alerts: fixture.alerts, dirty: fixture.dirty(), status: fixture.pkg.trangThai,
        completed: Boolean(document.querySelector(".award-result-title")),
        approvalForm: Boolean(document.querySelector("#btn-approve-award")),
        decision: fixture.committed.goithau[0].soQuyetDinhKetQua };
    });
    assert.equal(after.alerts.some((item) => item.title === "Chúc mừng"), true, JSON.stringify(after));
    assert.equal(after.completed, true, JSON.stringify(after));
    assert.equal(after.approvalForm, false, "the editable approval form must be replaced after success");
    assert.equal(after.dirty, false);
    assert.equal(after.status, "Đã có kết quả");
    assert.equal(after.decision, "1041/QĐ-BVHN");
  });
});
}

for (const syncResult of [
  { ok: false, status: 400, validation: true },
  { ok: false, status: 409, conflict: true },
  { ok: false, transport: true },
  { ok: true, localMutationsPending: true },
]) {
  test(`unconfirmed approval retains editable input and dirty state: ${JSON.stringify(syncResult)}`, async () => {
    await withAwardPanel(async (page) => {
      await fillAwardForm(page);
      const after = await page.evaluate(async (result) => {
        const fixture = window.__award;
        fixture.finishSync(result);
        await document.querySelector("#btn-approve-award").onclick();
        return { dirty: fixture.dirty(), alerts: fixture.alerts,
          completed: Boolean(document.querySelector(".award-result-title")),
          decision: document.querySelector("#award-decision-no")?.value,
        };
      }, syncResult);
      assert.equal(after.completed, false, JSON.stringify(after));
      assert.equal(after.dirty, true);
      assert.equal(after.decision, "1041/QĐ-BVHN");
      assert.equal(after.alerts.some((item) => item.title === "Chúc mừng"), false);
    });
  });
}
