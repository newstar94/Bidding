import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function withOpeningFixture(run) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head>
          <link rel="stylesheet" href="/views/css/generated-static-styles.css">
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
          <style>.tab-pane:not(.active),.is-hidden{display:none}</style>
          </head><body><div id="lazy-tab-root"></div></body></html>`);
        return;
      }
      if (pathname.startsWith("/api/")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ contractors: [], results: [] }));
        return;
      }
      const sourcePath = pathname.startsWith("/tabs/") ? `/views${pathname}` : pathname;
      const path = resolve(projectRoot, `.${sourcePath}`);
      if (!path.startsWith(`${projectRoot}${sep}`)) throw new Error("Invalid fixture path");
      response.writeHead(200, { "content-type": extname(path) === ".html"
        ? "text/html; charset=utf-8" : extname(path) === ".css"
          ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
      response.end(await readFile(path));
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const [controllerModule, viewModule, opening, importer, evaluation, detail, refs, runtime] = await Promise.all([
        import("/frontend/app/BiddingController.js"),
        import("/frontend/app/BiddingView.js"),
        import("/frontend/packages/BidProcessWorkflow.js"),
        import("/frontend/procurement/OpeningImportWizard.js"),
        import("/frontend/packages/BidEvaluationWorkflow.js"),
        import("/frontend/packages/GoiThauDetail.js"),
        import("/frontend/app/controllerRef.js"),
        import("/frontend/shared/runtimeState.js"),
      ]);
      window.lucide = { createIcons() {} };
      runtime.setHolidays({});
      const pkg = {
        id: "imported-package", rootId: "imported-package", rowVersion: 3, phienBan: "00", isLatest: 1,
        tenGoiThau: "Gói thầu từ nguồn", maGoiThau: "IB2600416773", keHoachId: "plan",
        trangThai: "Đã mở thầu", linhVuc: "Hàng hóa", phanLo: "Không",
        phuongThucLuaChon: "Một giai đoạn một túi hồ sơ", hinhThucLuaChon: "Đấu thầu rộng rãi",
        phuongPhapDanhGia: "Giá thấp nhất", giaGoiThau: 2000000,
        thoiGianDongThau: "2026-09-01T09:00:00", thoiGianMoThau: "2026-09-01T09:30:00",
        danhGiaHsdtMetadata: JSON.stringify({
          schemaVersion: 1, saved: false, qualifiedSaved: false, criteria: [],
          soBaoCao: "", ngayBaoCao: "",
        }),
      };
      const persisted = [], alerts = [], refreshes = [], deletions = [];
      const parseMoney = (value) => Number(String(value ?? "").replace(/[^0-9]/gu, "")) || 0;
      const model = {
        state: {
          goithau: [pkg], thongtinmothau: [], chudautu: [],
          kehoach: [{ id: "plan", tenKeHoach: "Kế hoạch", chuDauTuId: "investor" }],
          nhathau: [{
            id: "contractor", rootId: "contractor", phienBan: "00", isLatest: 1,
            maNhaThau: "vn0100000001", tenNhaThau: "Nhà thầu nguồn", nguoiDaiDien: "Nguyễn Văn A",
          }],
        },
        getLatestPackage: (id) => model.state.goithau.find((record) => record.id === String(id)) || pkg,
        getLatestPlan: () => model.state.kehoach[0],
        getLatestNhaThau: () => model.state.nhathau,
        parseVND: parseMoney,
        formatVND: (value) => value == null || value === "" ? "" : String(value),
        formatCurrency: (value) => String(value || 0),
        formatDateWithTime: (value) => value,
        formatForDatetimeLocal: (value) => value,
        convertDMYHMSToYMDHMS: (value) => value,
        formatForDateInput: (value) => value,
        getCurrentDateTimeString: () => "2026-09-01T09:30:00",
        replaceTableState(table, rows) { this.state[table] = rows; },
        commitLocalMutation() {},
        markDeleted(table, records) { deletions.push({ table, records: structuredClone(records) }); },
        async persistChanges(table, changes) { persisted.push({ table, changes: structuredClone(changes) }); },
        async flushMutationOutbox() {},
      };
      const view = {
        model, elements: {}, _editingState: {},
        getActiveElement: viewModule.BiddingView.prototype.getActiveElement,
        initFlatpickr() {}, createIconsScoped() {}, enhanceVisibleContent() {},
        renderGoiThauTable() {}, getStatusBadge: () => pkg.trangThai,
        async customAlert(title, message) { alerts.push({ title, message }); },
        isGoiThauDetailTabActive: () => document.getElementById("tab-goithau-detail")?.classList.contains("active"),
      };
      const controller = new controllerModule.BiddingController(model, view);
      Object.assign(controller, opening, importer, evaluation);
      controller.makeSearchableSelect = () => {};
      controller.setupExcelImportEvents = () => {};
      controller.autoSync = async () => ({ ok: true });
      view.showPackageDetails = async (...args) => {
        const task = detail.showPackageDetails.call(view, ...args);
        refreshes.push(task);
        return await task;
      };
      refs.setAppController(controller);
      window.__openingFixture = {
        controller, view, model, pkg, persisted, alerts, refreshes, deletions,
        applied: {
          package: { id: pkg.id, rowVersion: pkg.rowVersion },
          opening: { openingAt: pkg.thoiGianMoThau, bidders: [{
            contractorCode: "vn0100000001", contractorName: "Nhà thầu nguồn",
            bidPrice: 1250000, discountRate: 10, priceAfterDiscount: 1125000,
            bidValidityDays: 90, bidGuarantee: 10000, bidGuaranteeValidityDays: 120,
            executionPeriod: "90 ngày", phase: "TECHNICAL",
          }] },
        },
        async mount({ standaloneFirst = false, standaloneAfter = false } = {}) {
          if (standaloneFirst) {
            const standalone = await controller.ensureLazyTab("mothau");
            standalone.querySelector("#mothau-goithau-select").appendChild(new Option(pkg.tenGoiThau, pkg.id, true, true));
          }
          const pane = await controller.ensureLazyTab("goithau-detail");
          pane.classList.add("active");
          view._currentWorkflowPackageId = pkg.id;
          view._currentWorkflowTab = "opening";
          await view.showPackageDetails(pkg.id);
          if (standaloneAfter) await controller.ensureLazyTab("mothau");
        },
        async seedUnrelatedStandaloneDraft() {
          const unrelated = { ...structuredClone(pkg),
            id: "unrelated-package", rootId: "unrelated-package", tenGoiThau: "Gói thầu khác",
            maGoiThau: "IB2600000002", trangThai: "Đã mở thầu",
          };
          model.state.goithau.push(unrelated);
          model.state.nhathau.push({
            id: "unrelated-contractor", rootId: "unrelated-contractor", phienBan: "00", isLatest: 1,
            maNhaThau: "vn0100000002", tenNhaThau: "Nhà thầu nháp của gói khác", nguoiDaiDien: "Nguyễn Văn B",
          });
          const standalone = await controller.ensureLazyTab("mothau");
          document.getElementById("tab-goithau-detail").classList.remove("active");
          standalone.classList.add("active");
          standalone.querySelector("#mothau-goithau-select").appendChild(new Option(unrelated.tenGoiThau, unrelated.id, true, true));
          controller.renderMoThauPanel();
          standalone.querySelector("#mothau-table-tbody").replaceChildren();
          controller.addMoThauRow("1G1T_NO_LOT", unrelated, {
            id: "unrelated-opening-draft", nhaThauId: "unrelated-contractor", maDinhDanh: "vn0100000002",
            tenNhaThau: "Nhà thầu nháp của gói khác", giaDuThau: 7654321, tyLeGiamGia: 0,
          });
          standalone.classList.remove("active");
          document.getElementById("tab-goithau-detail").classList.add("active");
          return unrelated;
        },
        async importDraft() {
          const applied = this.applied;
          return await controller.importOpeningFromMuasamcong({ client: {
            async prepareOpening() {
              return { previewId: "opening-source-preview", package: { id: pkg.id, rowVersion: pkg.rowVersion } };
            },
            async applyOpening() { return applied; },
          } });
        },
        async save() {
          await controller.saveThongTinMoThau();
          await Promise.all(refreshes);
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        },
      };
    });
    await run(page, errors);
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}

test("imported opening saves source values and renders the next evaluation panel", async () => {
  await withOpeningFixture(async (page, errors) => {
    await page.evaluate(async () => {
      await window.__openingFixture.mount();
      await window.__openingFixture.importDraft();
      await window.__openingFixture.save();
    });
    const result = await page.evaluate(() => ({
      bids: window.__openingFixture.model.state.thongtinmothau.map((bid) => ({
        name: bid.tenNhaThau, price: bid.giaDuThau, discounted: bid.giaSauGiamGia,
      })),
      renderedTab: document.getElementById("detail-workflow-content-wrapper").dataset.renderedWorkflowTab,
      evaluationRows: document.querySelectorAll("#tab-goithau-detail #danhgiahsdt-table-tbody tr[data-bid-id]").length,
      alerts: window.__openingFixture.alerts,
    }));
    assert.deepEqual(errors, []);
    assert.deepEqual(result.bids, [{ name: "Nhà thầu nguồn", price: 1250000, discounted: 1125000 }], JSON.stringify(result));
    assert.equal(result.renderedTab, "eval_tech", JSON.stringify(result));
    assert.equal(result.evaluationRows, 1, JSON.stringify(result));
  });
});

test("a previously mounted standalone opening cannot receive the active package's import draft", async () => {
  await withOpeningFixture(async (page, errors) => {
    await page.evaluate(async () => {
      await window.__openingFixture.mount({ standaloneFirst: true });
      await window.__openingFixture.importDraft();
    });
    const result = await page.evaluate(() => ({
      panels: Array.from(document.querySelectorAll("#mothau-table-tbody"), (body) => ({
        pane: body.closest(".tab-pane").id,
        rows: body.querySelectorAll("tr").length,
        names: Array.from(body.querySelectorAll(".mt-ten-nha-thau"), (input) => input.value),
      })),
      selectCount: document.querySelectorAll("#mothau-goithau-select").length,
    }));
    assert.deepEqual(errors, []);
    assert.equal(result.selectCount, 2, "the production lazy loader retains both route panels");
    assert.deepEqual(result.panels.find((panel) => panel.pane === "tab-goithau-detail")?.names,
      ["Nhà thầu nguồn"], JSON.stringify(result));
    assert.deepEqual(result.panels.find((panel) => panel.pane === "tab-mothau")?.names,
      [], "import must not modify the inactive route's draft");
  });
});

test("the observed persisted opening schema renders both small and chunked evaluation tables", async () => {
  await withOpeningFixture(async (page, errors) => {
    for (const count of [1, 202]) {
      await page.evaluate(async (count) => {
        const fixture = window.__openingFixture;
        const base = {
          id: "stored-opening", goiThauId: fixture.pkg.id, nhaThauId: "contractor",
          tenNhaThau: "Nhà thầu nguồn", maDinhDanh: "vn0100000001", loaiNhaThau: "Độc lập",
          giaDuThau: "1250000", giaSauGiamGia: "1125000", giaTriDamBao: "10000",
          tyLeGiamGia: 10, hieuLucHsdt: 90, hieuLucBaoDamNgay: 120,
        };
        fixture.model.state.thongtinmothau = Array.from({ length: count }, (_, index) => ({
          ...base, id: `stored-opening-${index}`,
        }));
        fixture.pkg.trangThai = "Đang chấm thầu";
        await fixture.mount();
        fixture.view._currentWorkflowTab = "eval_tech";
        await fixture.view.showPackageDetails(fixture.pkg.id);
      }, count);
      await page.waitForFunction((count) => document.querySelectorAll(
        "#tab-goithau-detail #danhgiahsdt-table-tbody tr[data-bid-id]",
      ).length === count, count, { timeout: 5000 });
      const result = await page.evaluate(() => ({
        selectedPackage: document.querySelector("#tab-goithau-detail #danhgiahsdt-goithau-select").value,
        summaryDisplay: getComputedStyle(document.querySelector("#tab-goithau-detail #danhgiahsdt-goithau-summary")).display,
        tableDisplay: getComputedStyle(document.querySelector("#tab-goithau-detail #danhgiahsdt-container")).display,
      }));
      assert.equal(result.selectedPackage, "imported-package");
      assert.equal(result.summaryDisplay, "block", JSON.stringify(result));
      assert.equal(result.tableDisplay, "block", JSON.stringify(result));
    }
    assert.deepEqual(errors, []);
  });
});

test("duplicate routes preserve an unrelated draft through import, save, evaluation and opening reload", async () => {
  for (const mountOrder of ["standalone-first", "detail-first"]) {
    await withOpeningFixture(async (page, errors) => {
      const result = await page.evaluate(async (mountOrder) => {
        const fixture = window.__openingFixture;
        await fixture.mount({ standaloneFirst: mountOrder === "standalone-first", standaloneAfter: mountOrder === "detail-first" });
        await fixture.seedUnrelatedStandaloneDraft();
        const hiddenDraft = () => ({
          selectedPackage: document.querySelector("#tab-mothau #mothau-goithau-select").value,
          rows: Array.from(document.querySelectorAll("#tab-mothau #mothau-table-tbody tr"), (row) => ({
            id: row.dataset.id,
            name: row.querySelector(".mt-ten-nha-thau")?.value,
            price: row.querySelector(".mt-gia-du-thau")?.value,
          })),
        });
        const initialHiddenDraft = hiddenDraft();
        await fixture.importDraft();
        const importedName = document.querySelector("#tab-goithau-detail .mt-ten-nha-thau")?.value;
        await fixture.save();
        const evalSnapshot = {
          renderedTab: document.getElementById("detail-workflow-content-wrapper").dataset.renderedWorkflowTab,
          rows: document.querySelectorAll("#tab-goithau-detail #danhgiahsdt-table-tbody tr[data-bid-id]").length,
          text: document.querySelector("#tab-goithau-detail #danhgiahsdt-table-tbody").textContent,
        };
        const committed = structuredClone(fixture.persisted);
        const stateAfterSave = structuredClone(fixture.model.state);
        // An async opening action arriving after navigation to evaluation may
        // still see the inactive standalone form. It must not save that draft.
        await fixture.save();
        const staleOpeningSave = {
          persisted: structuredClone(fixture.persisted), state: structuredClone(fixture.model.state),
        };
        fixture.view._currentWorkflowTab = "opening";
        await fixture.view.showPackageDetails(fixture.pkg.id);
        return {
          mountOrder, importedName, initialHiddenDraft, finalHiddenDraft: hiddenDraft(),
          evalSnapshot, committed, stateAfterSave, staleOpeningSave,
          reopened: {
            renderedTab: document.getElementById("detail-workflow-content-wrapper").dataset.renderedWorkflowTab,
            title: document.querySelector("#tab-goithau-detail #mothau-table-title")?.textContent,
            rows: document.querySelectorAll("#tab-goithau-detail #mothau-table-tbody tr").length,
            name: document.querySelector("#tab-goithau-detail .mt-ten-nha-thau")?.textContent,
            text: document.querySelector("#tab-goithau-detail #mothau-table-tbody")?.textContent,
          },
        };
      }, mountOrder);
      assert.deepEqual(errors, []);
      assert.equal(result.importedName, "Nhà thầu nguồn", mountOrder);
      assert.deepEqual(result.finalHiddenDraft, result.initialHiddenDraft, "inactive unrelated draft was modified");
      assert.equal(result.evalSnapshot.renderedTab, "eval_tech", mountOrder);
      assert.equal(result.evalSnapshot.rows, 1, mountOrder);
      assert.match(result.evalSnapshot.text, /Nhà thầu nguồn/u);
      assert.deepEqual(result.stateAfterSave.thongtinmothau.map((bid) => bid.goiThauId), ["imported-package"], mountOrder);
      assert.equal(result.committed.some((change) => change.changes.upserts.some(
        (record) => record.id === "unrelated-opening-draft" || record.id === "unrelated-package",
      )), false, mountOrder);
      assert.deepEqual(result.staleOpeningSave.persisted, result.committed, "evaluation route must not save the hidden opening form");
      assert.deepEqual(result.staleOpeningSave.state, result.stateAfterSave, "hidden form was staged after route navigation");
      assert.equal(result.reopened.renderedTab, "opening", mountOrder);
      assert.equal(result.reopened.title, "Danh sách 1 Nhà thầu tham dự & Nộp hồ sơ", mountOrder);
      assert.equal(result.reopened.rows, 1, mountOrder);
      assert.equal(result.reopened.name, "Nhà thầu nguồn", mountOrder);
      assert.match(result.reopened.text, /1250000/u);
      assert.match(result.reopened.text, /1125000/u);
    });
  }
});

test("a financial-only source response preserves the current technical opening draft", async () => {
  await withOpeningFixture(async (page, errors) => {
    const result = await page.evaluate(async () => {
      const fixture = window.__openingFixture;
      await fixture.mount();
      await fixture.importDraft();
      document.querySelector("#tab-goithau-detail .mt-ten-nha-thau").value = "Tên nhà thầu người dùng đang sửa";
      document.querySelector("#tab-goithau-detail .mt-gia-du-thau").value = "1400000";
      const snapshot = () => ({
        rows: Array.from(document.querySelectorAll("#tab-goithau-detail #mothau-table-tbody tr"), (row) => ({
          id: row.dataset.id,
          name: row.querySelector(".mt-ten-nha-thau")?.value,
          price: row.querySelector(".mt-gia-du-thau")?.value,
        })),
        openingAt: document.querySelector("#tab-goithau-detail #op-thoigianmothau").value,
        preview: fixture.controller._openingImportPreview,
      });
      const before = snapshot();
      fixture.applied = { ...fixture.applied, opening: {
        ...fixture.applied.opening, openingAt: "2026-09-02T10:00:00",
        bidders: fixture.applied.opening.bidders.map((bid) => ({ ...bid, phase: "FINANCIAL" })),
      } };
      await fixture.importDraft();
      return { before, after: snapshot(), alerts: fixture.alerts, persisted: fixture.persisted };
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(result.after, result.before, JSON.stringify(result));
    assert.deepEqual(result.persisted, [], "a source preview must not persist the draft");
    assert.equal(result.alerts.some((alert) => alert.title === "Chưa có dữ liệu mở thầu kỹ thuật"
      && alert.message.includes("Dữ liệu đang nhập được giữ lại")), true,
      "the source had no applicable technical bidders");
  });
});

test("missing active opening rows cannot delete existing bids or save an inactive foreign draft", async () => {
  await withOpeningFixture(async (page, errors) => {
    const result = await page.evaluate(async () => {
      const fixture = window.__openingFixture;
      const savedBid = {
        id: "canonical-opening", rowVersion: 4, goiThauId: fixture.pkg.id, nhaThauId: "contractor",
        tenNhaThau: "Nhà thầu nguồn", maDinhDanh: "vn0100000001", loaiNhaThau: "Độc lập",
        giaDuThau: "1250000", giaSauGiamGia: "1125000", giaTriDamBao: "10000",
        tyLeGiamGia: 10, hieuLucHsdt: 90, hieuLucBaoDamNgay: 120, violationStatus: "NO_ACTIVE_VIOLATION",
      };
      fixture.model.state.thongtinmothau = [savedBid];
      fixture.view._editingState.opening = true;
      await fixture.mount({ standaloneFirst: true });
      await fixture.seedUnrelatedStandaloneDraft();
      const before = structuredClone(fixture.model.state);
      const hiddenDraftBefore = document.querySelector("#tab-mothau #mothau-table-tbody").innerHTML;
      document.querySelector("#tab-goithau-detail #mothau-table-tbody").replaceChildren();
      await fixture.save();
      return {
        before, after: structuredClone(fixture.model.state), status: fixture.pkg.trangThai,
        persisted: fixture.persisted, deletions: fixture.deletions, alerts: fixture.alerts,
        hiddenDraftBefore, hiddenDraftAfter: document.querySelector("#tab-mothau #mothau-table-tbody").innerHTML,
        renderedTab: document.getElementById("detail-workflow-content-wrapper").dataset.renderedWorkflowTab,
      };
    });
    assert.deepEqual(errors, []);
    assert.equal(result.status, "Đã mở thầu", JSON.stringify(result));
    assert.deepEqual(result.after, result.before, "existing canonical bids or package state were changed");
    assert.deepEqual(result.deletions, [], "missing active rows must not delete canonical bidders");
    assert.deepEqual(result.persisted, [], "empty rows must not commit a package transition");
    assert.equal(result.hiddenDraftAfter, result.hiddenDraftBefore, "foreign hidden draft was modified");
    assert.equal(result.renderedTab, "opening", JSON.stringify(result));
    assert.equal(result.alerts.some((alert) => alert.title === "Lưu thành công"), false, JSON.stringify(result));
  });
});
