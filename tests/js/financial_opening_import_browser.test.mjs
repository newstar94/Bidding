import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
function canonical(name) {
  return JSON.parse(execFileSync("python", ["-c", [
    "import json,sys",
    "from backend.integrations.muasamcong_browser.canonical import normalize_opening_bundle",
    "f=json.load(open(sys.argv[1],encoding='utf-8'))",
    "print(json.dumps(normalize_opening_bundle(f['raw'],notice_no=f['request']['notifyNo'],revision_id=f['request']['notifyId'])))",
  ].join(";"), join(root, `tests/fixtures/muasamcong/opening/financial/${name}.json`)], { cwd: root, encoding: "utf8" }));
}

async function withPanel(name, exercise) {
  const opening = canonical(name);
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      response.setHeader("content-type", extname(pathname) === ".js" || extname(pathname) === ".mjs" ? "text/javascript" : "text/html");
      if (pathname.startsWith("/api/procurement/imports/opening/")) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        requests.push({ pathname, body: JSON.parse(Buffer.concat(chunks).toString()) });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          ...(pathname.endsWith("/prepare") ? { previewId: "financial-preview" } : { ok: true }),
          package: { id: "pkg", rowVersion: 3 }, opening,
        }));
      } else {
        response.end(pathname === "/" ? '<!doctype html><html><body><div id="detail-workflow-content-wrapper"></div></body></html>' : await readFile(join(root, pathname)));
      }
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async ({ opening, name }) => {
      const { renderFinancialOpeningPanel } = await import("/frontend/packages/detail/FinancialOpeningPanel.js");
      const { importFinancialOpeningFromMuasamcong } = await import("/frontend/procurement/OpeningImportWizard.js");
      const { updateServerCapabilitiesFromSession } = await import("/frontend/auth/serverCapabilities.js");
      const formatters = await import("/frontend/shared/formatters.js");
      updateServerCapabilitiesFromSession({ valid: true, user: { id: "fixture" }, serverCapabilities: ["procurement-import-v2"] });
      document.cookie = "csrf_token=fixture";
      const pkg = { id: "pkg", rootId: "pkg", rowVersion: 3, isLatest: 1, canEdit: true,
        phienBan: "00", trangThai: "Chuẩn bị", maGoiThau: opening.noticeNo, keHoachId: "plan",
        phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ", hinhThucLuaChon: "Đấu thầu rộng rãi",
        linhVuc: name === "consulting" ? "Tư vấn" : "Hàng hóa", phanLo: name === "consulting" ? "Không" : "Có",
        giaGoiThau: 30000000000, thoiGianMoThau: "2025-01-01 08:00:00",
        danhGiaHsdtMetadata: JSON.stringify({ is1G2T: true, technical: { saved: true }, financial: {} }) };
      const bids = opening.bidders.map((bid, index) => ({
        id: `bid-${index}`, goiThauId: pkg.id, maNhaThau: bid.contractorCode, maDinhDanh: bid.contractorCode,
        tenNhaThau: bid.contractorName, maPhanLo: bid.lotNo || "", tenPhanLo: bid.lotName || "",
        danhGiaKetLuan: "Đạt", danhGiaKyThuat: 88.25, giaDuThau: 123, tyLeGiamGia: 2,
        giaSauGiamGia: 120.54, hieuLucHsdt: 45,
      }));
      bids.push({ ...bids[0], id: "unqualified", maNhaThau: "vn-unqualified", danhGiaKetLuan: "Không đạt" });
      const alerts = [], toasts = [], renders = [], writes = [];
      const model = { ...formatters,
        state: { goithau: [pkg], thongtinmothau: bids, kehoach: [], nhathau: [], chudautu: [], assignments: [], chuyengia: [] },
        getLatestPlan: () => null, getStorageHydrationStatus: () => ({ state: "ready" }),
        getCurrentDateTimeString: () => "2026-10-06 12:00:00", commitLocalMutation() {},
        async persistChanges(table, changes) { writes.push({ table, changes: structuredClone(changes) }); },
        async flushMutationOutbox() {},
      };
      let confirm;
      const gate = new Promise((resolve) => { confirm = resolve; });
      const controller = { model, async autoSync() {
        window.__financialFixture.syncStarted = true;
        const result = await gate;
        window.__financialFixture.canonicalState = structuredClone(model.state);
        return result;
      } };
      const view = { model, _currentWorkflowPackageId: "pkg", _currentWorkflowTab: "opening_fin",
        _inPlaceEditMode: true, _editingState: { opening_fin: true },
        initFlatpickr() {}, createIconsScoped() {}, focusInvalidControl() {},
        showToast(...args) { toasts.push(args); }, async customAlert(...args) { alerts.push(args); },
        async showPackageDetails(...args) { renders.push(args); } };
      const wrapper = document.getElementById("detail-workflow-content-wrapper");
      renderFinancialOpeningPanel(view, { contentWrapper: wrapper, pkg, appController: controller });
      const snapshot = () => ({
        state: structuredClone(model.state), writes: structuredClone(writes), alerts, toasts, renders,
        tab: view._currentWorkflowTab,
        time: wrapper.querySelector("#op-fin-thoigianmothau")?.value,
        rows: [...wrapper.querySelectorAll("#opening-fin-table tbody tr")].map((row) => ({
          id: row.dataset.openingBidId,
          values: [...row.querySelectorAll("input")].map((input) => input.value),
        })),
      });
      window.__financialFixture = { pkg, model, view, wrapper, snapshot, confirm,
        async importSource(source = opening, afterApply, sourceError = false) {
          return importFinancialOpeningFromMuasamcong({ view, pkg, contentWrapper: wrapper, client: {
            async prepareOpening() {
              if (sourceError) throw new Error("PROCUREMENT_UPSTREAM_UNAVAILABLE");
              return { previewId: "preview", package: { id: pkg.id, rowVersion: 3 } };
            },
            async applyOpening() {
              afterApply?.();
              return { package: { id: pkg.id, rowVersion: 3 }, opening: source };
            },
          } });
        },
      };
    }, { opening, name });
    await exercise(page, opening, requests);
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const [name, time, prices] of [
  ["consulting", "29/09/2026 08:45", [4374840000]],
  ["goods_lots", "31/12/2025 15:10", [2502500000, 1820000000, 8960000000, 3050000000, 2668750000, 2550000000]],
]) {
  test(`actual financial panel imports HAR mapping and waits for canonical save: ${name}`, async () => {
    await withPanel(name, async (page, opening, requests) => {
      const before = await page.evaluate(() => window.__financialFixture.snapshot());
      const draft = await page.evaluate(async () => {
        const f = window.__financialFixture;
        await f.wrapper.querySelector("#btn-opening-fin-import-msc").onclick();
        return f.snapshot();
      });
      assert.equal(requests[0].body.openingPhase, "FINANCIAL");
      assert.equal(requests[1].body.expectedPackageRowVersion, 3);
      assert.deepEqual(draft.state, before.state, "import fills controls without saving official records");
      assert.deepEqual(draft.writes, []);
      assert.equal(draft.time, time);
      assert.equal(draft.alerts.length, 0);
      assert.equal(draft.rows.length, prices.length, "unqualified bidders are not added");
      assert.deepEqual(draft.rows.map((row) => Number(row.values[0].replace(/\D/g, ""))), prices);
      assert.ok(draft.rows.every((row) => row.values[1] === "0"));
      if (name === "consulting") assert.equal(draft.rows[0].values[3], "90 ngày");
      await page.evaluate(() => {
        window.pendingFinancialSave = window.__financialFixture.wrapper.querySelector("#btn-save-opening-fin").onclick();
      });
      await page.waitForFunction(() => window.__financialFixture.syncStarted);
      const waiting = await page.evaluate(() => window.__financialFixture.snapshot());
      assert.equal(waiting.alerts.some(([title]) => title === "Thành công"), false);
      assert.equal(waiting.tab, "opening_fin");
      const saved = await page.evaluate(async () => {
        const f = window.__financialFixture;
        f.confirm({ ok: true, canonicalCommitted: true });
        await window.pendingFinancialSave;
        return { ...f.snapshot(), canonicalState: f.canonicalState };
      });
      assert.equal(saved.alerts.some(([title]) => title === "Thành công"), true);
      assert.equal(saved.tab, "eval_fin");
      assert.deepEqual(saved.canonicalState.thongtinmothau.slice(0, prices.length).map((bid) => bid.giaDuThau), prices);
      assert.deepEqual(saved.state.thongtinmothau.slice(0, prices.length).map((bid) => bid.giaSauGiamGia), prices);
      assert.ok(saved.state.thongtinmothau.every((bid) => bid.danhGiaKyThuat === 88.25));
      assert.deepEqual(saved.state.thongtinmothau.at(-1), before.state.thongtinmothau.at(-1));
      assert.equal(saved.state.goithau[0].thoiGianMoEhsdxtc, opening.financialOpeningAt.replace("T", " ").slice(0, 16) + ":00");
    });
  });
}

