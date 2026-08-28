import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  handleApplicationBootstrapFailure,
  runApplicationBootstrap,
} from "../../frontend/app/bootstrapRecovery.js";

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = "";
  }

  setAttribute(name, value = "") {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get("click")?.({ preventDefault() {} });
  }

  focus() {
    this.focused = true;
  }
}

function runRouteShell(pathname, { fetchImpl, sessionStorage: sessionStorageImpl } = {}) {
  const body = new FakeElement("body");
  body.setAttribute("hidden", "");
  const workspace = new FakeElement("div");
  const byId = new Map();
  const documentElement = new FakeElement("html");
  const document = {
    body,
    documentElement,
    readyState: "complete",
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => byId.get(id) || null,
    querySelector: (selector) => selector === ".app-container" ? workspace : null,
    addEventListener() {},
  };
  const listeners = new Map();
  const storage = new Map();
  let reloaded = 0;
  const window = {
    document,
    location: {
      origin: "https://example.test",
      pathname,
      href: `https://example.test${pathname}`,
      reload() {
        reloaded += 1;
      },
    },
    fetch: fetchImpl,
    sessionStorage: sessionStorageImpl || {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    requestAnimationFrame: (callback) => callback(),
    setTimeout: () => 1,
    clearTimeout() {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  body.appendChild = (child) => {
    body.children.push(child);
    if (child.attributes.get("id")) byId.set(child.attributes.get("id"), child);
    return child;
  };
  const source = fs.readFileSync("views/vendor/route-shell.js", "utf8");
  vm.runInNewContext(source, { window, document, Element: FakeElement, URL, Response });
  return { body, listeners, workspace, window, get reloaded() { return reloaded; } };
}

test("bootstrap rejection reaches the shared fatal boundary", async () => {
  const failures = [];
  const completed = [];

  const result = await runApplicationBootstrap(
    async () => {
      throw new Error("dynamic import rejected");
    },
    {
      onSuccess: () => completed.push(true),
      onFailure: (error) => failures.push(error.message),
    },
  );

  assert.equal(result, false);
  assert.deepEqual(completed, []);
  assert.deepEqual(failures, ["dynamic import rejected"]);
});

test("top-level bootstrap import failure tries guarded stale recovery before fatal UI", () => {
  const stale = new TypeError(
    "Failed to fetch dynamically imported module: /dist/assets/workspaceBootstrap-AbCdEf12.js",
  );
  const calls = [];
  assert.equal(handleApplicationBootstrapFailure(stale, {
    recover: (error) => {
      calls.push(["recover", error]);
      return true;
    },
    onFailure: (error) => calls.push(["fatal", error]),
  }), true);
  assert.deepEqual(calls, [["recover", stale]]);

  const ordinary = new Error("ordinary bootstrap bug");
  assert.equal(handleApplicationBootstrapFailure(ordinary, {
    recover: (error) => {
      calls.push(["recover", error]);
      return false;
    },
    onFailure: (error) => calls.push(["fatal", error]),
  }), false);
  assert.deepEqual(calls.slice(1), [
    ["recover", ordinary],
    ["fatal", ordinary],
  ]);
});

test("route shell reveals an accessible retry UI when app bootstrap cannot run", () => {
  const harness = runRouteShell("/dang-nhap");

  harness.window.__BF_BOOTSTRAP_FATAL__(new Error("module request failed"));

  assert.equal(harness.body.attributes.has("hidden"), false);
  assert.equal(harness.workspace.attributes.has("hidden"), true);
  const fatal = harness.body.children.find(
    (child) => child.attributes.get("id") === "bf-bootstrap-fatal",
  );
  assert.ok(fatal);
  assert.equal(fatal.attributes.get("role"), "alert");
  assert.equal(fatal.attributes.get("aria-live"), "assertive");
  const retry = fatal.children.find((child) => child.tagName === "BUTTON");
  assert.ok(retry);
  retry.click();
  assert.equal(harness.reloaded, 1);
});

test("Retry reload can complete a subsequent application bootstrap", async () => {
  const failedAttempt = runRouteShell("/dang-nhap");
  failedAttempt.window.__BF_BOOTSTRAP_FATAL__(new Error("first request failed"));
  const fatal = failedAttempt.body.children.find(
    (child) => child.attributes.get("id") === "bf-bootstrap-fatal",
  );
  fatal.children.find((child) => child.tagName === "BUTTON").click();
  assert.equal(failedAttempt.reloaded, 1);

  const retriedAttempt = runRouteShell("/dang-nhap");
  const completed = await runApplicationBootstrap(async () => {}, {
    onSuccess: () => retriedAttempt.window.__BF_BOOTSTRAP_COMPLETE__(),
    onFailure: (error) => retriedAttempt.window.__BF_BOOTSTRAP_FATAL__(error),
  });

  assert.equal(completed, true);
  assert.equal(retriedAttempt.window.document.documentElement.dataset.bfBootstrap, "ready");
  assert.equal(retriedAttempt.body.attributes.has("hidden"), false);
  assert.equal(retriedAttempt.workspace.attributes.has("hidden"), false);
});

test("public route fatal fallback keeps the safe public shell available", () => {
  const harness = runRouteShell("/legal");

  harness.window.__BF_BOOTSTRAP_FATAL__(new Error("legal bootstrap rejected"));

  assert.equal(harness.body.attributes.has("hidden"), false);
  assert.equal(harness.workspace.attributes.has("hidden"), false);
});

test("production module failure refreshes the current static graph and reloads once", async () => {
  const requests = [];
  const manifest = {
    "frontend/app/app.js": {
      file: "assets/app-AbCdEf12.js",
      imports: ["_shared.js"],
      css: ["assets/app-ZyXwVu98.css"],
    },
    "_shared.js": { file: "assets/shared-QwErTy12.js" },
  };
  const harness = runRouteShell("/tong-quan", {
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url) === "/dist/.vite/manifest.json") {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("asset", { status: 200 });
    },
  });
  const script = new FakeElement("script");
  script.setAttribute("type", "module");
  script.src = "https://example.test/dist/assets/app-AbCdEf12.js";

  harness.listeners.get("error")({ target: script });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(requests.map(({ url }) => url), [
    "/dist/.vite/manifest.json",
    "/dist/assets/app-AbCdEf12.js",
    "/dist/assets/app-ZyXwVu98.css",
    "/dist/assets/shared-QwErTy12.js",
  ]);
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[1].options.cache, "reload");
  assert.equal(harness.reloaded, 1);

  harness.listeners.get("error")({ target: script });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.reloaded, 1);
});

