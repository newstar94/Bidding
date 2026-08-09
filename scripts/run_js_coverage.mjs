import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  JS_CRITICAL_COVERAGE_THRESHOLDS,
  checkJsCriticalCoverage,
} from "./check_js_critical_coverage.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = fs.readdirSync(path.join(ROOT, "tests", "js"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => `tests/js/${name}`);

const args = [
  "--test",
  "--experimental-test-coverage",
  "--test-coverage-include=frontend/**/*.js",
  "--test-coverage-lines=45",
  "--test-coverage-branches=60",
  "--test-coverage-functions=60",
  "--test-concurrency=1",
  "--test-timeout=60000",
  "--test-reporter=spec",
  "--test-reporter-destination=stdout",
];
const junitPath = String(process.env.JS_JUNIT_PATH || "").trim();
if (junitPath) {
  args.push("--test-reporter=junit", `--test-reporter-destination=${junitPath}`);
}
args.push(...testFiles);

const execution = spawnSync(process.execPath, args, {
  cwd: ROOT,
  env: process.env,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
  windowsHide: true,
});
if (execution.stdout) process.stdout.write(execution.stdout);
if (execution.stderr) process.stderr.write(execution.stderr);
if (execution.error) throw execution.error;
if (execution.status !== 0) process.exit(execution.status || 1);

const errors = checkJsCriticalCoverage(execution.stdout);
if (errors.length) {
  process.stderr.write(
    `Critical JS coverage ratchet failed:\n${errors.map((error) => `- ${error}`).join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `Critical JS coverage ratchet passed (${Object.keys(JS_CRITICAL_COVERAGE_THRESHOLDS).length} modules).\n`,
);
