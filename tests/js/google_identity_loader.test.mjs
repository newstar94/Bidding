import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleIdentityLoader,
  getGoogleIdentityClientId,
} from "../../frontend/auth/GoogleIdentityLoader.js";


class FakeScript {
  constructor() {
    this.dataset = {};
    this.listeners = new Map();
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }

  dispatch(type) {
    this.listeners.get(type)?.();
  }

  remove() {
    this.parentNode?.removeChild(this);
  }
}

test("Google Identity configuration is read from the public meta value", () => {
  assert.equal(getGoogleIdentityClientId({ querySelector: () => null }), "");
  assert.equal(getGoogleIdentityClientId({
    querySelector: (selector) => {
      assert.equal(selector, 'meta[name="google-client-id"]');
      return { content: "  local-client-id  " };
    },
  }), "local-client-id");
});

function createFakeDocument() {
  const scripts = [];
  return {
    scripts,
    createElement(tagName) {
      assert.equal(tagName, "script");
      return new FakeScript();
    },
    querySelector(selector) {
      assert.equal(selector, "script[data-bf-google-identity]");
      return scripts.find((script) => script.dataset.bfGoogleIdentity === "true") || null;
    },
    head: {
      appendChild(script) {
        script.parentNode = this;
        scripts.push(script);
      },
      removeChild(script) {
        const index = scripts.indexOf(script);
        if (index >= 0) scripts.splice(index, 1);
        script.parentNode = null;
      },
    },
  };
}

test("Google Identity retries with a fresh script after the initial script load fails", async () => {
  const documentRef = createFakeDocument();
  const globalRef = {};
  const loader = createGoogleIdentityLoader({
    documentRef,
    globalRef,
    loadTimeoutMs: 60_000,
  });

  const firstLoad = loader.load();
  assert.equal(documentRef.scripts.length, 1);
  documentRef.scripts[0].dispatch("error");
  await assert.rejects(firstLoad, /could not be loaded/u);
  assert.equal(documentRef.scripts.length, 0, "a failed script must not poison the retry");

  const retry = loader.load();
  assert.equal(documentRef.scripts.length, 1);
  globalRef.google = { accounts: { id: {} } };
  documentRef.scripts[0].dispatch("load");
  await retry;
  assert.equal(loader.isReady(), true);
});

test("Google Identity clears a timed-out script so a later attempt can load", async () => {
  const documentRef = createFakeDocument();
  const globalRef = {};
  let triggerTimeout;
  const loader = createGoogleIdentityLoader({
    documentRef,
    globalRef,
    setTimeoutFn(callback) {
      triggerTimeout = callback;
      return 1;
    },
    clearTimeoutFn() {},
  });

  const firstLoad = loader.load();
  triggerTimeout();
  await assert.rejects(firstLoad, /timeout/u);
  assert.equal(documentRef.scripts.length, 0);

  const retry = loader.load();
  globalRef.google = { accounts: { id: {} } };
  documentRef.scripts[0].dispatch("load");
  await retry;
});
