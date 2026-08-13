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


test("WebSocket client keeps bounded reconciliation while realtime is available", () => {
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


function installRealtimeHarness() {
  const originals = {
    WebSocket: globalThis.WebSocket,
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const sockets = [];
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0;
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      sockets.push(this);
    }

    send(payload) { this.sent.push(payload); }

    close(code, reason) {
      this.readyState = FakeWebSocket.CLOSED;
      this.closedWith = { code, reason };
    }
  }
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { protocol: "http:", host: "testserver" } },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { getElementById: () => null },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  globalThis.setInterval = (callback, interval) => {
    const id = ++timerId;
    intervals.set(id, { callback, interval });
    return id;
  };
  globalThis.clearInterval = id => intervals.delete(id);
  globalThis.setTimeout = (callback, delay) => {
    const id = ++timerId;
    timeouts.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = id => timeouts.delete(id);
  return {
    sockets,
    intervals,
    timeouts,
    restore() {
      for (const [key, value] of Object.entries(originals)) {
        Object.defineProperty(globalThis, key, { configurable: true, value });
      }
    },
  };
}


function realtimeController(organizationId, label) {
  let workspaceToken = `${label}:1`;
  const calls = [];
  const controller = {
    calls,
    model: {
      workspaceScope: { organizationId },
      getWorkspaceToken: () => workspaceToken,
      isWorkspaceCurrent: token => token === workspaceToken,
    },
    scheduleBackgroundSync(delay) { calls.push(["sync", delay]); },
    notificationCenter: { refresh() { calls.push(["notifications"]); } },
    updateSyncState(state) { calls.push(["state", state]); },
  };
  controller.switchWorkspace = nextOrganizationId => {
    workspaceToken = `${label}:${Number(workspaceToken.split(":")[1]) + 1}`;
    controller.model.workspaceScope.organizationId = nextOrganizationId;
  };
  return controller;
}


test("personal workspace auth rejection leaves polling active in both tabs", () => {
  const harness = installRealtimeHarness();
  const controllers = [realtimeController("personal:user-1", "tab-a"), realtimeController("personal:user-1", "tab-b")];
  const clients = controllers.map(controller => new WebSocketSyncClient(controller));
  try {
    clients.forEach(client => client.connect());
    assert.equal(harness.intervals.size, 2);
    harness.sockets.forEach(socket => {
      socket.readyState = WebSocket.OPEN;
      socket.onopen();
      socket.readyState = WebSocket.CLOSED;
      socket.onclose({ code: 4003, reason: "session_or_workspace" });
    });
    assert.equal(harness.intervals.size, 2);
    for (const timer of harness.intervals.values()) timer.callback();
    for (const controller of controllers) {
      assert.deepEqual(controller.calls.slice(-2), [["notifications"], ["sync", 0]]);
    }
  } finally {
    clients.forEach(client => client.disconnect(false));
    harness.restore();
  }
});


test("ready socket keeps bounded reconciliation and reconnect reuses it", () => {
  const harness = installRealtimeHarness();
  const controller = realtimeController("org-1", "tab-a");
  const client = new WebSocketSyncClient(controller);
  try {
    client.connect();
    const firstSocket = harness.sockets[0];
    assert.ok(controller._wsPollingTimer);
    firstSocket.readyState = WebSocket.OPEN;
    firstSocket.onopen();
    assert.ok(controller._wsPollingTimer);
    firstSocket.onmessage({ data: JSON.stringify({ type: "ready", organizationId: "org-1" }) });
    assert.ok(controller._wsPollingTimer);
    const timer = harness.intervals.get(controller._wsPollingTimer);
    timer.callback();
    assert.deepEqual(controller.calls.slice(-2), [["notifications"], ["sync", 0]]);

    firstSocket.readyState = WebSocket.CLOSED;
    firstSocket.onclose({ code: 1013, reason: "retry" });
    assert.ok(controller._wsPollingTimer);
    assert.equal(harness.timeouts.size, 1);
    const reconnect = [...harness.timeouts.values()][0];
    reconnect.callback();
    assert.equal(harness.sockets.length, 2);
    assert.ok(controller._wsPollingTimer);
  } finally {
    client.disconnect(false);
    harness.restore();
  }
});


test("logout stops polling while workspace switch transfers fallback ownership", () => {
  const harness = installRealtimeHarness();
  const controller = realtimeController("personal:user-1", "tab-a");
  const client = new WebSocketSyncClient(controller);
  try {
    client.connect();
    const oldSocket = harness.sockets[0];
    oldSocket.readyState = WebSocket.OPEN;
    oldSocket.onopen();
    oldSocket.readyState = WebSocket.CLOSED;
    oldSocket.onclose({ code: 4003, reason: "session_or_workspace" });
    assert.ok(controller._wsPollingTimer);

    client.disconnect(false);
    assert.equal(controller._wsPollingTimer, null);
    assert.equal(harness.intervals.size, 0);

    controller.switchWorkspace("org-2");
    client.connect();
    assert.ok(controller._wsPollingTimer);
    assert.equal(harness.intervals.size, 1);
    oldSocket.onclose({ code: 4003, reason: "stale_close" });
    assert.equal(harness.intervals.size, 1);

    const newSocket = harness.sockets[1];
    newSocket.readyState = WebSocket.OPEN;
    newSocket.onopen();
    newSocket.onmessage({ data: JSON.stringify({ type: "ready", organizationId: "org-2" }) });
    assert.ok(controller._wsPollingTimer);
  } finally {
    client.disconnect(false);
    harness.restore();
  }
});