test("financial import retains drafts for empty, unmatched, partial, duplicate and stale sources", async () => {
  await withPanel("consulting", async (page, opening) => {
    for (const failure of ["empty", "unmatched", "partial", "duplicate", "stale", "edited", "malformed", "sourceError", "badTime"]) {
      const result = await page.evaluate(async ({ failure, opening }) => {
        const f = window.__financialFixture;
        const before = f.snapshot();
        const source = structuredClone(opening);
        if (failure === "empty") source.bidders = [];
        if (failure === "unmatched") source.bidders[0].lotNo = "different-lot";
        if (failure === "partial") source.partial = true;
        if (failure === "duplicate") source.bidders.push({ ...source.bidders[0] });
        if (failure === "malformed") source.bidders[0].bidPrice = "bad-price";
        if (failure === "badTime") source.financialOpeningAt = "bad-time";
        const afterApply = () => {
          if (failure === "stale") f.pkg.rowVersion = 4;
          if (failure === "edited") f.wrapper.querySelector(".op-gia-du-thau").value = "777";
        };
        const ok = await f.importSource(source, afterApply, failure === "sourceError");
        const after = f.snapshot();
        f.pkg.rowVersion = 3;
        f.wrapper.querySelector(".op-gia-du-thau").value = before.rows[0].values[0];
        return { ok, before, after, disabled: f.wrapper.querySelector("#btn-save-opening-fin").disabled };
      }, { failure, opening });
      assert.equal(result.ok, false, failure);
      assert.equal(result.disabled, false, failure);
      if (failure === "edited") assert.equal(result.after.rows[0].values[0], "777");
      else assert.deepEqual(result.after.rows, result.before.rows, failure);
      assert.equal(result.after.time, result.before.time, failure);
      assert.deepEqual(result.after.writes, []);
    }
  });
});

