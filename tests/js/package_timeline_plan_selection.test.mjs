import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

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

const TIMELINE_TEST_SHELL = `<!doctype html><html><head>
  <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
</head><body>
  <section id="tab-goithau-timeline">
    <label for="timeline-plan-select">Kế hoạch LCNT</label>
    <select id="timeline-plan-select"><option value="">Chọn kế hoạch</option></select>
    <label for="timeline-package-select">Gói thầu</label>
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

function writeJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function closeServer(server) {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

test("timeline shows authorized local packages immediately while plan options refresh", async () => {
  const requestStarted = deferred();
  const releaseRequest = deferred();
  let paginateRequest = null;
  const recordLookupRequests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(TIMELINE_TEST_SHELL);
        return;
      }
      if (url.pathname === "/api/paginate") {
        paginateRequest = Object.fromEntries(url.searchParams);
        requestStarted.resolve();
        await releaseRequest.promise;
        writeJson(response, {
          items: [{
            id: "package-authoritative",
            rootId: "package-authoritative-root",
            phienBan: "00",
            isLatest: 1,
            keHoachId: "plan-a",
            maGoiThau: "GT-AUTH",
            tenGoiThau: "Gói thầu từ máy chủ",
            trangThai: "Đang mời thầu",
          }],
          totalItems: 1,
          hasMore: false,
          nextCursor: null,
        });
        return;
      }
      if (url.pathname === "/api/record") {
        recordLookupRequests.push(Object.fromEntries(url.searchParams));
        writeJson(response, { error: "Unexpected record lookup" }, 500);
        return;
      }
      const filePath = join(projectRoot, url.pathname.replace(/^\//u, ""));
      const payload = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(url.pathname) });
      response.end(payload);
    } catch (error) {
      console.error("Timeline test server error:", request.url, error);
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const immediateOptions = await page.evaluate(async () => {
      const [timelineModule, tableDataModule] = await Promise.all([
        import("/frontend/packages/PackageTimelineView.js"),
        import("/frontend/shared/tableDataUtils.js"),
      ]);
      const { renderPackageTimeline } = timelineModule;
      const view = {
        model: {
          getWorkspaceToken: () => "user-a:org-a@1",
          normalizeRecordKeys: (record) => record,
          useServerSidePagination: true,
          state: {
            activerole: "manager",
            activeuser: { id: "user-a", wordExportEnabled: true },
            hopdong: [],
            kehoach: [{
              id: "plan-a",
              rootId: "plan-a-root",
              phienBan: "00",
              isLatest: 1,
              maKeHoach: "KH-A",
              tenKeHoach: "Kế hoạch A",
              pheDuyet: "Quyết định phê duyệt",
            }],
            goithau: [{
              id: "package-local",
              rootId: "package-local-root",
              phienBan: "00",
              isLatest: 1,
              keHoachId: "plan-a",
              maGoiThau: "GT-LOCAL",
              tenGoiThau: "Gói thầu đã có trong phiên",
              trangThai: "Đang mời thầu",
              referenceOnly: false,
              hinhThucLuaChon: "OPEN_BIDDING",
              timelineItems: [],
            }],
          },
          workspaceScope: { key: "user-a:org-a", organizationId: "org-a" },
        },
        createIconsScoped() {},
        initFlatpickr() {},
        showToast() {},
      };
      tableDataModule.reconcileTimelinePackageOptionProjection(view.model, {
        useServerSidePagination: true,
        visibilityToken: "scope-a",
        referenceData: {
          goithau: view.model.state.goithau.map((pkg) => ({
            id: pkg.id,
            rootId: pkg.rootId,
            phienBan: pkg.phienBan,
            isLatest: pkg.isLatest,
            keHoachId: pkg.keHoachId,
            maGoiThau: pkg.maGoiThau,
            tenGoiThau: pkg.tenGoiThau,
            trangThai: pkg.trangThai,
            referenceOnly: true,
          })),
        },
      });
      renderPackageTimeline.call(view);
      const planSelect = document.getElementById("timeline-plan-select");
      planSelect.value = "plan-a";
      planSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return Array.from(document.getElementById("timeline-package-select").options)
        .map((option) => option.value);
    });

    assert.deepEqual(
      immediateOptions,
      ["", "package-local"],
      "local package options must render in the same event turn as the plan change",
    );

    await requestStarted.promise;
    assert.deepEqual(paginateRequest, {
      table: "goithau",
      page: "1",
      pageSize: "200",
      search: "",
      keHoachId: "plan-a",
    });
    await page.evaluate(() => {
      const packageSelect = document.getElementById("timeline-package-select");
      packageSelect.value = "package-local";
      packageSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => (
      document.getElementById("timeline-live-status")?.textContent?.includes("Đã tải")
    ));
    assert.deepEqual(
      recordLookupRequests,
      [],
      "a complete local record confirmed by the current authorized projection must not be fetched again",
    );
    assert.deepEqual(
      await page.locator("#timeline-package-select option").evaluateAll((options) => (
        options.map((option) => ({ text: option.textContent, value: option.value }))
      )),
      [
        { text: "Chọn gói thầu", value: "" },
        { text: "GT-LOCAL — Gói thầu đã có trong phiên", value: "package-local" },
      ],
      "the package picker must not stay empty while the authoritative refresh is pending",
    );

    releaseRequest.resolve();
    await page.waitForFunction(() => (
      document.querySelector('#timeline-package-select option[value="package-authoritative"]')
    ));
    assert.deepEqual(
      await page.locator("#timeline-package-select option").evaluateAll((options) => (
        options.map((option) => option.value)
      )),
      ["", "package-authoritative"],
      "the server response remains authoritative after the immediate local render",
    );
  } finally {
    releaseRequest.resolve();
    await browser?.close();
    await closeServer(server);
  }
});

test("switching plans cancels a pending package search from the previous plan", async () => {
  const paginateRequests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(TIMELINE_TEST_SHELL);
        return;
      }
      if (url.pathname === "/api/paginate") {
        const params = Object.fromEntries(url.searchParams);
        paginateRequests.push(params);
        const suffix = params.keHoachId === "plan-b" ? "B" : "A";
        writeJson(response, {
          items: params.search ? [] : [{
            id: `package-server-${suffix.toLowerCase()}`,
            rootId: `package-server-${suffix.toLowerCase()}-root`,
            phienBan: "00",
            isLatest: 1,
            keHoachId: params.keHoachId,
            maGoiThau: `GT-${suffix}`,
            tenGoiThau: `Gói thầu máy chủ ${suffix}`,
          }],
          totalItems: params.search ? 0 : 1,
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
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(async () => {
      const [timelineModule, tableDataModule] = await Promise.all([
        import("/frontend/packages/PackageTimelineView.js"),
        import("/frontend/shared/tableDataUtils.js"),
      ]);
      const { renderPackageTimeline } = timelineModule;
      const plans = ["a", "b"].map((suffix) => ({
        id: `plan-${suffix}`,
        rootId: `plan-${suffix}-root`,
        phienBan: "00",
        isLatest: 1,
        maKeHoach: `KH-${suffix.toUpperCase()}`,
        tenKeHoach: `Kế hoạch ${suffix.toUpperCase()}`,
      }));
      const packages = ["a", "b"].map((suffix) => ({
        id: `package-local-${suffix}`,
        rootId: `package-local-${suffix}-root`,
        phienBan: "00",
        isLatest: 1,
        keHoachId: `plan-${suffix}`,
        maGoiThau: `GT-LOCAL-${suffix.toUpperCase()}`,
        tenGoiThau: `Gói thầu local ${suffix.toUpperCase()}`,
      }));
      const view = {
        model: {
          getWorkspaceToken: () => "user-a:org-a@1",
          normalizeRecordKeys: (record) => record,
          useServerSidePagination: true,
          state: {
            activerole: "manager",
            activeuser: { id: "user-a", wordExportEnabled: true },
            hopdong: [],
            kehoach: plans,
            goithau: packages,
          },
          workspaceScope: { key: "user-a:org-a", organizationId: "org-a" },
        },
        createIconsScoped() {},
        initFlatpickr() {},
        showToast() {},
      };
      tableDataModule.reconcileTimelinePackageOptionProjection(view.model, {
        useServerSidePagination: true,
        visibilityToken: "scope-a",
        referenceData: { goithau: view.model.state.goithau },
      });
      renderPackageTimeline.call(view);
      const planSelect = document.getElementById("timeline-plan-select");
      planSelect.value = "plan-a";
      planSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => (
      document.querySelector('#timeline-package-select option[value="package-server-a"]')
    ));

    const immediatePlanBOptions = await page.evaluate(() => {
      const searchInput = document.getElementById("timeline-package-select-combobox");
      searchInput.value = "old-plan-a-query";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      const planSelect = document.getElementById("timeline-plan-select");
      planSelect.value = "plan-b";
      planSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return Array.from(document.getElementById("timeline-package-select").options)
        .map((option) => option.value);
    });
    assert.deepEqual(immediatePlanBOptions, ["", "package-local-b"]);

    await page.waitForFunction(() => (
      document.querySelector('#timeline-package-select option[value="package-server-b"]')
    ));
    await page.waitForTimeout(450);
    assert.deepEqual(
      paginateRequests.filter((params) => params.keHoachId === "plan-b").map((params) => params.search),
      [""],
      "the plan-A debounce must not issue a filtered request for plan B",
    );
    assert.deepEqual(
      await page.locator("#timeline-package-select option").evaluateAll((options) => (
        options.map((option) => option.value)
      )),
      ["", "package-server-b"],
    );
  } finally {
    await browser?.close();
    await closeServer(server);
  }
});

test("package refresh preserves local options on server failure but clears them on authorization rejection", async () => {
  const serverFailureObserved = deferred();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(TIMELINE_TEST_SHELL);
        return;
      }
      if (url.pathname === "/api/paginate") {
        if (url.searchParams.get("keHoachId") === "plan-network") {
          serverFailureObserved.resolve();
          writeJson(response, { error: "Service unavailable" }, 500);
          return;
        }
        writeJson(response, { error: "Forbidden" }, 403);
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
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const immediateNetworkOptions = await page.evaluate(async () => {
      const [timelineModule, tableDataModule] = await Promise.all([
        import("/frontend/packages/PackageTimelineView.js"),
        import("/frontend/shared/tableDataUtils.js"),
      ]);
      const { renderPackageTimeline } = timelineModule;
      const plans = ["network", "forbidden"].map((suffix) => ({
        id: `plan-${suffix}`,
        rootId: `plan-${suffix}-root`,
        phienBan: "00",
        isLatest: 1,
        maKeHoach: `KH-${suffix}`,
        tenKeHoach: `Kế hoạch ${suffix}`,
      }));
      const packages = ["network", "forbidden"].map((suffix) => ({
        id: `package-local-${suffix}`,
        rootId: `package-local-${suffix}-root`,
        phienBan: "00",
        isLatest: 1,
        keHoachId: `plan-${suffix}`,
        maGoiThau: `GT-${suffix}`,
        tenGoiThau: `Gói thầu ${suffix}`,
      }));
      globalThis.__timelineToasts = [];
      const view = {
        model: {
          getWorkspaceToken: () => "user-a:org-a@1",
          normalizeRecordKeys: (record) => record,
          useServerSidePagination: true,
          state: {
            activerole: "manager",
            activeuser: { id: "user-a", wordExportEnabled: true },
            hopdong: [],
            kehoach: plans,
            goithau: packages,
          },
          workspaceScope: { key: "user-a:org-a", organizationId: "org-a" },
        },
        createIconsScoped() {},
        initFlatpickr() {},
        showToast(...args) { globalThis.__timelineToasts.push(args); },
      };
      tableDataModule.reconcileTimelinePackageOptionProjection(view.model, {
        useServerSidePagination: true,
        visibilityToken: "scope-a",
        referenceData: { goithau: view.model.state.goithau },
      });
      renderPackageTimeline.call(view);
      const planSelect = document.getElementById("timeline-plan-select");
      planSelect.value = "plan-network";
      planSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return Array.from(document.getElementById("timeline-package-select").options)
        .map((option) => option.value);
    });
    assert.deepEqual(immediateNetworkOptions, ["", "package-local-network"]);
    await serverFailureObserved.promise;
    await page.waitForFunction(() => globalThis.__timelineToasts.length === 1);
    assert.deepEqual(
      await page.locator("#timeline-package-select option").evaluateAll((options) => (
        options.map((option) => option.value)
      )),
      ["", "package-local-network"],
      "a transport failure must not discard the authorized local snapshot",
    );

    const immediateForbiddenOptions = await page.evaluate(() => {
      const planSelect = document.getElementById("timeline-plan-select");
      planSelect.value = "plan-forbidden";
      planSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return Array.from(document.getElementById("timeline-package-select").options)
        .map((option) => option.value);
    });
    assert.deepEqual(immediateForbiddenOptions, ["", "package-local-forbidden"]);
    await page.waitForFunction(() => (
      globalThis.__timelineToasts.length === 2
      && document.getElementById("timeline-package-select").options.length === 1
    ));
    assert.deepEqual(
      await page.locator("#timeline-package-select option").evaluateAll((options) => (
        options.map((option) => option.value)
      )),
      [""],
      "a final authorization rejection must remove the local package options",
    );
  } finally {
    serverFailureObserved.resolve();
    await browser?.close();
    await closeServer(server);
  }
});
