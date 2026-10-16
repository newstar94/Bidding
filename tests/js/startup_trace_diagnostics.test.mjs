import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { chromium } from "@playwright/test";
import { installStartupLongTaskObserver, flushStartupLongTasks } from "../../scripts/startup_long_task_observer.mjs";
import { startStartupScriptTrace, startupScriptsFromTrace } from "../../scripts/startup_script_trace.mjs";

test("startup snapshot drains queued Long Tasks after the readiness task ends", async () => {
  let deliver;
  const pending = [];
  const state = {
    MessageChannel,
    PerformanceObserver: class {
      constructor(callback) { this.callback = callback; }
      observe({ type }) {
        this.type = type;
        if (type === "longtask") deliver = this.callback;
      }
      takeRecords() { return this.type === "longtask" ? pending.splice(0) : []; }
    },
  };
  runInNewContext(`(${installStartupLongTaskObserver.toString()})()`, state);
  const entry = { startTime: 7, duration: 180, attribution: [] };
  const snapshot = runInNewContext(`(${flushStartupLongTasks.toString()})()`, state);
  // Readiness is visible while its enclosing task is still finishing. The
  // native observer has not delivered its callback when the entry is queued.
  pending.push(entry);
  assert.equal(state.__bfStartupLongTasks.length, 0);
  await snapshot;
  assert.equal(state.__bfStartupLongTasks.length, 1);
  assert.equal(state.__bfStartupLongTasks[0].duration, 180);
  deliver({ getEntries: () => pending.splice(0) });
  await runInNewContext(`(${flushStartupLongTasks.toString()})()`, state);
  assert.equal(state.__bfStartupLongTasks.length, 1, "draining must not duplicate observer entries");
});

test("startup snapshot uses script timing when native Long Tasks omit cold bootstrap", async () => {
  const pending = {
    longtask: [],
    "long-animation-frame": [{
      scripts: [{ startTime: 7, duration: 180 }],
    }],
  };
  const state = {
    MessageChannel,
    PerformanceObserver: class {
      observe({ type }) { this.type = type; }
      takeRecords() { return pending[this.type]?.splice(0) || []; }
    },
  };

  runInNewContext(`(${installStartupLongTaskObserver.toString()})()`, state);
  await runInNewContext(`(${flushStartupLongTasks.toString()})()`, state);

  assert.equal(state.__bfStartupLongTasks.length, 1);
  assert.equal(state.__bfStartupLongTasks[0].startTime, 7);
  assert.equal(state.__bfStartupLongTasks[0].duration, 180);
});

test("startup snapshot waits for the rendering frame that publishes cold script timings", async () => {
  const pending = [];
  const state = {
    MessageChannel,
    requestAnimationFrame: (callback) => setImmediate(() => {
      pending.push({ scripts: [{ startTime: 7, duration: 180 }] });
      callback(190);
    }),
    PerformanceObserver: class {
      observe({ type }) { this.type = type; }
      takeRecords() { return this.type === "long-animation-frame" ? pending.splice(0) : []; }
    },
  };
  runInNewContext(`(${installStartupLongTaskObserver.toString()})()`, state);
  await runInNewContext(`(${flushStartupLongTasks.toString()})()`, state);
  assert.equal(state.__bfStartupLongTasks.length, 1);
  assert.equal(state.__bfStartupLongTasks[0].duration, 180);
});

