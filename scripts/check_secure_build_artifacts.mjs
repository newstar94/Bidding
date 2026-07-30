import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const distRoot = path.resolve(projectRoot, "dist");
const markerPath = path.join(distRoot, "secure-build.json");
const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));

assert.equal(marker.obfuscation, true, "Secure artifact must enable JavaScript obfuscation.");
assert.equal(marker.deadCodeInjection, true, "Secure artifact must enable dead-code injection.");
assert.ok(
  Number(marker.deadCodeInjectionThreshold) > 0,
  "Secure artifact must use a positive dead-code injection threshold.",
);
assert.equal(marker.transformer, "javascript-obfuscator@5.4.3");
assert.ok(Array.isArray(marker.transformedFiles) && marker.transformedFiles.length > 0);

for (const transformed of marker.transformedFiles) {
  const artifactPath = path.resolve(distRoot, transformed.file);
  const relativePath = path.relative(distRoot, artifactPath);
  assert.ok(relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
  const code = fs.readFileSync(artifactPath, "utf8");
  const outputSha256 = createHash("sha256").update(code).digest("hex");
  assert.equal(outputSha256, transformed.outputSha256, `${transformed.file} hash does not match its marker.`);
  assert.notEqual(transformed.inputSha256, transformed.outputSha256, `${transformed.file} was not transformed.`);
  assert.equal(Buffer.byteLength(code), transformed.outputBytes);
  assert.ok(transformed.outputBytes > transformed.inputBytes, `${transformed.file} contains no measurable injected code.`);
  assert.match(code.slice(0, 4096), /_0x[0-9a-f]{4,}/i, `${transformed.file} does not look obfuscated.`);
}

console.log(`Secure build verification passed (${marker.transformedFiles.length} obfuscated bundle).`);
