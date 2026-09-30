import { readFile } from "node:fs/promises";
import process from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// These skips represent environments that are intentionally opt-in in the
// current E2E matrix.  Any newly skipped test must carry an explicit reason
// and be added deliberately rather than silently reducing release coverage.
export const DEFAULT_ALLOWED_SKIP_DESCRIPTIONS = Object.freeze([
  "Requires the isolated violation fixture provider.",
  "Requires the approved fixture-backed legacy procurement import environment.",
  "CDP touch input is available in the Chromium project",
]);

function flattenSuites(suites, rows = []) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const annotations = [
          ...(test.annotations || []),
          ...results.flatMap((result) => result.annotations || []),
        ];
        const skipped = test.expectedStatus === "skipped"
          || test.status === "skipped"
          || results.some((result) => result.status === "skipped");
        const executed = results.some((result) => result.status !== "skipped" && result.workerIndex >= 0);
        rows.push({
          file: spec.file || suite.file || "unknown",
          title: spec.title || "unknown",
          skipped,
          executed,
          status: test.status || results.at(-1)?.status || "unknown",
          annotations,
        });
      }
    }
    flattenSuites(suite.suites, rows);
  }
  return rows;
}

function matchesAllowedSkip(annotation, allowedDescriptions) {
  const description = String(annotation?.description || "");
  return allowedDescriptions.some((allowed) => description === allowed || description.includes(allowed));
}

export function verifyPlaywrightResults(report, {
  minExecuted = 2,
  requiredExecutedSpecs = ["admin-shell.spec.mjs", "specialist-create.spec.mjs"],
  allowedSkipDescriptions = DEFAULT_ALLOWED_SKIP_DESCRIPTIONS,
} = {}) {
  const tests = flattenSuites(report?.suites);
  const skipped = tests.filter((test) => test.skipped);
  const unexpectedSkips = skipped.filter((test) => !test.annotations.some(
    (annotation) => matchesAllowedSkip(annotation, allowedSkipDescriptions),
  ));
  const executed = tests.filter((test) => test.executed);
  const missingRequired = requiredExecutedSpecs.filter((required) => (
    !executed.some((test) => path.basename(test.file) === required)
  ));
  const failures = [];
  if (executed.length < minExecuted) {
    failures.push(`executed=${executed.length} is below minimum ${minExecuted}`);
  }
  if (missingRequired.length) {
    failures.push(`required specs did not execute: ${missingRequired.join(", ")}`);
  }
  if (unexpectedSkips.length) {
    failures.push(`unexpected skips: ${unexpectedSkips.map((test) => `${test.file}: ${test.title}`).join("; ")}`);
  }
  if ((report?.stats?.unexpected || 0) > 0) {
    failures.push(`Playwright reported ${report.stats.unexpected} unexpected result(s)`);
  }
  if (failures.length) {
    throw new Error(`Playwright execution evidence failed: ${failures.join("; ")}`);
  }
  return {
    status: "PASS",
    totalTests: tests.length,
    executedTests: executed.length,
    allowedSkippedTests: skipped.length,
    unexpectedSkippedTests: 0,
    requiredExecutedSpecs,
  };
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const reportPath = path.resolve(argument("results") || "test-results/e2e-results.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const minExecuted = Number(argument("min-executed") || process.env.PLAYWRIGHT_MIN_EXECUTED || 2);
  const requiredExecutedSpecs = String(
    argument("required-specs") || process.env.PLAYWRIGHT_REQUIRED_EXECUTED_SPECS
      || "admin-shell.spec.mjs,specialist-create.spec.mjs",
  ).split(",").map((value) => value.trim()).filter(Boolean);
  const result = verifyPlaywrightResults(report, { minExecuted, requiredExecutedSpecs });
  process.stdout.write(`${JSON.stringify({ ...result, reportPath }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "FAIL", error: error.message })}\n`);
    process.exitCode = 1;
  });
}
