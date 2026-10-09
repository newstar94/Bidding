import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const expectedReleaseId = "a".repeat(64);

for (const [releaseId, shouldPass] of [["unknown", false], ["b".repeat(64), false], [expectedReleaseId, true]]) {
  test(`startup release gate ${shouldPass ? "accepts matching artifact" : `rejects ${releaseId.slice(0, 7)}`}`, async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "bidding-startup-gate-"));
    const output = path.join(temporary, "metrics.json");
    const server = createServer((request, response) => {
      if (request.url === "/api/auth/login") {
        response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><html><body>Ready<script>window.__BIDDINGFLOW_RELEASE__=${JSON.stringify(releaseId)};performance.mark("bf:admin-shell:ready");performance.mark("bf:admin-route:ready");performance.mark("bf:loader:hidden");</script></body></html>`);
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    try {
      const child = spawn(process.execPath, ["scripts/measure_startup.mjs", "--assert"], {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        env: { ...process.env, E2E_BASE_URL: `http://127.0.0.1:${server.address().port}`,
          E2E_PASSWORD: "fixture-password", STARTUP_COLD_RUNS: "1", STARTUP_WARM_RUNS: "1",
          // This fixture isolates release identity; it is not a performance measurement.
          STARTUP_LONG_TASK_MS: "10000",
          STARTUP_METRICS_OUTPUT: output, STARTUP_BLOCKED_URLS: "", STARTUP_BROWSER_CHANNEL: "",
          STARTUP_EXPECTED_RELEASE_ID: expectedReleaseId },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let diagnostics = "";
      child.stderr.on("data", (chunk) => { diagnostics += chunk; });
      const code = await new Promise((done, reject) => {
        child.once("error", reject); child.once("close", done);
      });
      const report = JSON.parse(await readFile(output, "utf8"));
      const samples = [...report.cold.samples, ...report.warm.samples];
      assert.deepEqual(samples.flatMap((sample) => sample.runtimeFailures), [], diagnostics);
      assert.ok(report.cold.p95Ms <= report.thresholds.coldP95LimitMs, JSON.stringify(report.cold));
      assert.ok(report.warm.p95Ms <= report.thresholds.warmP95LimitMs, JSON.stringify(report.warm));
      assert.equal(report.passed, shouldPass, JSON.stringify({ releaseIds: report.releaseIds,
        cold: report.cold.longestTaskMs, warm: report.warm.longestTaskMs, thresholds: report.thresholds, diagnostics }));
      assert.equal(code, shouldPass ? 0 : 1, diagnostics);
    } finally {
      server.closeAllConnections(); await new Promise((done) => server.close(done));
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
