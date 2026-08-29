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

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  if (extname(pathname) === ".json") return "application/json; charset=utf-8";
  return "text/html; charset=utf-8";
}

async function closeServer(server) {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

test("timeline renders exact authorized cached packages in the plan change event turn", async () => {
  let paginateRequests = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(TIMELINE_TEST_SHELL);
        return;
      }
      if (url.pathname === "/api/paginate") {
        paginateRequests += 1;
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "cache miss" }));
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
    const result = await page.evaluate(async () => {
      const [{ renderPackageTimeline }, { getCachedPaginatedRecords }, { paginatedProjectionStore }] = (
        await Promise.all([
          import("/frontend/packages/PackageTimelineView.js"),
          import("/frontend/shared/tableDataUtils.js"),
          import("/frontend/shared/PaginatedProjectionStore.js"),
        ])
      );
      const model = {
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
          }],
          goithau: [],
        },
        workspaceScope: { key: "user-a:org-a", organizationId: "org-a" },
      };
      const query = {
        page: 1,
        pageSize: 200,
        search: "",
        keHoachId: "plan-a",
      };
      paginatedProjectionStore(model).setValue("goithau", query, {
        items: [{
          id: "package-cached",
          rootId: "package-cached-root",
          phienBan: "00",
          isLatest: 1,
          keHoachId: "plan-a",
          maGoiThau: "GT-CACHED",
          tenGoiThau: "Gói thầu đã được authorize và cache",
          referenceOnly: false,
        }],
        totalItems: 1,
        hasMore: false,
        nextCursor: null,
        fetchedAt: Date.now(),
        prefetched: true,
      });
      const cachedBeforeRender = getCachedPaginatedRecords(model, "goithau", query);
      const view = {
        model,
        createIconsScoped() {},
        initFlatpickr() {},
        showToast() {},
      };
      renderPackageTimeline.call(view);
      const planSelect = document.getElementById("timeline-plan-select");
      planSelect.value = "plan-a";
      planSelect.dispatchEvent(new Event("change", { bubbles: true }));
      const immediateOptions = Array.from(
        document.getElementById("timeline-package-select").options,
      ).map((option) => option.value);
      return {
        cachedIds: cachedBeforeRender?.items?.map((item) => item.id) || [],
        immediateOptions,
      };
    });

    assert.deepEqual(result.cachedIds, ["package-cached"], "the exact scoped cache must be primed");
    assert.deepEqual(
      result.immediateOptions,
      ["", "package-cached"],
      "choosing a plan must expose its cached package options in the same event turn",
    );
    assert.equal(paginateRequests, 0, "a fresh exact-query cache hit must not wait for the API");
  } finally {
    await browser?.close();
    await closeServer(server);
  }
});
