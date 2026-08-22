import { spawnSync } from "node:child_process";

const requiredSpecs = [
  "contractor-violation.spec.mjs",
  "procurement-plan-import.spec.mjs",
];
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config=playwright.config.mjs",
    "--project=chromium",
    "--list",
  ],
  { cwd: process.cwd(), encoding: "utf8", env: process.env },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "Playwright discovery failed.\n");
  process.exit(result.status || 1);
}
const output = `${result.stdout}\n${result.stderr}`;
const missing = requiredSpecs.filter((spec) => !output.includes(spec));
if (missing.length) {
  process.stderr.write(`PLAYWRIGHT_REQUIRED_SPEC_MISSING: ${missing.join(", ")}\n`);
  process.exit(1);
}
process.stdout.write(`Playwright required specs discovered: ${requiredSpecs.join(", ")}\n`);
