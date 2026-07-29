import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("secure build emits one minified entry without treating obfuscation as security", () => {
  const config = fs.readFileSync("vite.config.js", "utf8");
  assert.match(config, /input:\s*\{\s*app:\s*appEntry\s*\}/s);
  assert.match(config, /codeSplitting:\s*false/);
  assert.match(config, /singleBundleStylesPlugin\(\)/);
  assert.match(config, /secureBuildMarkerPlugin\(/);
  assert.doesNotMatch(config, /javascript-obfuscator|obfuscatorPlugin/);
});