test("production recovery waits for refreshed asset bodies before reloading", async () => {
  let releaseAssetBody;
  const assetBodyGate = new Promise((resolve) => { releaseAssetBody = resolve; });
  let assetBodyCompleted = false;
  const harness = runRouteShell("/tong-quan", {
    fetchImpl: async (url) => {
      if (String(url) === "/dist/.vite/manifest.json") {
        return new Response(JSON.stringify({
          "frontend/app/app.js": { file: "assets/app-AbCdEf12.js" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          void assetBodyGate.then(() => {
            controller.enqueue(new Uint8Array([2]));
            controller.close();
            assetBodyCompleted = true;
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      });
    },
  });
  const script = new FakeElement("script");
  script.setAttribute("type", "module");
  script.src = "https://example.test/dist/assets/app-AbCdEf12.js";

  harness.listeners.get("error")({ target: script });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(assetBodyCompleted, false);
  assert.equal(harness.reloaded, 0, "reload must not cancel an unread refresh response");

  releaseAssetBody();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(assetBodyCompleted, true);
  assert.equal(harness.reloaded, 1);
});

test("blocked session storage cannot create a cross-bootstrap recovery loop", async () => {
  const blockedStorage = {
    getItem() {
      throw new DOMException("Storage is blocked", "SecurityError");
    },
    setItem() {
      throw new DOMException("Storage is blocked", "SecurityError");
    },
  };
  let refreshRequests = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const harness = runRouteShell("/tong-quan", {
      fetchImpl: async () => {
        refreshRequests += 1;
        return new Response("unexpected", { status: 200 });
      },
      sessionStorage: blockedStorage,
    });
    const script = new FakeElement("script");
    script.setAttribute("type", "module");
    script.src = "https://example.test/dist/assets/app-AbCdEf12.js";

    harness.listeners.get("error")({ target: script });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(harness.reloaded, 0);
    assert.equal(harness.window.document.documentElement.dataset.bfBootstrap, "failed");
    assert.ok(harness.body.children.some(
      (child) => child.attributes.get("id") === "bf-bootstrap-fatal",
    ));
  }
  assert.equal(refreshRequests, 0, "automatic recovery requires a durable once-only guard");
});
