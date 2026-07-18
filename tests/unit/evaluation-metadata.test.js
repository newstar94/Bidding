import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_EVALUATION_METADATA_BYTES,
  parseEvaluationMetadata,
  serializeEvaluationMetadata
} from "../../frontend/packages/evaluationMetadata.js";

test("evaluation metadata always carries the supported schema version", () => {
  const serialized = serializeEvaluationMetadata({ technical: { saved: true } });
  assert.deepEqual(JSON.parse(serialized), {
    technical: { saved: true },
    schemaVersion: 1
  });
  assert.equal(parseEvaluationMetadata(serialized).schemaVersion, 1);
});

test("evaluation metadata rejects invalid, unsupported and oversized JSON", () => {
  assert.throws(() => parseEvaluationMetadata("{"), /JSON hợp lệ/);
  assert.throws(() => parseEvaluationMetadata({ schemaVersion: 2 }), /schemaVersion/);
  assert.throws(
    () => parseEvaluationMetadata({ extension: "x".repeat(MAX_EVALUATION_METADATA_BYTES) }),
    /64 KiB/
  );
});
