import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOfflineSyncSoakRuns,
  runOfflineSyncSoak,
} from "../../scripts/run_offline_sync_soak.mjs";


test("offline sync soak runs every isolated repetition", () => {
  const attempts = [];
  const result = runOfflineSyncSoak({
    runs: 3,
    runOnce: (run) => {
      attempts.push(run);
      return { status: 0 };
    },
  });

  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(result, { ok: true, runs: 3, completed: 3 });
});


test("offline sync soak stops at the first failed repetition", () => {
  const attempts = [];
  const result = runOfflineSyncSoak({
    runs: 5,
    runOnce: (run) => {
      attempts.push(run);
      return { status: run === 2 ? 7 : 0 };
    },
  });

  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(result, {
    ok: false,
    runs: 5,
    completed: 1,
    failedRun: 2,
    status: 7,
  });
});


test("offline sync soak count is explicit and bounded", () => {
  assert.equal(normalizeOfflineSyncSoakRuns(undefined), 5);
  assert.equal(normalizeOfflineSyncSoakRuns("10"), 10);
  assert.throws(() => normalizeOfflineSyncSoakRuns("0"), /between 1 and 50/);
  assert.throws(() => normalizeOfflineSyncSoakRuns("2.5"), /between 1 and 50/);
  assert.throws(() => normalizeOfflineSyncSoakRuns("51"), /between 1 and 50/);
});
