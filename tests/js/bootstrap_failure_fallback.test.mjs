import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { runApplicationBootstrap } from "../../frontend/app/bootstrapRecovery.js";

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

function runRouteShell(pathname) {
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
  let reloaded = 0;
  const window = {
    document,
    location: {
      pathname,
      reload() {
        reloaded += 1;
      },
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
  vm.runInNewContext(source, { window, document, Element: FakeElement });
  return { body, workspace, window, get reloaded() { return reloaded; } };
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
