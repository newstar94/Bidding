import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const TIMELINE_TEST_SHELL = `<!doctype html><html><head>
  <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
</head><body>
  <section id="tab-goithau-timeline">
    <select id="timeline-plan-select"><option value="">Chọn kế hoạch</option></select>
    <select id="timeline-package-select" disabled><option value="">Chọn kế hoạch trước</option></select>
    <select id="timeline-status-filter"><option value="">Tất cả</option></select>
    <div id="timeline-empty"></div>
    <div id="timeline-loading" hidden></div>
    <div id="timeline-error" hidden></div>
    <div id="timeline-table-wrap" hidden><table><tbody id="timeline-table-body"></tbody></table></div>
    <button id="timeline-save"></button>
    <button id="timeline-refresh-auto"></button>
    <button id="timeline-export-excel"></button>
    <button id="timeline-copy-previous"></button>
    <p id="timeline-live-status"></p>
  </section>
</body></html>`;

test("timeline preserves the selected plan snapshot and all E-HSMT revisions", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      response.setHeader("content-type", contentType(pathname));
      response.end(pathname === "/" ? TIMELINE_TEST_SHELL
        : await readFile(join(projectRoot, pathname.replace(/^\//u, ""))));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const { renderPackageTimeline } = await import("/frontend/packages/PackageTimelineView.js");
      const plans = [2, 3].map((n) => ({ id: `plan-${n}`, rootId: "plan-root",
        phienBan: n, isLatest: 1, pheDuyet: "Kế hoạch", maKeHoach: "PL2600029845" }));
      const original = { id: "z-current", rootId: "package-root", phienBan: 0,
        isLatest: 1, keHoachId: "plan-3", maGoiThau: "IB2600079201",
        hinhThucLuaChon: "OPEN_BIDDING", phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
        timelineItems: [], referenceOnly: false, soQuyetDinh: "42/QĐ-CLCB",
        ngayQuyetDinh: "2026-03-06", thoiGianMoThau: "2026-03-24T08:30:00+07:00" };
      const old = { ...original, id: "a-old", keHoachId: "plan-2", thoiGianMoThau: null };
      const view = { model: { getWorkspaceToken: () => "test", useServerSidePagination: false,
        workspaceSessionStorage: { readJson: () => ({ planId: "plan-3", packageId: original.id }),
          writeJson() {}, removeItem() {} },
        state: { kehoach: plans, goithau: [old, original], hopdong: [], activeuser: {} } },
        createIconsScoped() {}, initFlatpickr() {}, showToast() {} };
      globalThis.timelineSnapshotView = view;
      globalThis.timelineSnapshotRender = renderPackageTimeline;
      renderPackageTimeline.call(view);
    });
    await page.waitForFunction(() => globalThis.timelineSnapshotView._packageTimelineState?.package
      && !globalThis.timelineSnapshotView._packageTimelineState.restoringSelection);
    assert.deepEqual(await page.evaluate(() => {
      const state = globalThis.timelineSnapshotView._packageTimelineState;
      const row = state.rows.find((item) => item.milestoneKey === "BID_OPENING_MINUTES");
      return [state.package.id, state.plan.id, row.ngayThucTe, row.trangThai];
    }), ["z-current", "plan-3", "2026-03-24", "DONE"]);

    // New package revisions still contribute the original decision and every adjustment.
    await page.evaluate(() => {
      const view = globalThis.timelineSnapshotView;
      const original = view.model.state.goithau.find((pkg) => pkg.id === "z-current");
      view.model.state.goithau.push(...[1, 2].map((n) => ({ ...original, id: `revision-${n}`,
        phienBan: n, soQuyetDinh: `DC-${n}`, ngayQuyetDinh: `2026-03-${10 + n}` })));
      view._packageTimelineState = null;
      view.model.workspaceSessionStorage.readJson = () => ({ planId: "plan-3", packageId: "revision-2" });
      globalThis.timelineSnapshotRender.call(view);
    });
    await page.waitForFunction(() => globalThis.timelineSnapshotView._packageTimelineState?.package?.id === "revision-2"
      && !globalThis.timelineSnapshotView._packageTimelineState.restoringSelection);
    assert.deepEqual(await page.evaluate(() => {
      const state = globalThis.timelineSnapshotView._packageTimelineState;
      return state.displayRows.filter((row) => ["E_HSMT_APPROVAL", "E_HSMT_ADJUSTMENT_APPROVAL"].includes(row.milestoneKey))
        .map((row) => row.soVanBan);
    }), ["42/QĐ-CLCB", "DC-2"]);
    assert.deepEqual(await page.evaluate(() => globalThis.timelineSnapshotView._packageTimelineState
      .dateHistoryByMilestone.E_HSMT_ADJUSTMENT_APPROVAL.map((date) => date.value)),
    ["2026-03-11", "2026-03-12"]);
  } finally {
    await browser?.close();
    await closeServer(server);
  }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  if (extname(pathname) === ".json") return "application/json; charset=utf-8";
  return "text/html; charset=utf-8";
}

function writeJson(response, payload, statusCode = 200) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function closeServer(server) {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function packageRecord(suffix) {
  return {
    id: `package-${suffix}`,
    rootId: `package-${suffix}-root`,
    phienBan: "00",
    isLatest: 1,
    keHoachId: `plan-${suffix}`,
    maGoiThau: `GT-${suffix.toUpperCase()}`,
    tenGoiThau: `Gói thầu ${suffix.toUpperCase()}`,
    trangThai: "PREPARING",
    hinhThucLuaChon: "OPEN_BIDDING",
    referenceOnly: false,
    timelineItems: [],
  };
}

async function exercisePersistedRestoreRace(nextPlanId) {
  const restoreOptionsStarted = deferred();
  const releaseRestoreOptions = deferred();
  const restoredPackage = packageRecord("a");
  const nextPackage = packageRecord("b");
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(TIMELINE_TEST_SHELL);
        return;
      }
      if (url.pathname === "/api/record") {
        if (url.searchParams.get("table") === "goithau") {
          writeJson(response, { item: restoredPackage });
          return;
        }
        writeJson(response, { item: null });
        return;
      }
      if (url.pathname === "/api/paginate") {
        const planId = url.searchParams.get("keHoachId");
        if (planId === "plan-a") {
          restoreOptionsStarted.resolve();
          await releaseRestoreOptions.promise;
          writeJson(response, {
            items: [restoredPackage],
            totalItems: 1,
            hasMore: false,
            nextCursor: null,
          });
          return;
        }
        writeJson(response, {
          items: planId === "plan-b" ? [nextPackage] : [],
          totalItems: planId === "plan-b" ? 1 : 0,
          hasMore: false,
          nextCursor: null,
        });
        return;
      }
      const filePath = join(projectRoot, url.pathname.replace(/^\//u, ""));
      const payload = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(url.pathname) });
      response.end(payload);
    } catch (error) {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end(String(error?.message || "Not Found"));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      globalThis.__timelineUnhandledRejections = [];
      globalThis.addEventListener("unhandledrejection", (event) => {
        globalThis.__timelineUnhandledRejections.push(
          String(event.reason?.message || event.reason || "Unhandled rejection"),
        );
      });
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(async () => {
      const { renderPackageTimeline } = await import(
        "/frontend/packages/PackageTimelineView.js"
      );
      let storedSelection = { planId: "plan-a", packageId: "package-a" };
      const plans = ["a", "b"].map((suffix) => ({
        id: `plan-${suffix}`,
        rootId: `plan-${suffix}-root`,
        phienBan: "00",
        isLatest: 1,
        maKeHoach: `KH-${suffix.toUpperCase()}`,
        tenKeHoach: `Kế hoạch ${suffix.toUpperCase()}`,
        pheDuyet: { soQuyetDinh: `QD-${suffix.toUpperCase()}` },
      }));
      const view = {
        model: {
          getWorkspaceToken: () => "user-a:org-a@1",
          normalizeRecordKeys: (record) => record,
          useServerSidePagination: true,
          workspaceSessionStorage: {
            readJson: (_key, fallback) => storedSelection || fallback,
            writeJson: (_key, value) => { storedSelection = value; },
            removeItem: () => { storedSelection = null; },
          },
          state: {
            activerole: "manager",
            activeuser: { id: "user-a", wordExportEnabled: true },
            hopdong: [],
            kehoach: plans,
            goithau: [],
          },
          workspaceScope: { key: "user-a:org-a", organizationId: "org-a" },
        },
        createIconsScoped() {},
        initFlatpickr() {},
        showToast() {},
      };
      globalThis.__timelineRaceView = view;
      globalThis.__readTimelineStoredSelection = () => storedSelection;
      renderPackageTimeline.call(view);
    });

    await restoreOptionsStarted.promise;
    await page.evaluate((planId) => {
      const planSelect = document.getElementById("timeline-plan-select");
      planSelect.value = planId;
      planSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }, nextPlanId);

    if (nextPlanId) {
      await page.waitForFunction(() => (
        document.querySelector('#timeline-package-select option[value="package-b"]')
      ));
    }
    releaseRestoreOptions.resolve();
    await page.waitForTimeout(100);

    return {
      pageErrors,
      unhandledRejections: await page.evaluate(() => globalThis.__timelineUnhandledRejections),
      ui: await page.evaluate(() => {
        const state = globalThis.__timelineRaceView._packageTimelineState;
        const packageSelect = document.getElementById("timeline-package-select");
        return {
          planId: document.getElementById("timeline-plan-select").value,
          packageId: packageSelect.value,
          packageDisabled: packageSelect.disabled,
          packageOptionIds: Array.from(packageSelect.options).map((option) => option.value),
          tableHidden: document.getElementById("timeline-table-wrap").hidden,
          emptyHidden: document.getElementById("timeline-empty").hidden,
          statePackageId: state.package?.id || "",
          statePlanId: state.plan?.id || "",
          restoringSelection: state.restoringSelection,
          storedSelection: globalThis.__readTimelineStoredSelection(),
        };
      }),
    };
  } finally {
    releaseRestoreOptions.resolve();
    await browser?.close();
    await closeServer(server);
  }
}

test("clearing the plan cancels a pending persisted Timeline restore", async () => {
  const result = await exercisePersistedRestoreRace("");

  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.unhandledRejections, []);
  assert.deepEqual(result.ui, {
    planId: "",
    packageId: "",
    packageDisabled: true,
    packageOptionIds: [""],
    tableHidden: true,
    emptyHidden: false,
    statePackageId: "",
    statePlanId: "",
    restoringSelection: false,
    storedSelection: null,
  });
});

test("switching plans cancels a pending persisted Timeline restore", async () => {
  const result = await exercisePersistedRestoreRace("plan-b");

  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.unhandledRejections, []);
  assert.deepEqual(result.ui, {
    planId: "plan-b",
    packageId: "",
    packageDisabled: false,
    packageOptionIds: ["", "package-b"],
    tableHidden: true,
    emptyHidden: false,
    statePackageId: "",
    statePlanId: "",
    restoringSelection: false,
    storedSelection: null,
  });
});
