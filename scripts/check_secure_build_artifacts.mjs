import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { verifySymbolArchive } from "./verify_symbolication.mjs";

const projectRoot = process.cwd();
const distRoot = path.resolve(projectRoot, "dist");
const markerPath = path.join(distRoot, "secure-build.json");
const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));

assert.ok(Number(marker.version) >= 6, "Secure marker must include private symbol metadata.");
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
  assert.doesNotMatch(
    code,
    /data:text\/javascript(?:;|,)/i,
    `${transformed.file} embeds a worker script that CSP would reject.`,
  );
}

const assetNames = fs.readdirSync(path.join(distRoot, "assets"));
const excelWorkerAsset = assetNames.find((name) => /^excelParseWorker-[A-Za-z0-9_-]+\.js$/.test(name));
assert.ok(excelWorkerAsset, "Secure build must emit the Excel parser worker as a same-origin asset.");
const excelWorkerSource = fs.readFileSync(path.join(distRoot, "assets", excelWorkerAsset), "utf8");
assert.match(excelWorkerSource, /importScripts\(/, "Excel worker asset lost its vendored parser import.");
assert.match(excelWorkerSource, /trustedTypes/, "Excel worker asset must enforce its TrustedScriptURL policy.");

const emittedFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap(
  (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? emittedFiles(candidate) : [candidate];
  },
);
for (const emittedFile of emittedFiles(distRoot)) {
  assert.notEqual(path.extname(emittedFile), ".map", `Public build contains a source map: ${emittedFile}`);
}
assert.doesNotMatch(
  fs.readFileSync(markerPath, "utf8"),
  /sourcesContent|(?:frontend|views)\//u,
  "Public secure marker exposes private source metadata.",
);

const symbolication = verifySymbolArchive({ projectRoot, marker });

console.log(
  `Secure build verification passed (${marker.transformedFiles.length} obfuscated bundles; `
  + `private symbolication ${symbolication.smoke.source}:${symbolication.smoke.line}).`,
);
