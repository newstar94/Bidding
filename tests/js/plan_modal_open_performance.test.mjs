import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".html") return "text/html; charset=utf-8";
  return "application/octet-stream";
}

test("plan modal paints early and refreshes a paginated record before editing", async () => {
  const modalMarkup = await readFile(
    join(projectRoot, "views/modals/modal_kehoach.html"),
    "utf8",
  );
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head>
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/views.css">
          <link rel="stylesheet" href="/views/css/ui-redesign.css">
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
        </head><body>${modalMarkup}</body></html>`);
        return;
      }
      const payload = await readFile(join(projectRoot, pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      globalThis.lucide = { createIcons() {} };
      const { editKeHoach } = await import("/frontend/plans/KeHoachWorkflow.js");
      let painted = false;
      let openedAt = null;
      let selectStartedAt = null;
      let selectSawPaint = null;
      document.getElementById("procurement-lookup-plan-enabled").checked = true;
      const state = { activetab: "kehoach", activeaction: null, kehoach: [] };
      const controller = {
        model: {
          state,
          db: {},
          workspaceStorage: {},
          workspaceScope: { key: "user:org-a" },
          getWorkspaceToken: () => "user:org-a@1",
          getLatestChuDauTu: () => Array.from({ length: 4_000 }, (_, index) => ({
            id: `investor-${index}`,
            maChuDauTu: `CDT-${index}`,
            tenChuDauTu: `Chủ đầu tư ${index}`,
          })),
        },
        procurementPlanImport: null,
        switchTab() {},
        makeSearchableSelect() {
          selectStartedAt = performance.now();
          selectSawPaint = painted;
          const end = performance.now() + 80;
          while (performance.now() < end) {
            // Deliberately model the synchronous cost of a large searchable select.
          }
        },
        view: {
          openModal(id) {
            document.getElementById(id).classList.add("active");
            openedAt = performance.now();
            requestAnimationFrame(() => requestAnimationFrame(() => { painted = true; }));
          },
        },
      };

      await editKeHoach.call(controller, null, {
        preserveProcurementLookupSelection: true,
      });
      return {
        openedAt,
        selectStartedAt,
        selectSawPaint,
        lookupSelectionPreserved: document.getElementById(
          "procurement-lookup-plan-enabled",
        ).checked,
      };
    });

    assert.equal(result.selectSawPaint, true);
    assert.ok(result.openedAt < result.selectStartedAt);
    assert.equal(result.lookupSelectionPreserved, true);
    assert.equal(
      await page.locator(".plan-basis-editor-section").evaluate((section) => (
        section.parentElement?.classList.contains("modal-body")
      )),
      true,
    );
    assert.equal(await page.locator(".plan-basis-editor-empty").count(), 1);
    await page.locator("#btn-add-plan-basis").click();
    assert.equal(await page.locator(".plan-basis-editor-row").count(), 1);
    assert.equal(await page.locator(".plan-basis-editor-empty").count(), 0);

    const editResult = await page.evaluate(async () => {
      const { editKeHoach } = await import("/frontend/plans/KeHoachWorkflow.js");
      const modal = document.getElementById("modal-kehoach");
      modal.classList.remove("active");
      const state = { activetab: "kehoach", activeaction: null, kehoach: [] };
      const authoritativePlan = {
        id: "plan-from-page",
        maKeHoach: "KH-2026",
        tenKeHoach: "Kế hoạch từ trang phân trang",
        canCuLapKeHoachList: [{ id: "basis-1", noiDungGoc: "Căn cứ thử nghiệm" }],
      };
      let lookupCalls = 0;
      let lookupTable = null;
      let lookupId = null;
      const controller = {
        model: {
          state,
          db: {},
          workspaceStorage: {},
          workspaceScope: { key: "user:org-a" },
          entityIndexes: { invalidate() {} },
          getWorkspaceToken: () => "user:org-a@1",
          getLatestChuDauTu: () => [],
          getPlanBaseCode: (value) => value,
          formatVND: (value) => String(value || ""),
          formatForDateInput: (value) => value || "",
          formatForDatetimeLocal: (value) => value || "",
        },
        procurementPlanImport: null,
        async fetchRecordByLookup(table, id) {
          lookupCalls += 1;
          lookupTable = table;
          lookupId = id;
          return authoritativePlan;
        },
        switchTab() {},
        makeSearchableSelect() {},
        view: {
          openModal(id) {
            document.getElementById(id).classList.add("active");
          },
        },
      };

      await editKeHoach.call(controller, authoritativePlan.id);
      return {
        lookupCalls,
        lookupTable,
        lookupId,
        storedPlanId: state.kehoach[0]?.id || null,
        modalActive: modal.classList.contains("active"),
        renderedBases: document.querySelectorAll(".plan-basis-editor-row").length,
      };
    });
    assert.deepEqual(editResult, {
      lookupCalls: 1,
      lookupTable: "kehoach",
      lookupId: "plan-from-page",
      storedPlanId: "plan-from-page",
      modalActive: true,
      renderedBases: 1,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator(".plan-basis-editor-row").boundingBox();
    assert.ok(bounds);
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.equal(
      await page.locator(".plan-basis-editor-text").evaluate((textarea) => (
        textarea.classList.contains("form-control")
      )),
      true,
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
