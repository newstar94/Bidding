import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelChunkedRender,
  renderChunkedSequence,
} from "../../frontend/shared/ChunkedRenderer.js";

test("chunked renderer yields, adapts and keeps every 1,000-row slice below 50 ms", async () => {
  const owner = {};
  const scheduled = [];
  const rendered = [];
  const durations = [];
  let clock = 0;
  const pending = renderChunkedSequence(
    owner,
    Array.from({ length: 1_000 }, (_unused, index) => index),
    (chunk) => {
      rendered.push(...chunk);
      clock += chunk.length * 0.7;
    },
    {
      chunkSize: 40,
      budgetMs: 12,
      now: () => clock,
      scheduleFrame: (callback) => scheduled.push(callback),
      onChunk: ({ durationMs }) => durations.push(durationMs),
    },
  );

  assert.equal(rendered.length, 40, "only the first bounded slice renders synchronously");
  while (scheduled.length) scheduled.shift()();
  const result = await pending;

  assert.equal(result.cancelled, false);
  assert.equal(rendered.length, 1_000);
  assert.deepEqual(rendered, Array.from({ length: 1_000 }, (_unused, index) => index));
  assert.ok(Math.max(...durations) < 50);
});

test("a replacement render cancels stale scheduled chunks", async () => {
  const owner = {};
  const scheduled = [];
  const staleRows = [];
  const stale = renderChunkedSequence(owner, [1, 2, 3, 4], (chunk) => {
    staleRows.push(...chunk);
  }, {
    chunkSize: 1,
    scheduleFrame: (callback) => scheduled.push(callback),
  });
  const freshRows = [];
  const fresh = renderChunkedSequence(owner, [9], (chunk) => freshRows.push(...chunk), {
    chunkSize: 1,
    scheduleFrame: (callback) => scheduled.push(callback),
  });
  while (scheduled.length) scheduled.shift()();

  assert.equal((await stale).cancelled, true);
  assert.equal((await fresh).cancelled, false);
  assert.deepEqual(staleRows, [1]);
  assert.deepEqual(freshRows, [9]);
  assert.equal(cancelChunkedRender(owner), false);
});
