import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as readiness from "../../scripts/startup_readiness_metrics.mjs";

// Exercise the script's real verdict with captured sample shapes; no browser or
// timing fixture is needed to prove a redirected/unfinished route cannot pass.
const source = await readFile(new URL("../../scripts/measure_startup.mjs", import.meta.url), "utf8");
const verdict = source.match(/result\.passed =[\s\S]*?;\r?\n/u)?.[0];
assert.ok(verdict, "The startup verdict must remain available to the gate regression");

function gateFor(sample, requestedPathname = "/admin") {
  const result = { cold: { p95Ms: 50, longestTaskMs: 0 }, warm: { p95Ms: 30, longestTaskMs: 0 } };
  const releaseId = "a".repeat(64);
  vm.runInNewContext(verdict, {
    ...readiness, result, requestedPathname,
    coldP95LimitMs: 2100, warmP95LimitMs: 450, longTaskLimitMs: 100,
    releaseIds: [releaseId], expectedReleaseId: releaseId,
    coldSamples: [sample], warmSamples: [sample],
  });
  return result.passed;
}

const adminReady = {
  pathname: "/admin", adminShellReadyMs: 10, adminRouteReadyMs: 40,
  workspaceReconciliationApplicable: false, runtimeFailures: [],
};

test("startup gate accepts the completed requested admin route", () => {
  assert.equal(gateFor(adminReady), true);
});

for (const mark of ["adminShellReadyMs", "adminRouteReadyMs"]) {
  test(`startup gate rejects admin when ${mark} is missing`, () => {
    assert.equal(gateFor({ ...adminReady, [mark]: null }), false);
  });
}

test("a matching release on a redirected shell cannot satisfy the admin gate", () => {
  assert.equal(gateFor({ ...adminReady, pathname: "/tong-quan" }), false);
});

test("a custom workspace route does not require admin marks", () => {
  assert.equal(gateFor({ ...adminReady, pathname: "/tong-quan",
    adminShellReadyMs: null, adminRouteReadyMs: null }, "/tong-quan"), true);
});

test("a custom route also rejects a redirect to a ready admin shell", () => {
  assert.equal(gateFor(adminReady, "/tong-quan"), false);
});

test("an unknown actual pathname cannot pass startup readiness", () => {
  assert.equal(gateFor({ ...adminReady, pathname: undefined }), false);
});
