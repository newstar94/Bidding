import assert from "node:assert/strict";
import test from "node:test";

import { setupSyncUx } from "../../frontend/app/BiddingControllerSync.js";


test("WebSocket closes before BFCache and reconnects when the page is restored", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const eventTarget = new EventTarget();
  eventTarget.location = { protocol: "http:", host: "127.0.0.1:8000" };
  const documentTarget = new EventTarget();
  documentTarget.getElementById = () => null;
  documentTarget.querySelector = () => null;
  const calls = [];
  const controller = {
    model: {
      syncErrors: [],
      workspaceStorage: { getItem: () => null },
    },
    updateSyncState() {},
    disconnectWebSocket(reconnect) {
      calls.push(["disconnect", reconnect]);
    },
    setupWebSocketConnection() {
      calls.push(["connect"]);
    },
  };

  Object.defineProperty(globalThis, "window", { configurable: true, value: eventTarget });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentTarget });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });

  try {
    setupSyncUx.call(controller);
    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: true });
    eventTarget.dispatchEvent(pagehide);
    assert.deepEqual(calls, [["disconnect", false]]);

    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    eventTarget.dispatchEvent(pageshow);
    assert.deepEqual(calls, [["disconnect", false], ["connect"]]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  }
});
