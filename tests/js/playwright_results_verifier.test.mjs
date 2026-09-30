import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ALLOWED_SKIP_DESCRIPTIONS,
  verifyPlaywrightResults,
} from "../../scripts/verify_playwright_results.mjs";

function reportFor(tests, unexpected = 0) {
  return {
    stats: { unexpected },
    suites: [{
      file: "fixture.spec.mjs",
      specs: tests.map((entry) => ({
        file: entry.file || "fixture.spec.mjs",
        title: entry.title,
        tests: [{
          expectedStatus: entry.status === "skipped" ? "skipped" : "passed",
          status: entry.status,
          annotations: entry.annotation ? [{ type: "skip", description: entry.annotation }] : [],
          results: [{
            status: entry.status,
            workerIndex: entry.status === "skipped" ? -1 : 0,
            annotations: entry.annotation ? [{ type: "skip", description: entry.annotation }] : [],
          }],
        }],
      })),
    }],
  };
}

test("Playwright result verifier accepts the current fixture-gated skips", () => {
  const report = reportFor([
    { file: "admin-shell.spec.mjs", title: "admin", status: "passed" },
    { file: "specialist-create.spec.mjs", title: "specialist", status: "passed" },
    { title: "optional violation", status: "skipped", annotation: DEFAULT_ALLOWED_SKIP_DESCRIPTIONS[0] },
  ]);
  assert.deepEqual(verifyPlaywrightResults(report), {
    status: "PASS",
    totalTests: 3,
    executedTests: 2,
    allowedSkippedTests: 1,
    unexpectedSkippedTests: 0,
    requiredExecutedSpecs: ["admin-shell.spec.mjs", "specialist-create.spec.mjs"],
  });
});

test("Playwright result verifier rejects an unapproved skip", () => {
  const report = reportFor([
    { file: "admin-shell.spec.mjs", title: "admin", status: "passed" },
    { file: "specialist-create.spec.mjs", title: "specialist", status: "passed" },
    { title: "silently disabled", status: "skipped", annotation: "temporary workaround" },
  ]);
  assert.throws(() => verifyPlaywrightResults(report), /unexpected skips/u);
});

test("Playwright result verifier requires execution evidence and clean result stats", () => {
  const report = reportFor([
    { file: "admin-shell.spec.mjs", title: "admin", status: "passed" },
  ], 1);
  assert.throws(() => verifyPlaywrightResults(report), /below minimum|required specs|unexpected result/u);
});
