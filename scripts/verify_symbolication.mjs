import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  findSymbolicationProbe,
  symbolicateDiagnostic,
} from "./symbolicate_client_error.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const verifySymbolArchive = ({ projectRoot, marker }) => {
  const relativeArchive = String(marker?.privateSymbols?.archive || "");
  assert.match(relativeArchive, /^private-symbols\/[a-f0-9]{64}\.symbols\.json$/u);
  const releaseRoot = path.resolve(projectRoot, "release");
  const archivePath = path.resolve(releaseRoot, relativeArchive);
  const relativePath = path.relative(releaseRoot, archivePath);
  assert.ok(relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
  const content = fs.readFileSync(archivePath, "utf8");
  assert.equal(sha256(content), marker.privateSymbols.sha256);
  assert.equal(Buffer.byteLength(content), marker.privateSymbols.bytes);

  const archive = JSON.parse(content);
  assert.equal(archive.formatVersion, 1);
  assert.equal(archive.releaseId, marker.releaseId);
  assert.equal(archive.releaseIdSha256, sha256(marker.releaseId));
  assert.equal(archive.transformer, marker.transformer);
  assert.equal(archive.files.length, marker.transformedFiles.length);
  assert.equal(archive.files.length, marker.privateSymbols.files);

  const transformedByFile = new Map(
    marker.transformedFiles.map((entry) => [entry.file, entry]),
  );
  assert.equal(transformedByFile.size, marker.transformedFiles.length);
  const archivedFiles = new Set();
  for (const record of archive.files) {
    assert.ok(!archivedFiles.has(record.file), `Duplicate private symbols for ${record.file}`);
    archivedFiles.add(record.file);
    const transformed = transformedByFile.get(record.file);
    assert.ok(transformed, `Private archive has an unknown bundle: ${record.file}`);
    assert.equal(record.inputSha256, transformed.inputSha256);
    assert.equal(record.outputSha256, transformed.outputSha256);
    assert.equal(record.obfuscationMap?.version, 3);
    assert.equal(record.bundleMap?.version, 3);
    assert.ok(String(record.obfuscationMap?.mappings || "").length > 0);
    assert.ok(String(record.bundleMap?.mappings || "").length > 0);
  }
  assert.deepEqual(archivedFiles, new Set(transformedByFile.keys()));

  let smoke = null;
  for (const record of archive.files) {
    const diagnostic = findSymbolicationProbe(archive, record);
    if (!diagnostic) continue;
    smoke = symbolicateDiagnostic(archive, diagnostic);
    break;
  }
  assert.ok(smoke, "Private source maps have no chainable symbolication probe.");
  assert.match(smoke.source, /^(?:frontend|views|shared)\//u);
  return { archivePath, bundles: archive.files.length, smoke };
};

const main = () => {
  const projectRoot = process.cwd();
  const marker = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "dist", "secure-build.json"), "utf8"),
  );
  const result = verifySymbolArchive({ projectRoot, marker });
  console.log(
    `Private symbolication smoke passed (${result.bundles} bundles; ${result.smoke.source}:${result.smoke.line}).`,
  );
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) main();
