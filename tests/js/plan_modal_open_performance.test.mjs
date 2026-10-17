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
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "application/octet-stream";
}

test("plan modal paints early and refreshes a paginated record before editing", async (t) => {
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
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const requestedModules = [];
    page.on("request", (request) => {
      if (request.url().includes("/frontend/")) requestedModules.push(request.url());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      globalThis.lucide = { createIcons() {} };
      const { importPlanEditorWorkflows } = await import("/frontend/app/WorkflowModuleLoader.js");
      const { editKeHoach } = await importPlanEditorWorkflows();
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
    for (const moduleName of [
      "BidEvaluationWorkflow.js", "DetailedEvaluationWorkflow.js", "GoiThauWorkflow.js",
      "PlanImportWizard.js", "NoticeImportWizard.js", "OpeningImportWizard.js",
      "ProcurementInlineLookup.js",
    ]) {
      assert.equal(
        requestedModules.some((url) => url.endsWith(`/${moduleName}`)),
        false,
        `opening the manual plan editor must not fetch ${moduleName}`,
      );
    }
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

    const lookupResult = await page.evaluate(async () => {
      const { editKeHoach } = await import("/frontend/plans/KeHoachWorkflow.js");
      const { updateServerCapabilitiesFromSession } = await import(
        "/frontend/auth/serverCapabilities.js"
      );
      updateServerCapabilitiesFromSession({
        valid: true,
        user: { id: "user-1" },
        serverCapabilities: ["procurement-lookup-v1"],
      });
      const scenarios = [];
      for (const { staleReason, trigger } of [
        ...["checkbox", "change", "blur"].map((trigger) => ({ staleReason: null, trigger })),
        ...["workspace", "storage", "code", "binding", "checkbox", "flow", "closed", "removed"]
          .map((staleReason) => ({ staleReason, trigger: "checkbox" })),
      ]) {
        let workspaceToken = "user:org-a@1";
        let finishImport;
        let imports = 0;
        const lookups = [];
        const controller = {
          model: {
            state: { activetab: "kehoach", activeaction: null, kehoach: [] },
            db: {},
            workspaceStorage: {},
            workspaceScope: { key: "user:org-a" },
            getWorkspaceToken: () => workspaceToken,
            getLatestChuDauTu: () => [],
          },
          procurementPlanImport: null,
          switchTab() {},
          makeSearchableSelect() {},
          ensureBiddingWorkflows() {
            imports += 1;
            return new Promise((resolve) => { finishImport = resolve; });
          },
          runProcurementInlineLookup(options) {
            lookups.push({ receiverPreserved: this === controller, options });
            return { found: true };
          },
          view: {
            openModal(id) { document.getElementById(id).classList.add("active"); },
          },
        };
        await editKeHoach.call(controller, null);
        const importsBeforeAction = imports;
        const codeInput = document.getElementById("kh-ma");
        const checkbox = document.getElementById("procurement-lookup-plan-enabled");
        const modal = document.getElementById("modal-kehoach");
        codeInput.value = "PL2600000001";
        checkbox.checked = true;
        const startedAt = performance.now();
        if (trigger === "checkbox") checkbox.dispatchEvent(new Event("change"));
        else codeInput.dispatchEvent(new Event(trigger));
        const loading = document.getElementById("procurement-lookup-plan-loading");
        const loadingImmediately = !loading.hidden;
        const busyImmediately = document.getElementById("form-kehoach").getAttribute("aria-busy");
        const loadingCode = loading.querySelector("[data-procurement-loading-code]").textContent;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const loadingAtPaint = !loading.hidden && loading.getBoundingClientRect().height > 0
          && getComputedStyle(loading).visibility !== "hidden"
          && getComputedStyle(loading).display !== "none";
        const paintOpportunityMs = performance.now() - startedAt;
        const lookupsBeforeImport = lookups.length;
        if (staleReason === "workspace") workspaceToken = "user:org-b@2";
        if (staleReason === "storage") controller.model.workspaceStorage = {};
        if (staleReason === "code") codeInput.value = "PL2600000002";
        if (staleReason === "binding") codeInput.__bfProcurementAutoLookupCleanup();
        if (staleReason === "checkbox") checkbox.checked = false;
        if (staleReason === "flow") controller.procurementPlanImport = {};
        if (staleReason === "closed") modal.classList.remove("active");
        if (staleReason === "removed") modal.remove();
        finishImport();
        await new Promise((resolve) => setTimeout(resolve, 0));
        scenarios.push({
          staleReason, trigger, importsBeforeAction, imports, lookupsBeforeImport, lookups,
          loadingImmediately, loadingAtPaint, paintOpportunityMs,
          busyImmediately, loadingCode,
          loadingAfterCompletion: !loading.hidden,
        });
        if (staleReason === "removed") document.body.appendChild(modal);
      }
      return scenarios;
    });
    t.diagnostic(JSON.stringify(lookupResult.filter((scenario) => !scenario.staleReason).map(
      ({ trigger, loadingImmediately, loadingAtPaint, paintOpportunityMs }) => ({
        trigger, loadingImmediately, loadingAtPaint, paintOpportunityMs,
      }),
    )));
    for (const scenario of lookupResult) {
      assert.equal(scenario.loadingImmediately, true, `${scenario.trigger}: loading before workflow import`);
      assert.equal(scenario.loadingAtPaint, true, `${scenario.trigger}: visible before workflow import`);
      assert.equal(scenario.busyImmediately, "true");
      assert.equal(scenario.loadingCode, "PL2600000001");
      assert.equal(scenario.loadingAfterCompletion, false, `${scenario.staleReason}: loading cleanup`);
      assert.equal(scenario.importsBeforeAction, 0);
      assert.equal(scenario.imports, 1);
      assert.equal(scenario.lookupsBeforeImport, 0);
      if (scenario.staleReason) {
        assert.deepEqual(scenario.lookups, [], scenario.staleReason);
      } else {
        assert.deepEqual(scenario.lookups, [{
          receiverPreserved: true,
          options: {
            kind: "PLAN",
            formId: "form-kehoach",
            codeInputId: "kh-ma",
            triggerId: "procurement-lookup-plan-enabled",
            statusId: "procurement-lookup-plan-status",
          },
        }]);
      }
    }

    const handoffResults = await page.evaluate(async () => {
      const { editKeHoach } = await import("/frontend/plans/KeHoachWorkflow.js");
      const { ProcurementInlineLookup } = await import("/frontend/procurement/ProcurementInlineLookup.js");
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
      const results = [];
      for (const mode of ["handoff", "invalid", "superseded", "rebound"]) {
        const imports = [];
        let failRequest;
        let requests = 0;
        const controller = {
          model: {
            state: { activetab: "kehoach", activeaction: null, kehoach: [] },
            db: {}, workspaceStorage: {}, workspaceScope: { key: "user:org-a" },
            getWorkspaceToken: () => "user:org-a@1",
            getLatestChuDauTu: () => [],
          },
          procurementPlanImport: null,
          switchTab() {}, makeSearchableSelect() {},
          ensureBiddingWorkflows() {
            return new Promise((resolve) => imports.push(resolve));
          },
          runProcurementInlineLookup(options) { return inlineLookup.run(options); },
          view: { openModal(id) { document.getElementById(id).classList.add("active"); } },
        };
        const inlineLookup = new ProcurementInlineLookup({
          controller,
          importClient: {
            preparePlan() {
              requests += 1;
              return new Promise((resolve, reject) => { failRequest = reject; });
            },
          },
        });
        await editKeHoach.call(controller, null);
        const input = document.getElementById("kh-ma");
        const checkbox = document.getElementById("procurement-lookup-plan-enabled");
        const loading = document.getElementById("procurement-lookup-plan-loading");
        const form = document.getElementById("form-kehoach");
        const snapshot = () => ({
          visible: !loading.hidden, busy: form.getAttribute("aria-busy"),
          disabled: checkbox.disabled,
          code: loading.querySelector("[data-procurement-loading-code]").textContent,
          requests,
        });
        // No lookup/loading for empty codes or an unchecked automatic option.
        input.value = "PL2600000001";
        input.dispatchEvent(new Event("change"));
        input.value = "";
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change"));
        const idle = { ...snapshot(), imports: imports.length };
        input.value = mode === "invalid" ? "PL123" : "PL2600000001";
        input.dispatchEvent(new Event("change"));
        const beforeImport = snapshot();
        let afterOldImport = null;
        let afterRebind = null;
        if (mode === "superseded" || mode === "rebound") {
          if (mode === "rebound") {
            await editKeHoach.call(controller, null);
            afterRebind = snapshot();
            checkbox.checked = true;
          }
          input.value = "PL2600000002-01";
          input.dispatchEvent(new Event("change"));
          imports[0]();
          await tick();
          afterOldImport = snapshot();
        }
        imports.at(-1)();
        await tick();
        const duringRequest = snapshot();
        failRequest?.(new Error("lookup request failed"));
        await tick();
        const status = document.getElementById("procurement-lookup-plan-status");
        results.push({ mode, idle, beforeImport, afterOldImport, afterRebind, duringRequest,
          afterRequest: snapshot(), statusState: status.dataset.state });
      }
      return results;
    });
    for (const result of handoffResults) {
      assert.equal(result.idle.imports, 0, result.mode);
      assert.equal(result.idle.visible, false, result.mode);
      assert.equal(result.beforeImport.visible, result.mode !== "invalid", result.mode);
      if (result.afterRebind) {
        assert.equal(result.afterRebind.visible, false);
        assert.equal(result.afterRebind.busy, null);
      }
      if (result.afterOldImport) {
        assert.equal(result.afterOldImport.visible, true, "old completion must not hide new loading");
        assert.equal(result.afterOldImport.busy, "true");
        assert.equal(result.afterOldImport.code, "PL2600000002-01");
        assert.equal(result.afterOldImport.requests, 0);
      }
      assert.equal(result.duringRequest.visible, result.mode !== "invalid", result.mode);
      assert.equal(result.duringRequest.disabled, result.mode !== "invalid", result.mode);
      assert.equal(result.duringRequest.requests, result.mode === "invalid" ? 0 : 1, result.mode);
      assert.equal(result.afterRequest.visible, false, result.mode);
      assert.equal(result.afterRequest.busy, null, result.mode);
      assert.equal(result.afterRequest.disabled, false, result.mode);
      assert.equal(result.statusState, "error", result.mode);
    }

    const loadFailureResult = await page.evaluate(async () => {
      const { editKeHoach } = await import("/frontend/plans/KeHoachWorkflow.js");
      const unhandled = [];
      const captureUnhandled = (event) => unhandled.push(String(event.reason?.message || event.reason));
      window.addEventListener("unhandledrejection", captureUnhandled);
      const scenarios = [];
      try {
        for (const staleWorkspace of [false, true]) {
          let workspaceToken = "user:org-a@1";
          let finishImport;
          let failImport;
          let imports = 0;
          let lookups = 0;
          const controller = {
            model: {
              state: { activetab: "kehoach", activeaction: null, kehoach: [] },
              db: {},
              workspaceStorage: {},
              workspaceScope: { key: "user:org-a" },
              getWorkspaceToken: () => workspaceToken,
              getLatestChuDauTu: () => [],
            },
            procurementPlanImport: null,
            switchTab() {},
            makeSearchableSelect() {},
            ensureBiddingWorkflows() {
              imports += 1;
              return new Promise((resolve, reject) => {
                finishImport = resolve;
                failImport = reject;
              });
            },
            runProcurementInlineLookup() {
              lookups += 1;
              return { found: true };
            },
            view: {
              openModal(id) { document.getElementById(id).classList.add("active"); },
            },
          };
          await editKeHoach.call(controller, null);
          const codeInput = document.getElementById("kh-ma");
          const checkbox = document.getElementById("procurement-lookup-plan-enabled");
          const status = document.getElementById("procurement-lookup-plan-status");
          codeInput.value = "PL2600000001";
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event("change"));
          if (staleWorkspace) {
            workspaceToken = "user:org-b@2";
            status.hidden = false;
            status.textContent = "Trạng thái thuộc tổ chức mới";
            status.dataset.state = "loading";
            status.setAttribute("aria-live", "polite");
          }
          failImport(new Error("temporary workflow chunk failure"));
          await new Promise((resolve) => setTimeout(resolve, 0));
          const afterFailure = {
            loadingHidden: document.getElementById("procurement-lookup-plan-loading").hidden,
            formBusy: document.getElementById("form-kehoach").getAttribute("aria-busy"),
            hidden: status.hidden,
            text: status.textContent,
            state: status.dataset.state,
            live: status.getAttribute("aria-live"),
            imports,
            lookups,
          };
          if (!staleWorkspace) {
            // An explicit retry of the same code is allowed after load failure.
            codeInput.dispatchEvent(new Event("change"));
            finishImport();
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          scenarios.push({ staleWorkspace, afterFailure, imports, lookups });
        }
        return { scenarios, unhandled };
      } finally {
        window.removeEventListener("unhandledrejection", captureUnhandled);
      }
    });
    assert.deepEqual(loadFailureResult.unhandled, []);
    const [currentFailure, staleFailure] = loadFailureResult.scenarios;
    assert.equal(currentFailure.afterFailure.hidden, false);
    assert.equal(currentFailure.afterFailure.loadingHidden, true);
    assert.equal(currentFailure.afterFailure.formBusy, null);
    assert.match(currentFailure.afterFailure.text, /Vui lòng thử lại/u);
    assert.equal(currentFailure.afterFailure.state, "error");
    assert.equal(currentFailure.afterFailure.live, "assertive");
    assert.equal(currentFailure.afterFailure.lookups, 0);
    assert.equal(currentFailure.imports, 2);
    assert.equal(currentFailure.lookups, 1);
    assert.deepEqual(staleFailure.afterFailure, {
      loadingHidden: true,
      formBusy: null,
      hidden: false,
      text: "Trạng thái thuộc tổ chức mới",
      state: "loading",
      live: "polite",
      imports: 1,
      lookups: 0,
    });
    assert.equal(staleFailure.lookups, 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
