import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { exportContractWordInBackground } from "../../frontend/contracts/ContractWordExport.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  if (extname(pathname) === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

test("contract Word export uses the package background job and the shared loading surface", async () => {
  const loadingOptions = [];
  const loadingUpdates = [];
  const jobRequests = [];
  let loadingClosed = 0;
  const result = await exportContractWordInBackground({
    packageId: "package/a",
    contractNumber: "HĐ-01/2026",
    prepareExportSnapshot: async () => 77,
  }, {
    beginLoading: async (options) => {
      loadingOptions.push(options);
      return {
        update: async (stage, message) => loadingUpdates.push({ stage, message }),
        close: async () => { loadingClosed += 1; },
      };
    },
    runJob: async (request) => {
      jobRequests.push(request);
      await request.onProgress("download", "Đang tải hợp đồng.");
      return { jobId: "job-contract", status: "completed" };
    },
  });

  assert.deepEqual(loadingOptions, [{ detail: "Hợp đồng: HĐ-01/2026" }]);
  assert.equal(loadingClosed, 1);
  assert.deepEqual(loadingUpdates.map((item) => item.stage), ["render", "download"]);
  assert.equal(jobRequests.length, 1);
  assert.equal(
    jobRequests[0].createJobUrl,
    "/api/document-jobs/package-report/package%2Fa?type=contract&snapshotVersion=77",
  );
  assert.equal(jobRequests[0].filename, "Hop_dong_HĐ-01/2026.docx");
  assert.deepEqual(result, { jobId: "job-contract", status: "completed" });
});

test("contract Word export restores loading and preserves the existing job failure message", async () => {
  let loadingClosed = 0;
  await assert.rejects(
    exportContractWordInBackground({
      packageId: "package-a",
      contractNumber: "",
      prepareExportSnapshot: async () => 8,
    }, {
      beginLoading: async () => ({
        update: async () => {},
        close: async () => { loadingClosed += 1; },
      }),
      runJob: async () => {
        throw new Error("DOCUMENT_JOB_FAILED");
      },
    }),
    /Không thể xuất hợp đồng/u,
  );
  assert.equal(loadingClosed, 1);
});

test("contract Word export preserves the backend job error code", async () => {
  const sourceError = new Error("Nguồn dữ liệu đã thay đổi");
  sourceError.code = "DOCUMENT_EXPORT_SOURCE_CHANGED";
  await assert.rejects(
    exportContractWordInBackground({
      packageId: "package-a",
      prepareExportSnapshot: async () => 8,
    }, {
      beginLoading: async () => ({ update: async () => {}, close: async () => {} }),
      runJob: async () => { throw sourceError; },
    }),
    (error) => error.code === "DOCUMENT_EXPORT_SOURCE_CHANGED"
      && error.cause === sourceError,
  );
});

test("contract command keeps entitlement gating and no longer calls the synchronous Word route", async () => {
  const source = await readFile("frontend/app/BiddingController.js", "utf8");
  assert.match(source, /activeuser\?\.wordExportEnabled/u);
  assert.match(source, /exportContractWordInBackground/u);
  assert.doesNotMatch(source, /`\/api\/export-report\/\$\{dbId\}\?type=contract`/u);
  assert.match(source, /"Lỗi xuất hợp đồng"/u);
});

test("contract command shows the application loading surface until its job download finishes", async () => {
  const createRequests = [];
  const serverErrors = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head>
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/components.css">
        </head><body><button id="export-contract" type="button">Xuất hợp đồng</button></body></html>`);
        return;
      }
      if (
        request.method === "POST"
        && url.pathname === "/api/document-jobs/package-report/package-a"
      ) {
        createRequests.push(request.url);
        response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          jobId: "job-contract",
          status: "pending",
          statusUrl: "/api/document-jobs/job-contract",
          downloadUrl: "/api/document-jobs/job-contract/download",
        }));
        return;
      }
      if (url.pathname === "/api/document-jobs/job-contract") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          jobId: "job-contract",
          status: "completed",
          downloadUrl: "/api/document-jobs/job-contract/download",
        }));
        return;
      }
      if (url.pathname === "/api/document-jobs/job-contract/download") {
        response.writeHead(200, {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        response.end(Buffer.from("PK\u0003\u0004contract-word-test"));
        return;
      }
      const payload = await readFile(join(projectRoot, url.pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": contentType(url.pathname) });
      response.end(payload);
    } catch (error) {
      serverErrors.push({ url: request.url, message: String(error?.message || error) });
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  let context;
  const browserErrors = [];
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("requestfailed", (request) => {
      browserErrors.push(`${request.url()}: ${request.failure()?.errorText || "failed"}`);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    try {
      await page.evaluate(async () => {
        document.cookie = "csrf_token=contract-word-test; path=/";
        globalThis.lucide = { createIcons() {} };
        const { BiddingController } = await import("/frontend/app/BiddingController.js");
        const alerts = [];
        const controller = new BiddingController({
          state: { activeuser: { wordExportEnabled: true } },
        }, {
          customAlert: async (...args) => alerts.push(args),
        });
        controller.prepareExportSnapshot = async () => 91;
        controller.registerCommands();
        globalThis.__contractController = controller;
        globalThis.__contractAlerts = alerts;
      });
    } catch (error) {
      throw new Error(
        `${error.message}; server=${JSON.stringify(serverErrors)}; browser=${JSON.stringify(browserErrors)}`,
      );
    }
    const download = page.waitForEvent("download");
    await page.evaluate(() => {
      globalThis.__contractExport = globalThis.__contractController.executeCommand(
        "exportContractFromHopDong",
        "package-a",
        "HĐ-01",
        document.getElementById("export-contract"),
      );
    });

    const loading = page.locator("#app-long-task-loading");
    await loading.waitFor({ state: "visible" });
    assert.equal(await loading.getAttribute("data-task"), "word-publication");
    assert.equal(await page.locator("#export-contract").isDisabled(), true);
    assert.equal((await download).suggestedFilename(), "Hop_dong_HĐ-01.docx");
    await page.evaluate(() => globalThis.__contractExport);
    await loading.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#export-contract").isEnabled(), true);
    assert.equal(await page.locator("#export-contract").textContent(), "Xuất hợp đồng");
    assert.deepEqual(await page.evaluate(() => globalThis.__contractAlerts), []);
    assert.equal(createRequests.length, 1);
    const createUrl = new URL(createRequests[0], "http://127.0.0.1");
    assert.equal(createUrl.searchParams.get("type"), "contract");
    assert.equal(createUrl.searchParams.get("snapshotVersion"), "91");
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
