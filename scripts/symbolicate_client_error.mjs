import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { SourceMapConsumer } from "source-map-js";

const BUNDLE_PATH = /^assets\/[A-Za-z0-9_.-]+\.js$/u;
const ORIGINAL_SOURCE = /(?:^|\/)(frontend|views|shared)\/([A-Za-z0-9_./-]+)$/u;

export const normalizeBundlePath = (value) => {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\\") || raw.includes("\0")) return null;
  let pathname = raw;
  try {
    pathname = new URL(raw, "https://biddingflow.invalid").pathname;
  } catch {
    return null;
  }
  const normalized = pathname.replace(/^\/dist\//u, "").replace(/^\//u, "");
  return BUNDLE_PATH.test(normalized) ? normalized : null;
};

const normalizeOriginalSource = (value) => {
  const normalized = String(value || "").replaceAll("\\", "/");
  const match = normalized.match(ORIGINAL_SOURCE);
  if (!match) return null;
  const repositoryPath = path.posix.normalize(`${match[1]}/${match[2]}`);
  return /^(?:frontend|views|shared)\/[A-Za-z0-9_./-]+$/u.test(repositoryPath)
    && !repositoryPath.split("/").includes("..")
    ? repositoryPath
    : null;
};

const positiveInteger = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const nonNegativeInteger = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

const withConsumers = (record, callback) => {
  const obfuscation = new SourceMapConsumer(record.obfuscationMap);
  const bundle = new SourceMapConsumer(record.bundleMap);
  try {
    return callback(obfuscation, bundle);
  } finally {
    obfuscation.destroy?.();
    bundle.destroy?.();
  }
};

export const symbolicateDiagnostic = (archive, diagnostic) => {
  if (!archive || archive.formatVersion !== 1 || !Array.isArray(archive.files)) {
    throw new Error("Unsupported private symbol archive.");
  }
  if (String(diagnostic?.releaseId || "") !== String(archive.releaseId || "")) {
    throw new Error("Diagnostic release does not match the private symbol archive.");
  }
  const file = normalizeBundlePath(diagnostic?.source);
  const line = positiveInteger(diagnostic?.line);
  const column = nonNegativeInteger(diagnostic?.column);
  if (!file || !line || column === null) {
    throw new Error("Diagnostic bundle position is invalid.");
  }
  const record = archive.files.find((candidate) => candidate?.file === file);
  if (!record) throw new Error(`No private symbols for ${file}.`);

  return withConsumers(record, (obfuscation, bundle) => {
    const bundled = obfuscation.originalPositionFor({
      line,
      column,
      bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
    });
    if (!positiveInteger(bundled.line) || bundled.column === null) {
      throw new Error(`Obfuscation map has no mapping for ${file}:${line}:${column}.`);
    }
    const original = bundle.originalPositionFor({
      line: bundled.line,
      column: bundled.column,
      bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
    });
    const source = normalizeOriginalSource(original.source);
    if (!source || !positiveInteger(original.line) || original.column === null) {
      throw new Error(`Bundle map has no safe source for ${file}:${line}:${column}.`);
    }
    return {
      releaseId: archive.releaseId,
      bundle: file,
      generatedLine: line,
      generatedColumn: column,
      source,
      line: original.line,
      column: original.column,
      name: typeof original.name === "string" ? original.name.slice(0, 128) : null,
    };
  });
};

export const findSymbolicationProbe = (archive, record) => withConsumers(
  record,
  (obfuscation, bundle) => {
    let probe = null;
    const found = Symbol("symbolication-probe-found");
    try {
      obfuscation.eachMapping((mapping) => {
        if (!positiveInteger(mapping.generatedLine) || !positiveInteger(mapping.originalLine)) return;
        const original = bundle.originalPositionFor({
          line: mapping.originalLine,
          column: mapping.originalColumn,
          bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
        });
        if (!normalizeOriginalSource(original.source) || !positiveInteger(original.line)) return;
        probe = {
          releaseId: archive.releaseId,
          source: `/dist/${record.file}`,
          line: mapping.generatedLine,
          column: mapping.generatedColumn,
        };
        throw found;
      });
    } catch (error) {
      if (error !== found) throw error;
    }
    return probe;
  },
);

const parseArguments = (arguments_) => {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Expected --archive, --release, --file, --line and --column values.");
    }
    values.set(name.slice(2), value);
  }
  return values;
};

const main = () => {
  const arguments_ = parseArguments(process.argv.slice(2));
  const archivePath = path.resolve(String(arguments_.get("archive") || ""));
  const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
  const result = symbolicateDiagnostic(archive, {
    releaseId: arguments_.get("release"),
    source: arguments_.get("file"),
    line: Number(arguments_.get("line")),
    column: Number(arguments_.get("column")),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
