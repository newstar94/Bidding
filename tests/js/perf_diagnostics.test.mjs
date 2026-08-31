import assert from "node:assert/strict";
import test from "node:test";

test("application debug mode does not flood the console with performance diagnostics", async () => {
  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  let storedFlag = null;
  globalThis.document = {
    querySelector(selector) {
      return selector === 'meta[name="bf-app-debug"]' ? { content: "true" } : null;
    },
  };
  globalThis.localStorage = {
    getItem(key) {
      return key === "bf_perf_debug" ? storedFlag : null;
    },
  };
  globalThis.window = { location: { search: "" } };

  try {
    const diagnostics = await import(`../../frontend/shared/perfDiagnostics.js?test=${Date.now()}`);
    assert.equal(
      diagnostics.perfDebugEnabled(),
      false,
      "APP_DEBUG must not implicitly enable high-volume table timing logs",
    );
    storedFlag = "true";
    assert.equal(diagnostics.perfDebugEnabled(), true, "explicit perf diagnostics remain available");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
