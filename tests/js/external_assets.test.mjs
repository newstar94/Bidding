import assert from "node:assert/strict";
import test from "node:test";

import {
  loadScriptOnce,
  loadStyleOnce,
} from "../../frontend/shared/externalAssets.js";


function fakeAssetDocument() {
  const nodes = [];
  const createNode = (tagName) => {
    const listeners = new Map();
    return {
      tagName: tagName.toUpperCase(),
      dataset: {},
      src: "",
      href: "",
      onload: null,
      onerror: null,
      addEventListener(type, callback) {
        const callbacks = listeners.get(type) || [];
        callbacks.push(callback);
        listeners.set(type, callbacks);
      },
      remove() {
        const index = nodes.indexOf(this);
        if (index >= 0) nodes.splice(index, 1);
      },
      dispatch(type) {
        this[`on${type}`]?.({ type, target: this });
        for (const callback of listeners.get(type) || []) {
          callback({ type, target: this });
        }
      },
    };
  };
  return {
    nodes,
    createElement: createNode,
    head: {
      appendChild(node) { nodes.push(node); },
    },
    querySelector(selector) {
      const match = /^(script|link)\[(src|href)="(.+)"\]$/u.exec(selector);
      if (!match) return null;
      return nodes.find((node) => (
        node.tagName === match[1].toUpperCase() && node[match[2]] === match[3]
      )) || null;
    },
  };
}


test("concurrent stylesheet callers both wait for the same load event", async () => {
  const originalDocument = globalThis.document;
  const document = fakeAssetDocument();
  globalThis.document = document;
  try {
    const href = "/frontend/test/concurrent-asset.css";
    let secondResolved = false;
    const first = loadStyleOnce(href);
    const second = loadStyleOnce(href).then(() => { secondResolved = true; });
    await Promise.resolve();

    assert.equal(document.nodes.length, 1);
    assert.equal(secondResolved, false);
    document.nodes[0].dispatch("load");
    await Promise.all([first, second]);
    assert.equal(secondResolved, true);
  } finally {
    globalThis.document = originalDocument;
  }
});


test("failed stylesheet load removes the node and can retry", async () => {
  const originalDocument = globalThis.document;
  const document = fakeAssetDocument();
  globalThis.document = document;
  try {
    const href = "/frontend/test/retry-asset.css";
    const failed = loadStyleOnce(href);
    document.nodes[0].dispatch("error");
    await assert.rejects(failed, /Không thể tải stylesheet/u);
    assert.equal(document.nodes.length, 0);

    const retried = loadStyleOnce(href);
    assert.equal(document.nodes.length, 1);
    document.nodes[0].dispatch("load");
    assert.equal(await retried, true);
  } finally {
    globalThis.document = originalDocument;
  }
});


test("script load rejects a missing global and succeeds on retry", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const document = fakeAssetDocument();
  globalThis.document = document;
  globalThis.window = {};
  try {
    const src = "/vendor/test/runtime-global.js";
    const failed = loadScriptOnce(src, "ExpectedRuntime");
    document.nodes[0].dispatch("load");
    await assert.rejects(failed, /ExpectedRuntime/u);
    assert.equal(document.nodes.length, 0);

    const retried = loadScriptOnce(src, "ExpectedRuntime");
    const runtime = { ready: true };
    globalThis.window.ExpectedRuntime = runtime;
    document.nodes[0].dispatch("load");
    assert.equal(await retried, runtime);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
