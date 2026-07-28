import assert from "node:assert/strict";
import test from "node:test";

import { applyStateMutations, stageLocalRecords } from "../../frontend/shared/MutationService.js";

test("stages explicit upserts before mutatePersistAndSync persists them", () => {
  const calls = [];
  const model = {
    state: { goithau: [{ id: "pkg-1", trangThai: "Chuẩn bị" }] },
    normalizeRecordKeys: (record) => ({ ...record }),
    commitLocalMutation(table, options) {
      calls.push({ table, records: options.records });
    },
  };

  const changed = applyStateMutations(model, {
    upserts: { goithau: { id: "pkg-1", trangThai: "Hủy thầu" } },
  });

  assert.deepEqual(changed, ["goithau"]);
  assert.equal(model.state.goithau[0].trangThai, "Hủy thầu");
  assert.deepEqual(calls, [{
    table: "goithau",
    records: [{ id: "pkg-1", trangThai: "Hủy thầu" }],
  }]);
});

test("stages only valid records and preserves deleted row versions", () => {
  const staged = [];
  const deleted = [];
  const packageRecord = { id: "pkg-1", rowVersion: 7 };
  const model = {
    state: { goithau: [packageRecord] },
    commitLocalMutation(table, options) { staged.push([table, options.records]); },
    markDeleted(table, records) { deleted.push([table, records]); },
  };

  assert.deepEqual(stageLocalRecords(model, "goithau", [null, {}, packageRecord]), [packageRecord]);
  applyStateMutations(model, { deletions: { goithau: "pkg-1" } });

  assert.deepEqual(staged, [["goithau", [packageRecord]]]);
  assert.deepEqual(deleted, [["goithau", [{ id: "pkg-1", rowVersion: 7 }]]]);
});
