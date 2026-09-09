import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import {
  commitEvaluationLotScopeChange,
} from "../../frontend/packages/BidEvaluationWorkflow.js";
import {
  reconcileEvaluationLotScopeControls,
} from "../../frontend/packages/bidEvaluationActions.js";
import {
  finalizeEvaluationLotBatch,
} from "../../frontend/packages/lotEvaluationScope.js";
import {
  selectSingleEvaluationLot,
} from "../../scripts/lib/evaluationLotScopeSynchronization.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if (extname(pathname) === ".js" || extname(pathname) === ".mjs") {
    return "text/javascript; charset=utf-8";
  }
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

async function createLotScopeBrowserFixture() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html><head><link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css"></head><body>
          <section id="danhgiahsdt-scope-container">
            <label><input type="radio" name="danhgiahsdt-scope-mode" value="all">Tất cả</label>
            <label><input type="radio" name="danhgiahsdt-scope-mode" value="selected">Theo phần lô</label>
          </section>
          <div id="danhgiahsdt-lot-actions"><button id="danhgiahsdt-select-all-lots"></button><button id="danhgiahsdt-clear-all-lots"></button></div>
          <div id="danhgiahsdt-lot-options"></div>
          <p id="danhgiahsdt-scope-feedback"></p>
          <h3 id="danhgiahsdt-table-title"></h3>
          <button id="btn-danhgiahsdt-download-excel"></button>
          <button id="btn-danhgiahsdt-import-excel"></button>
          <table><tbody id="danhgiahsdt-table-tbody"></tbody></table>
          <script type="module">
            import { commitEvaluationLotScopeChange } from "/frontend/packages/BidEvaluationWorkflow.js";
            import { renderBidEvaluationLotScope } from "/frontend/packages/BidEvaluationLotScopeController.js";
            import { filterBidsByEvaluationLotScope } from "/frontend/packages/lotEvaluationScope.js";

            const pkg = {
              id: "package-1",
              phanLo: "Có",
              phanLoList: [
                { id: "lot-1", maPhanLo: "PP01", tenPhanLo: "Phần 1" },
                { id: "lot-2", maPhanLo: "PP02", tenPhanLo: "Phần 2" },
              ],
            };
            const bids = [
              { id: "bid-1", lotId: "lot-1", maPhanLo: "PP01" },
              { id: "bid-2", lotId: "lot-2", maPhanLo: "PP02" },
            ];
            const controller = {};
            const scopeKey = "package-1:technical";
            const scopeStore = {
              [scopeKey]: {
                mode: "all",
                selectedLotIds: ["lot-1", "lot-2"],
                availableLotIds: ["lot-1", "lot-2"],
                batchId: null,
              },
            };
            const view = { getActiveElement: (id) => document.getElementById(id) };
            const render = () => {
              const scope = scopeStore[scopeKey];
              renderBidEvaluationLotScope({
                view,
                pkg,
                scope,
                onChange: (nextScope) => commitEvaluationLotScopeChange({
                  controller,
                  scopeStore,
                  scopeKey,
                  nextScope,
                  rerender: render,
                }),
              });
              document.getElementById("danhgiahsdt-table-tbody").innerHTML = filterBidsByEvaluationLotScope(bids, pkg, scope)
                .map((bid) => '<tr data-bid-id="' + bid.id + '"><td>' + bid.maPhanLo + '</td></tr>')
                .join("");
            };
            render();
            window.__lotScopeReady = true;
          </script>
        </body></html>`);
        return;
      }
      const filePath = resolve(projectRoot, `.${pathname}`);
      if (!filePath.startsWith(projectRoot)) throw new Error("Invalid fixture path");
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(await readFile(filePath));
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message);
    }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}


test("lot scope controls commit state before a deferred coalesced rerender", () => {
  const controller = {};
  const scopeStore = {};
  const scheduled = [];
  const events = [];
  const nextScope = {
    mode: "selected",
    selectedLotIds: ["lot-1"],
    availableLotIds: ["lot-1", "lot-2"],
    batchId: null,
  };
  const arguments_ = {
    controller,
    scopeStore,
    scopeKey: "package-1:unified",
    nextScope,
    syncNavigation: () => events.push("navigation"),
    rerender: () => events.push("render"),
    schedule: (callback) => scheduled.push(callback),
  };

  commitEvaluationLotScopeChange(arguments_);
  commitEvaluationLotScopeChange(arguments_);

  assert.equal(scopeStore["package-1:unified"], nextScope);
  assert.equal(controller._explicitEvaluationLotScopes["package-1:unified"], nextScope);
  assert.deepEqual(events, ["navigation", "navigation"]);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.deepEqual(events, ["navigation", "navigation", "render"]);
});


test("a synchronous scheduler cannot replace lot controls inside their change event", async () => {
  const controller = {};
  const scopeStore = {};
  const events = [];
  const nextScope = {
    mode: "selected",
    selectedLotIds: ["lot-1"],
    availableLotIds: ["lot-1", "lot-2"],
    batchId: null,
  };

  commitEvaluationLotScopeChange({
    controller,
    scopeStore,
    scopeKey: "package-1:technical",
    nextScope,
    syncNavigation: () => events.push("navigation"),
    rerender: () => events.push("render"),
    schedule: (callback) => callback(),
  });

  assert.equal(scopeStore["package-1:technical"], nextScope);
  assert.deepEqual(events, ["navigation"]);
  await Promise.resolve();
  assert.deepEqual(events, ["navigation"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["navigation", "render"]);
});


test("browser lot selection waits for the selected-mode projection before narrowing to one lot", async () => {
  const fixture = await createLotScopeBrowserFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const browserErrors = [];
    page.on("console", (message) => browserErrors.push(`[console:${message.type()}] ${message.text()}`));
    page.on("pageerror", (error) => browserErrors.push(`[pageerror] ${error.message}`));
    await page.goto(fixture.url);
    await page.waitForFunction(() => window.__lotScopeReady === true, null, { timeout: 5_000 })
      .catch((error) => {
        throw new Error(`Lot scope fixture failed: ${browserErrors.join(" | ")}`, { cause: error });
      });

    await selectSingleEvaluationLot({ page, lotCode: "PP01" });

    const state = await page.evaluate(() => ({
      selectedLots: [...document.querySelectorAll(
        "#danhgiahsdt-lot-options [data-evaluation-lot-id]:checked",
      )].map((item) => item.getAttribute("data-evaluation-lot-code")),
      rows: [...document.querySelectorAll("#danhgiahsdt-table-tbody tr[data-bid-id]")]
        .map((item) => item.textContent.trim()),
    }));
    assert.deepEqual(state, { selectedLots: ["PP01"], rows: ["PP01"] });
  } finally {
    await browser.close();
    await new Promise((resolveClose) => fixture.server.close(resolveClose));
  }
});


test("save reconciles the visible lot selection when a deferred render left stale scope state", () => {
  const checked = [{ getAttribute: () => "lot-1" }];
  const elements = {
    "danhgiahsdt-scope-container": {
      querySelector: () => ({ checked: true }),
    },
    "danhgiahsdt-lot-options": {
      querySelectorAll: () => checked,
    },
  };
  const scope = reconcileEvaluationLotScopeControls(
    { getActiveElement: (id) => elements[id] },
    {
      phanLo: "Có",
      phanLoList: [
        { id: "lot-1", maPhanLo: "L1" },
        { id: "lot-2", maPhanLo: "L2" },
      ],
    },
    {
      mode: "all",
      selectedLotIds: ["lot-1", "lot-2"],
      availableLotIds: ["lot-1", "lot-2"],
      batchId: null,
    },
  );

  assert.equal(scope.mode, "selected");
  assert.deepEqual(scope.selectedLotIds, ["lot-1"]);
});


test("lot finalize sends a stable idempotency key bound to expected package version", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ success: true, packageRowVersion: 8 }),
    };
  };
  const command = {
    packageId: "package-1",
    batchId: "batch-1",
    outcomes: { "lot-1": "AWARDED" },
    packageAward: {
      expectedVersion: 7,
      decisionNumber: "QD-01",
      decisionDate: "2026-08-09",
      metadata: {},
      lotResults: [{ lotId: "lot-1", winnerId: "bidder-1", awardPrice: 10 }],
    },
    fetcher,
  };

  await finalizeEvaluationLotBatch(command);
  await finalizeEvaluationLotBatch(command);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["Idempotency-Key"], "lot-finalize:v7");
  assert.equal(
    calls[1].options.headers["Idempotency-Key"],
    calls[0].options.headers["Idempotency-Key"],
  );
});