test("cold browser bootstrap remains measurable when both observer sources omit entries", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><html><body>Ready<script>
      const deadline=performance.now()+180;while(performance.now()<deadline){}
      performance.mark("bf:loader:hidden");
    </script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext();
      try {
        await context.addInitScript({ content: `
          globalThis.PerformanceObserver = class extends PerformanceObserver {
            observe() {}
          };
          (${installStartupLongTaskObserver.toString()})();
        ` });
        const page = await context.newPage();
        const stopTrace = await startStartupScriptTrace(page);
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(flushStartupLongTasks);
        const tasks = await page.evaluate(() => globalThis.__bfStartupLongTasks);
        assert.deepEqual(tasks, [], "the regression must exercise missing observer entries");
        const cutoff = await page.evaluate(() => performance.getEntriesByName("bf:loader:hidden")[0].startTime);
        const scriptTasks = startupScriptsFromTrace(await stopTrace(), cutoff);
        assert.ok(scriptTasks.some(task => task.duration > 100), JSON.stringify(scriptTasks));
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("startup trace fallback preserves cutoff, main thread and individual script durations", () => {
  const script = (ts, dur, extra = {}) => ({ name: "EvaluateScript", ph: "X", pid: 1, tid: 2, ts, dur, ...extra });
  const tasks = startupScriptsFromTrace({ traceEvents: [
    script(100_000, 180_000), script(290_000, 60_000), script(360_000, 60_000),
    script(450_000, 180_000),
    script(510_000, 900_000), script(10_000, 999_000, { tid: 3 }),
    { name: "bf:loader:hidden", pid: 1, tid: 2, ts: 500_000 },
  ] }, 450);
  assert.deepEqual(tasks.map(({ startTime, duration }) => ({ startTime, duration })), [
    { startTime: 50, duration: 180 }, { startTime: 240, duration: 60 }, { startTime: 310, duration: 60 },
    { startTime: 400, duration: 180 },
  ]);
  assert.throws(() => startupScriptsFromTrace({ traceEvents: [] }, 450), /missing the loader cutoff/u);
});

for (const enabled of [false, true]) {
test(`startup diagnostic trace files ${enabled ? "capture blocking bootstrap" : "stay disabled by default"} without hiding the failed gate`, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bidding-startup-trace-"));
  const output = path.join(temporary, "metrics.json");
  const traces = path.join(temporary, "traces");
  const releaseId = "a".repeat(64);
  const server = createServer((request, response) => {
    if (request.url === "/api/auth/login") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}"); return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><html><body>Ready<script>
      window.__BIDDINGFLOW_RELEASE__=${JSON.stringify(releaseId)};
      const deadline=performance.now()+180;while(performance.now()<deadline){}
      performance.mark("bf:app-module-start");
      performance.mark("bf:admin-shell:ready");performance.mark("bf:admin-route:ready");
      performance.mark("bf:loader:hidden");
    </script></body></html>`);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    const child = spawn(process.execPath, ["scripts/measure_startup.mjs", "--assert"], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, E2E_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        E2E_PASSWORD: "fixture-password", STARTUP_COLD_RUNS: "1", STARTUP_WARM_RUNS: "1",
        STARTUP_COLD_P95_MS: "10000", STARTUP_WARM_P95_MS: "10000",
        STARTUP_LONG_TASK_MS: "100", STARTUP_TRACE_DIR: enabled ? traces : "",
        STARTUP_METRICS_OUTPUT: output, STARTUP_BLOCKED_URLS: "", STARTUP_BROWSER_CHANNEL: "",
        STARTUP_EXPECTED_RELEASE_ID: releaseId },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let diagnostics = "";
    child.stderr.on("data", (chunk) => { diagnostics += chunk; });
    const code = await new Promise((done, reject) => {
      child.once("error", reject); child.once("close", done);
    });
    const report = JSON.parse(await readFile(output, "utf8"));
    // Keep the native observation and trace evidence in CI's test log even
    // when this temporary fixture directory is removed after an assertion.
    let traceEvidence = null;
    if (enabled) {
      const trace = JSON.parse(await readFile(path.join(traces, "cold-1.json"), "utf8"));
      traceEvidence = trace.traceEvents
        .filter(event => event.name === "EvaluateScript" && event.dur > 100_000)
        .map(event => ({ durationUs: event.dur, timestampUs: event.ts,
          url: event.args?.data?.url || "" })).slice(0, 5);
    }
    const taskDiagnostics = JSON.stringify({ cold: report.cold.samples.map(sample => ({
      loaderHiddenMs: sample.loaderHiddenMs, longestTaskMs: sample.longestTaskMs, longTasks: sample.longTasks,
    })), warm: report.warm.samples.map(sample => ({
      loaderHiddenMs: sample.loaderHiddenMs, longestTaskMs: sample.longestTaskMs, longTasks: sample.longTasks,
    })), traceEvidence });
    assert.equal(code, 1, diagnostics);
    assert.equal(report.passed, false);
    assert.equal(report.diagnosticTracing, enabled);
    assert.equal(report.scriptTimingTracing, true);
    assert.equal(report.thresholds.longTaskLimitMs, 100);
    assert.ok(report.cold.longestTaskMs > 100, taskDiagnostics);
    for (const sample of [...report.cold.samples, ...report.warm.samples]) {
      assert.ok(sample.longestTaskMs > 100, `${sample.mode} must include the completed blocking task: ${taskDiagnostics}`);
    }
    assert.equal(report.cold.samples[0].longTasks[0].phase, "document-bootstrap");
    assert.deepEqual(report.cold.samples[0].runtimeFailures, []);
    if (!enabled) {
      await assert.rejects(access(traces), { code: "ENOENT" });
      return;
    }
    assert.deepEqual((await readdir(traces)).sort(), ["cold-1.json", "warm-1.json", "warmup-0.json"]);
    const trace = JSON.parse(await readFile(path.join(traces, "cold-1.json"), "utf8"));
    assert.ok(trace.traceEvents.some((event) => event.name === "EvaluateScript" && event.dur > 100_000),
      "the diagnostic trace must identify the script that blocks bootstrap");
    assert.ok(trace.traceEvents.some((event) => event.name === "bf:app-module-start"),
      "startup marks must align the blocking task with the application phases");
    assert.deepEqual(report.cold.samples[0].runtimeFailures, []);
  } finally {
    server.closeAllConnections(); await new Promise((done) => server.close(done));
    await rm(temporary, { recursive: true, force: true });
  }
});
}
