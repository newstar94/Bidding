import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("secure build preserves reviewed code splitting and obfuscates every chunk", () => {
  const config = fs.readFileSync("vite.config.js", "utf8");
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.match(config, /input:\s*\{\s*app:\s*appEntry\s*\}/s);
  assert.match(config, /codeSplitting:\s*(?:true|\{[\s\S]*?groups:\s*\[)/);
  assert.match(config, /singleBundleStylesPlugin\(\)/);
  assert.match(config, /JavaScriptObfuscator\.obfuscate\(/);
  assert.match(config, /deadCodeInjection:\s*true/);
  assert.match(config, /deadCodeInjectionThreshold:\s*0\.02/);
  assert.equal(packageJson.devDependencies["javascript-obfuscator"], "5.4.3");
  assert.match(packageJson.scripts["build:secure"], /check_secure_build_artifacts\.mjs/);
});

test("secure build emits private release-keyed symbols without publishing source maps", () => {
  const config = fs.readFileSync("vite.config.js", "utf8");
  const verifier = fs.readFileSync("scripts/check_secure_build_artifacts.mjs", "utf8");
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

  assert.equal(packageJson.devDependencies["source-map-js"], "1.2.1");
  assert.match(config, /sourcemap:\s*mode === ['"]secure['"] \? ['"]hidden['"] : false/u);
  assert.match(config, /sourceMap:\s*true/u);
  assert.match(config, /getSourceMap\(\)/u);
  assert.match(config, /private-symbols\//u);
  assert.match(verifier, /verify_symbolication\.mjs/u);
  assert.match(verifier, /\.map/u);
  assert.match(workflow, /name:\s*Upload private client symbols/u);
  const productionUpload = workflow.slice(workflow.indexOf("- name: Upload production artifact"));
  const productionPaths = productionUpload.slice(0, productionUpload.indexOf("retention-days: 14"));
  assert.doesNotMatch(productionPaths, /private-symbols/u);
});