test("source final price survives collection and manual input then recalculates it", async () => {
  await withPanel("consulting", async (page, opening) => {
    const result = await page.evaluate(async (opening) => {
      const f = window.__financialFixture;
      const { collectFinancialOpeningRows } = await import("/frontend/packages/detail/FinancialOpeningPanel.js");
      opening.bidders[0] = { ...opening.bidders[0], bidPrice: 101, discountRate: 7.5, priceAfterDiscount: 93 };
      const ok = await f.importSource(opening);
      const rows = [...f.wrapper.querySelectorAll("#opening-fin-table tbody tr")];
      const imported = collectFinancialOpeningRows(rows, { parseVND: f.model.parseVND });
      const price = rows[0].querySelector(".op-gia-du-thau");
      price.value = "200";
      price.dispatchEvent(new Event("input", { bubbles: true }));
      const edited = collectFinancialOpeningRows(rows, { parseVND: f.model.parseVND });
      return { imported, edited, ok, alerts: f.snapshot().alerts };
    }, opening);
    assert.equal(result.ok, true, JSON.stringify(result.alerts));
    assert.equal(result.imported[0].giaSauGiamGia, 93);
    assert.equal(result.imported[0].tyLeGiamGia, 7.5);
    assert.equal(result.edited[0].giaSauGiamGia, 185);
  });
});
