import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Excel benchmark profiles 1/5/10 MB with the production worker and long-task metrics", async () => {
  const [packageJson, source] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../scripts/benchmark_excel_parsing.mjs", import.meta.url), "utf8"),
  ]);

  assert.equal(packageJson.scripts["benchmark:excel"], "node scripts/benchmark_excel_parsing.mjs");
  assert.match(source, /TARGET_MEGABYTES\s*=\s*Object\.freeze\(\[1, 5, 10\]\)/);
  assert.match(source, /frontend[\\/]documents[\\/]excelParseWorker\.js/);
  assert.match(source, /PerformanceObserver/);
  assert.match(source, /longestTaskMs/);
  assert.match(source, /mainThread/);
  assert.match(source, /worker/);
});

test("table profile compares existing rendering strategies against the shared virtual table", async () => {
  const [packageJson, source] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../scripts/profile_table_virtualization.mjs", import.meta.url), "utf8"),
  ]);

  assert.equal(
    packageJson.scripts["benchmark:tables"],
    "node scripts/profile_table_virtualization.mjs",
  );
  for (const scenario of [
    "packageGoods",
    "bidderGoods",
    "detailedEvaluation",
    "timeline",
    "contractors",
  ]) {
    assert.match(source, new RegExp(`${scenario}:`));
  }
  assert.match(source, /renderVirtualTable/);
  assert.match(source, /rowCounts:\s*\[100, 500, 1000\]/);
  assert.match(source, /longestTaskMs/);
});

test("obfuscation benchmark compares dead-code injection without weakening the secure build", async () => {
  const [packageJson, source, viteConfig] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../scripts/benchmark_obfuscation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../vite.config.js", import.meta.url), "utf8"),
  ]);

  assert.equal(
    packageJson.scripts["benchmark:obfuscation"],
    "node scripts/benchmark_obfuscation.mjs",
  );
  assert.match(source, /deadCodeInjection:\s*true/);
  assert.match(source, /deadCodeInjection:\s*false/);
  assert.match(source, /gzipBytes/);
  assert.match(source, /cold/);
  assert.match(source, /warm/);
  assert.match(source, /longestTaskMs/);
  assert.match(viteConfig, /deadCodeInjection:\s*true/);
  assert.match(viteConfig, /deadCodeInjectionThreshold:\s*0\.02/);
});
