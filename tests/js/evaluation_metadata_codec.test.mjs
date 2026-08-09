import assert from "node:assert/strict";
import test from "node:test";

import * as metadataCodec from "../../frontend/packages/evaluationMetadata.js";

import {
  EVALUATION_METADATA_SCHEMA_VERSION,
  migrateEvaluationMetadata,
  parseEvaluationMetadataForDisplay,
  parseEvaluationMetadataStrict,
  serializeEvaluationMetadata,
} from "../../frontend/packages/evaluationMetadata.js";

test("evaluation metadata exposes only the canonical codec surface", () => {
  assert.deepEqual(Object.keys(metadataCodec).sort(), [
    "EVALUATION_METADATA_SCHEMA_VERSION",
    "MAX_EVALUATION_METADATA_BYTES",
    "migrateEvaluationMetadata",
    "parseEvaluationMetadataForDisplay",
    "parseEvaluationMetadataStrict",
    "serializeEvaluationMetadata",
  ]);
});
import { savePackageCancellation } from "../../frontend/packages/packageCancellation.js";


test("strict evaluation metadata rejects malformed JSON arrays and unknown schemas", () => {
  for (const value of ["{broken", "[]", [], { schemaVersion: 99 }]) {
    assert.throws(() => parseEvaluationMetadataStrict(value));
    assert.throws(() => serializeEvaluationMetadata(value));
  }
});


test("display parsing reports corruption without making fallback metadata persistable", () => {
  const raw = "{broken";
  const result = parseEvaluationMetadataForDisplay(raw);

  assert.equal(result.canPersist, false);
  assert.equal(result.raw, raw);
  assert.equal(result.error instanceof Error, true);
  assert.deepEqual(result.metadata, {
    schemaVersion: EVALUATION_METADATA_SCHEMA_VERSION,
  });
});


test("metadata migration is idempotent and preserves legacy 1G2T blocks", () => {
  const legacy = {
    schemaVersion: 0,
    is1G2T: true,
    technical: { saved: true, criteria: [{ id: "criterion-1" }] },
    financial: { saved: false },
  };
  const migrated = migrateEvaluationMetadata(legacy);

  assert.equal(migrated.schemaVersion, EVALUATION_METADATA_SCHEMA_VERSION);
  assert.deepEqual(migrated.technical, legacy.technical);
  assert.deepEqual(migrated.financial, legacy.financial);
  assert.deepEqual(migrateEvaluationMetadata(migrated), migrated);
  assert.deepEqual(parseEvaluationMetadataStrict(JSON.stringify(legacy)), migrated);
});


test("evaluation metadata codec rejects payloads larger than 64 KiB", () => {
  assert.throws(
    () => serializeEvaluationMetadata({ notes: "x".repeat(64 * 1024) }),
    /64 KiB/,
  );
});


test("a save path cannot replace malformed metadata with an empty object", async () => {
  const pkg = {
    id: "package-1",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: "{broken",
  };
  const controller = {
    model: { state: { goithau: [pkg] } },
  };

  await assert.rejects(() => savePackageCancellation(controller, pkg, {
    decisionNumber: "QĐ-01",
    decisionDate: "2026-08-08",
    reason: "Không đủ điều kiện",
  }), /JSON hợp lệ/);
  assert.equal(pkg.danhGiaHsdtMetadata, "{broken");
  assert.equal(pkg.trangThai, "Đang chấm thầu");
});
