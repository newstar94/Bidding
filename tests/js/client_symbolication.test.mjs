import assert from "node:assert/strict";
import test from "node:test";

import { SourceMapGenerator } from "source-map-js";

import {
  normalizeBundlePath,
  symbolicateDiagnostic,
} from "../../scripts/symbolicate_client_error.mjs";

const sourceMap = ({ generated, original, source }) => {
  const generator = new SourceMapGenerator({ file: generated.file });
  generator.addMapping({
    generated: { line: generated.line, column: generated.column },
    original: { line: original.line, column: original.column },
    source,
    name: original.name,
  });
  generator.setSourceContent(source, "export const meaning = 42;\n");
  return JSON.parse(generator.toString());
};

test("client diagnostic symbolication chains obfuscation and bundle maps", () => {
  const file = "assets/app-deadbeef.js";
  const archive = {
    formatVersion: 1,
    releaseId: "0123456789abcdef",
    files: [
      {
        file,
        obfuscationMap: sourceMap({
          generated: { file, line: 3, column: 4 },
          original: { line: 2, column: 5, name: "meaning" },
          source: "sourceMap",
        }),
        bundleMap: sourceMap({
          generated: { file, line: 2, column: 5 },
          original: { line: 7, column: 2, name: "meaning" },
          source: "../../frontend/example.js",
        }),
      },
    ],
  };

  assert.deepEqual(
    symbolicateDiagnostic(archive, {
      releaseId: archive.releaseId,
      source: `/dist/${file}`,
      line: 3,
      column: 4,
    }),
    {
      releaseId: archive.releaseId,
      bundle: file,
      generatedLine: 3,
      generatedColumn: 4,
      source: "frontend/example.js",
      line: 7,
      column: 2,
      name: "meaning",
    },
  );
});

test("symbolication rejects release mismatches and unsafe bundle paths", () => {
  const archive = { formatVersion: 1, releaseId: "release-a", files: [] };
  assert.throws(
    () => symbolicateDiagnostic(archive, {
      releaseId: "release-b",
      source: "/dist/assets/app-deadbeef.js",
      line: 1,
      column: 1,
    }),
    /release does not match/u,
  );
  assert.equal(normalizeBundlePath("/dist/../../private.js"), null);
  assert.equal(normalizeBundlePath("/dist/assets/app-deadbeef.js?token=secret"), "assets/app-deadbeef.js");
});
