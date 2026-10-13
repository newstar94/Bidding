import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

for (const enabled of [false, true]) {
test(`startup tracing ${enabled ? "captures blocking bootstrap" : "stays disabled by default"} without hiding the failed gate`, async () => {
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
    assert.equal(code, 1, diagnostics);
    assert.equal(report.passed, false);
    assert.equal(report.diagnosticTracing, enabled);
    assert.equal(report.thresholds.longTaskLimitMs, 100);
    assert.ok(report.cold.longestTaskMs > 100);
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
