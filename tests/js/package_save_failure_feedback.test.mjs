import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

import { savePackageFinancialOpening } from "../../frontend/packages/packageFinancialOpening.js";
import { saveQualifiedApproval } from "../../frontend/packages/packageEvaluationProgress.js";
import { savePackagePreparation } from "../../frontend/packages/packagePreparation.js";

const failures = [
  { ok: false, status: 400, validation: true },
  { ok: false, status: 409, conflict: true, serverReloaded: true },
  { ok: false, transport: true },
  { ok: true, localMutationsPending: true },
];

test("package save helpers never return a saved package without canonical confirmation", async () => {
  for (const failure of failures) {
    for (const kind of ["financial", "qualified", "preparation"]) {
      const pkg = { id: "pkg", rootId: "pkg", phienBan: "00", isLatest: 1,
        trangThai: "Chuẩn bị", keHoachId: "plan", timelineItems: [], ehsmtAdjustments: [], phanLoList: [] };
      const model = {
        state: { goithau: [pkg], thongtinmothau: [], goithauhanghoa: [], hanghoaduthaunhathau: [], assignments: [] },
        getLatestPlan: () => ({ id: "plan" }), getStorageHydrationStatus: () => ({ state: "ready" }),
        getCurrentDateTimeString: () => "2026-10-06 12:00:00", commitLocalMutation() {},
        async persistChanges() {}, async flushMutationOutbox() {},
        async updateRecord(table, record) { this.state[table] = [record]; },
      };
      const controller = { model, async autoSync() { return failure; } };
      const save = () => kind === "financial"
        ? savePackageFinancialOpening(controller, pkg, [], { openingTime: "2026-10-06 12:00:00" })
        : kind === "qualified" ? saveQualifiedApproval(controller, pkg, { technical: { qualifiedSaved: true } })
          : savePackagePreparation(controller, pkg, { soQuyetDinh: "entered" });
      await assert.rejects(save, (error) => error.syncResult === failure, `${kind}: ${JSON.stringify(failure)}`);
    }
  }
});

export async function withDesktopFixture(shell, exercise) {
  const projectRoot = new URL("../../", import.meta.url);
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const type = extname(pathname);
      response.setHeader("content-type", [".js", ".mjs"].includes(type) ? "text/javascript"
        : type === ".css" ? "text/css" : type === ".json" ? "application/json" : "text/html");
      response.end(pathname === "/" ? shell : await readFile(join(projectRoot.pathname.replace(/^\/(\w:)/u, "$1"), pathname)));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    return await exercise(page);
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

const PANEL_SHELL = `<!doctype html><html><head><link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css"></head><body>
  <div id="detail-workflow-content-wrapper"></div></body></html>`;

test("actual financial, qualified and preparation callers retain rejected input and never announce success", async () => {
  await withDesktopFixture(PANEL_SHELL, async (page) => {
    for (const kind of ["financial", "qualified", "preparation"]) {
      for (const failure of failures) {
        await page.reload();
        const result = await page.evaluate(async ({ kind, failure }) => {
          const { renderFinancialOpeningPanel } = await import("/frontend/packages/detail/FinancialOpeningPanel.js");
          const { renderQualifiedApprovalPanel } = await import("/frontend/packages/detail/QualifiedApprovalPanel.js");
          const { renderPreparationDetailsPanel } = await import("/frontend/packages/detail/PreparationDetailsPanel.js");
          const pkg = { id: "pkg", rootId: "pkg", phienBan: "00", isLatest: 1, canEdit: true,
            trangThai: "Chuẩn bị", keHoachId: "plan", phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
            hinhThucLuaChon: "Chào hàng cạnh tranh", giaGoiThau: 1000,
            danhGiaHsdtMetadata: JSON.stringify({ is1G2T: true, technical: { saved: true }, financial: {} }) };
          const alerts = [], renders = [];
          const model = {
            state: { goithau: [pkg], thongtinmothau: [{ id: "bid", goiThauId: "pkg", tenNhaThau: "Fixture", danhGiaKetLuan: "Đạt" }],
              kehoach: [], chudautu: [], nhathau: [], assignments: [], chuyengia: [] },
            getLatestPlan: () => null, getStorageHydrationStatus: () => ({ state: "ready" }),
            getCurrentDateTimeString: () => "2026-10-06 12:00:00", commitLocalMutation() {},
            async persistChanges() {}, async flushMutationOutbox() {},
            async updateRecord(table, record) { this.state[table] = [record]; },
            formatVND: (value) => String(value || ""), formatCurrency: (value) => String(value || ""),
            formatDate: (value) => value, formatForDatetimeLocal: (value) => value, formatForDateInput: (value) => value,
            parseVND: (value) => Number(String(value).replace(/\D/gu, "")),
            convertDMYHMSToYMDHMS: () => "2026-10-06 12:00:00", convertDMYToYMD: () => "2026-10-06",
          };
          const controller = { model, async autoSync() { return failure; } };
          const view = { model, _currentWorkflowPackageId: "pkg", _inPlaceEditMode: true, _editingState: { qualified: true, opening_fin: true },
            initFlatpickr() {}, createIconsScoped() {}, focusInvalidControl() {},
            showToast(...args) { alerts.push(args); }, async customAlert(...args) { alerts.push(args); },
            async showPackageDetails(...args) { renders.push(args); } };
          const contentWrapper = document.getElementById("detail-workflow-content-wrapper");
          if (kind === "financial") {
            renderFinancialOpeningPanel(view, { contentWrapper, pkg, appController: controller });
            contentWrapper.querySelector("#op-fin-thoigianmothau").value = "06/10/2026 12:00";
            contentWrapper.querySelector(".op-gia-du-thau").value = "1000";
          } else if (kind === "qualified") {
            renderQualifiedApprovalPanel(view, { contentWrapper, pkg, isTechEvalSaved: true, appController: controller });
            for (const [id, value] of [["qualified-so-qd", "ENTERED-DECISION"], ["qualified-ngay-qd", "06/10/2026"]]) {
              const input = contentWrapper.querySelector(`#${id}`); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
            }
          } else {
            renderPreparationDetailsPanel(view, { contentWrapper, gt: pkg, id: pkg.id, isEditable: true, appController: controller });
            contentWrapper.querySelector("#ip-soquyetdinh").value = "ENTERED-DECISION";
          }
          const button = contentWrapper.querySelector(kind === "financial" ? "#btn-save-opening-fin" : kind === "qualified" ? "#btn-save-qualified-decision" : "#btn-save-inplace");
          let rejected;
          try { await button.onclick(); } catch (error) { rejected = error.message; }
          return { kind, alerts, renders, rejected, draft: view._qualifiedApprovalDraft, editMode: view._inPlaceEditMode,
            editing: view._editingState, entered: contentWrapper.querySelector("#ip-soquyetdinh, #qualified-so-qd, .op-gia-du-thau")?.value };
        }, { kind, failure });
        assert.equal(result.rejected, undefined, `${kind} handles the result`);
        assert.equal(result.alerts.some(([title]) => title === "Thành công"), false, `${kind} ${JSON.stringify(failure)}`);
        if (!failure.conflict) {
          assert.equal(result.renders.length, 0, `${kind} keeps its editor`);
          assert.ok(result.entered);
          if (kind === "qualified") assert.equal(result.draft.values.soQdPheDuyetKt, "ENTERED-DECISION");
        } else if (kind === "qualified") {
          assert.equal(result.draft.values.soQdPheDuyetKt, "ENTERED-DECISION", "conflict input is retained as a retry-only draft");
        }
      }
    }
  });
});
