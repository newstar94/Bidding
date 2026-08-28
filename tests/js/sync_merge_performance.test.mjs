import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { mergeIncomingRecords } from "../../frontend/app/syncMergeUtils.js";

test("10k existing plus 10k incoming merge remains linear and below the lab budget", () => {
  const existing = Array.from({ length: 10_000 }, (_, index) => ({ id: `row-${index}`, value: index }));
  const incoming = Array.from({ length: 10_000 }, (_, index) => ({ id: `row-${index + 5_000}`, value: index + 1 }));
  const durations = [];
  for (let run = 0; run < 21; run += 1) {
    const model = { state: { rows: existing.slice() } };
    const started = performance.now();
    mergeIncomingRecords(model, "rows", incoming);
    const duration = performance.now() - started;
    assert.equal(model.state.rows.length, 15_000);
    if (run > 0) durations.push(duration);
  }
  durations.sort((left, right) => left - right);
  const median = durations[Math.floor(durations.length / 2)];
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  assert.ok(median < 50, `median ${median.toFixed(2)}ms exceeds 50ms`);
  assert.ok(p95 < 50, `P95 ${p95.toFixed(2)}ms exceeds 50ms`);
});
