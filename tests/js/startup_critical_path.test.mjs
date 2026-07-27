import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync("frontend/app/app.js", "utf8");
const workspaceSource = fs.readFileSync("frontend/app/workspaceBootstrap.js", "utf8");
const serviceWorkerSource = fs.readFileSync("views/service-worker.js", "utf8");
const runtimeStylesSource = fs.readFileSync("frontend/shared/runtimeStyles.js", "utf8");

test("service worker registration is deferred until after the first app frame", () => {
  const bootstrapStart = appSource.indexOf("const bootstrapApplication");
  const firstFrame = appSource.indexOf('startupMark("first-app-frame")');
  const registration = appSource.indexOf("navigator.serviceWorker.register");
  assert.ok(bootstrapStart >= 0 && firstFrame >= 0 && registration >= 0);
  assert.ok(registration > firstFrame, "registration must not compete with the critical startup path");
});

test("notification center is loaded after controller init without blocking startup", () => {
  assert.doesNotMatch(workspaceSource, /^import .*NotificationCenter/m);
  const controllerInit = workspaceSource.indexOf("await controller.init()");
  const notificationImport = workspaceSource.indexOf('import("./NotificationCenter.js")');
  assert.ok(controllerInit >= 0 && notificationImport > controllerInit);
});

test("service worker cache writes do not delay the network response", () => {
  assert.doesNotMatch(serviceWorkerSource, /await cache\.put\(request, response\.clone\(\)\)/);
  assert.match(serviceWorkerSource, /event\.waitUntil\(/);
});

test("runtime CSS rules are appended after bundled static styles", () => {
  assert.match(runtimeStylesSource, /insertRule\([^,]+,\s*[^)]*cssRules\.length\)/);
});
