import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("a failed JS coverage ratchet preserves the complete test transcript", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "biddingflow-js-coverage-"));
  try {
    fs.mkdirSync(path.join(directory, "scripts"));
    fs.mkdirSync(path.join(directory, "tests", "js"), { recursive: true });
    fs.mkdirSync(path.join(directory, "frontend"));
    for (const filename of ["run_js_coverage.mjs", "check_js_critical_coverage.mjs"]) {
      fs.copyFileSync(path.join(ROOT, "scripts", filename), path.join(directory, "scripts", filename));
    }
    fs.writeFileSync(path.join(directory, "frontend", "sample.js"), "export const sample = 1;\n");
    fs.writeFileSync(path.join(directory, "tests", "js", "sample.test.mjs"), [
      'import test from "node:test";',
      'import { sample } from "../../frontend/sample.js";',
      'console.log("x".repeat(1024 * 1024));',
      'console.log("DIAGNOSTIC_TRANSCRIPT_END");',
      'test("sample module executes", () => { if (sample !== 1) throw new Error("unexpected sample"); });',
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(directory, "deferred-stdout.mjs"), [
      'import { Writable } from "node:stream";',
      'import { writeSync } from "node:fs";',
      'Object.defineProperty(process, "stdout", { value: new Writable({',
      '  write(chunk, _encoding, callback) {',
      '    setImmediate(() => { writeSync(1, chunk); callback(); });',
      '  },',
      '}) });',
      "",
    ].join("\n"));

    const environment = { ...process.env, JS_JUNIT_PATH: "" };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [
      "--import", pathToFileURL(path.join(directory, "deferred-stdout.mjs")).href,
      path.join(directory, "scripts", "run_js_coverage.mjs"),
    ], {
      cwd: directory,
      encoding: "utf8",
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Critical JS coverage ratchet failed:/);
    assert.match(result.stdout, /DIAGNOSTIC_TRANSCRIPT_END/);
    assert.match(result.stdout, /end of coverage report/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
