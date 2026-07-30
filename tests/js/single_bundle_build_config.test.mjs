import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("secure build obfuscates one minified entry and injects dead code", () => {
  const config = fs.readFileSync("vite.config.js", "utf8");
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.match(config, /input:\s*\{\s*app:\s*appEntry\s*\}/s);
  assert.match(config, /codeSplitting:\s*false/);
  assert.match(config, /singleBundleStylesPlugin\(\)/);
  assert.match(config, /JavaScriptObfuscator\.obfuscate\(/);
  assert.match(config, /deadCodeInjection:\s*true/);
  assert.match(config, /deadCodeInjectionThreshold:\s*0\.02/);
  assert.equal(packageJson.devDependencies["javascript-obfuscator"], "5.4.3");
  assert.match(packageJson.scripts["build:secure"], /check_secure_build_artifacts\.mjs/);
});
