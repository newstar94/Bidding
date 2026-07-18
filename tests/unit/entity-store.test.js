import assert from "node:assert/strict";
import test from "node:test";

import { removeEntity, upsertEntity } from "../../frontend/app/entityStore.js";

test("entity store adds and replaces normalized records without DOM or storage", () => {
  const state = {};
  const normalize = (record) => ({ ...record, name: record.name.trim() });

  upsertEntity(state, "goithau", { id: "gt-1", name: " Gói 1 " }, normalize);
  upsertEntity(state, "goithau", { id: "gt-1", name: " Gói mới " }, normalize);

  assert.deepEqual(state.goithau, [{ id: "gt-1", name: "Gói mới" }]);
});

test("entity store deletion returns the removed record and keeps other records", () => {
  const state = { goithau: [{ id: "gt-1" }, { id: "gt-2" }] };

  assert.deepEqual(removeEntity(state, "goithau", "gt-1"), { id: "gt-1" });
  assert.deepEqual(state.goithau, [{ id: "gt-2" }]);
});
