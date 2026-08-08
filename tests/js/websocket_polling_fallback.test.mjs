import assert from "node:assert/strict";
import test from "node:test";

import { WebSocketSyncClient } from "../../frontend/app/WebSocketSyncClient.js";
import { pollingFallbackDurationBucket } from "../../frontend/shared/releaseDiagnostics.js";


test("polling fallback duration uses bounded low-cardinality buckets", () => {
  assert.equal(pollingFallbackDurationBucket(0), "Under30s");
  assert.equal(pollingFallbackDurationBucket(29_999), "Under30s");
  assert.equal(pollingFallbackDurationBucket(30_000), "30sTo5m");
  assert.equal(pollingFallbackDurationBucket(299_999), "30sTo5m");
  assert.equal(pollingFallbackDurationBucket(300_000), "Over5m");
});


test("WebSocket client polls only while the realtime channel is unavailable", () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const callbacks = [];
  const cleared = [];
  globalThis.setInterval = (callback, interval) => {
    callbacks.push({ callback, interval });
    return 41;
  };
  globalThis.clearInterval = (id) => cleared.push(id);
  const calls = [];
  const controller = {
    _wsReconnectEnabled: true,
    scheduleBackgroundSync(delay) { calls.push(["sync", delay]); },
    notificationCenter: { refresh() { calls.push(["notifications"]); } },
  };
  const client = new WebSocketSyncClient(controller);

  try {
    client.startPollingFallback();
    client.startPollingFallback();
    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0].interval, 30_000);
    callbacks[0].callback();
    assert.deepEqual(calls, [["notifications"], ["sync", 0]]);

    client.stopPollingFallback();
    assert.deepEqual(cleared, [41]);
    assert.equal(controller._wsPollingTimer, null);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
