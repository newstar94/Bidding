import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

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
      const match = /^(script|link)(?:\[rel="([^"]+)"\])?\[(src|href)="(.+)"\]$/u.exec(selector);
      if (!match) return null;
      return nodes.find((node) => (
        node.tagName === match[1].toUpperCase()
        && (!match[2] || node.rel === match[2])
        && node[match[3]] === match[4]
      )) || null;
    },
  };
}

test("already loaded script missing its global can retry after synchronous rejection", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const document = fakeAssetDocument();
  globalThis.document = document;
  globalThis.window = {};
  try {
    const src = "/vendor/test/preloaded-missing-global.js";
    const existing = document.createElement("script");
    existing.src = src;
    existing.dataset.assetState = "loaded";
    document.head.appendChild(existing);
    const failed = loadScriptOnce(src, "RetryRuntime");
    await assert.rejects(failed, /RetryRuntime/u);
    const retried = loadScriptOnce(src, "RetryRuntime");
    // Attach a handler even on old code, where retry returns the rejected promise.
    void retried.catch(() => {});
    assert.notEqual(retried, failed);
    assert.equal(document.nodes.length, 1);
    globalThis.window.RetryRuntime = { ready: true };
    document.nodes[0].dispatch("load");
    assert.equal(await retried, globalThis.window.RetryRuntime);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("stylesheet insertion failure does not poison the retry cache", async () => {
  const originalDocument = globalThis.document;
  const document = fakeAssetDocument();
  globalThis.document = document;
  try {
    const append = document.head.appendChild;
    document.head.appendChild = () => { throw new Error("fixture insertion failure"); };
    const href = "/frontend/test/insertion-retry.css";
    const failed = loadStyleOnce(href);
    await assert.rejects(failed, /fixture insertion failure/u);
    document.head.appendChild = append;
    const retried = loadStyleOnce(href);
    void retried.catch(() => {});
    assert.notEqual(retried, failed);
    document.nodes[0].dispatch("load");
    assert.equal(await retried, true);
  } finally {
    globalThis.document = originalDocument;
  }
});


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

test("completed style preload still attaches one stylesheet for concurrent callers", async () => {
  const originalDocument = globalThis.document;
  const document = fakeAssetDocument();
  globalThis.document = document;
  try {
    const href = "/frontend/test/preloaded-route.css";
    const preload = document.createElement("link");
    preload.rel = "preload";
    preload.as = "style";
    preload.href = href;
    document.head.appendChild(preload);
    // The browser may finish preloading before the route requests its styles.
    preload.dispatch("load");

    const first = loadStyleOnce(href);
    const second = loadStyleOnce(href);
    assert.equal(first, second, "concurrent callers reuse the stylesheet load");
    let resolved = false;
    void first.then(() => { resolved = true; });
    const stylesheets = document.nodes.filter((node) => node.rel === "stylesheet");
    assert.equal(stylesheets.length, 1, "a preload does not apply the stylesheet");
    assert.equal(stylesheets[0].href, href);
    assert.equal(document.nodes.length, 2);
    preload.dispatch("load");
    await Promise.resolve();
    assert.equal(resolved, false, "preload completion cannot settle stylesheet readiness");
    stylesheets[0].dispatch("load");
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(resolved, true);
    assert.equal(await loadStyleOnce(href), true);
    assert.equal(document.nodes.length, 2, "subsequent callers do not append another stylesheet");
    assert.equal(preload.rel, "preload");
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

test("calendar styles download in parallel with scripts while the locale waits for its runtime", async () => {
  // Browser asset URLs are origin-relative; only replace the file:// URL that
  // new URL(import.meta.url) would produce in the Node test environment.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./flatpickrTheme.js" && context.parentURL?.endsWith("externalAssets.js?calendar-loading-test")) {
        return {
          url: `data:text/javascript,${encodeURIComponent('export const FLATPICKR_THEME_URL = "/frontend/shared/flatpickrTheme.css";')}`,
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });
  let ensureFlatpickrLoaded;
  try {
    ({ ensureFlatpickrLoaded } = await import("../../frontend/shared/externalAssets.js?calendar-loading-test"));
  } finally {
    hooks.deregister();
  }
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const document = fakeAssetDocument();
  globalThis.document = document;
  globalThis.window = {};
  try {
    let ready = false;
    const first = ensureFlatpickrLoaded().then((value) => { ready = true; return value; });
    const second = ensureFlatpickrLoaded();
    const styles = document.nodes.filter((node) => node.tagName === "LINK");
    assert.deepEqual(styles.map((node) => node.href), [
      "/frontend/shared/flatpickrTheme.css", "/vendor/flatpickr/flatpickr.min.css?v=4",
    ], "stylesheet order stays unchanged");
    const script = document.nodes.find((node) => node.tagName === "SCRIPT");
    assert.ok(script, "the main script must not wait for the stylesheets");
    assert.equal(document.nodes.length, 3, "concurrent callers share the same downloads");
    const runtime = { l10ns: {} };
    window.flatpickr = runtime;
    script.dispatch("load");
    await Promise.resolve();
    const locale = document.nodes.find((node) => node.src.includes("/l10n/vn.js"));
    assert.ok(locale, "locale loading starts after runtime execution, even while CSS is pending");
    runtime.l10ns.vn = {};
    locale.dispatch("load");
    await Promise.resolve();
    assert.equal(ready, false, "callers still wait until styling is ready");
    styles.forEach((node) => node.dispatch("load"));
    assert.equal(await first, runtime);
    assert.equal(await second, runtime);
    assert.equal(await ensureFlatpickrLoaded(), runtime);
    assert.equal(document.nodes.length, 4, "repeat openings reuse the loaded assets");
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
