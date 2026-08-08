import assert from "node:assert/strict";
import test from "node:test";

import { DraftAutosaveStore } from "../../frontend/packages/DetailedEvaluationDraftAutosave.js";


test("detailed evaluation autosave debounces, restores, and never saves completed reports", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const scheduled = [];
  const autosave = new DraftAutosaveStore(storage, {
    now: () => 123,
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
    cancel: () => {},
  });

  autosave.schedule("pkg:bid:technical", () => ({ id: "report-1", trangThai: "draft" }));
  scheduled[0]();
  assert.deepEqual(autosave.restore("pkg:bid:technical"), {
    report: { id: "report-1", trangThai: "draft" },
    savedAt: 123,
    pendingServerSync: true,
  });

  autosave.schedule("completed", () => ({ id: "report-2", trangThai: "completed" }));
  scheduled[1]();
  assert.equal(autosave.restore("completed"), null);
});
