import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { scheduleWorkspaceEnhancements } from "../../frontend/app/workspaceBootstrap.js";
import {
  POST_STARTUP_INTERACTION_GRACE_MS,
  POST_STARTUP_TIMING,
} from "../../frontend/app/startupTiming.js";

const appSource = fs.readFileSync("frontend/app/app.js", "utf8");
const workspaceSource = fs.readFileSync("frontend/app/workspaceBootstrap.js", "utf8");
const controllerSource = fs.readFileSync("frontend/app/BiddingController.js", "utf8");
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
  const enhancementSchedule = workspaceSource.indexOf("scheduleWorkspaceEnhancements(controller)");
  assert.ok(controllerInit >= 0 && enhancementSchedule > controllerInit);
});

test("primary business views do not block workspace startup", () => {
  assert.doesNotMatch(workspaceSource, /^import .*PrimaryBusinessView/m);
  assert.doesNotMatch(workspaceSource, /installPrimaryBusinessViewModule/);
});

test("workspace runtime is split out of the bootstrap entry", () => {
  for (const moduleName of [
    "BiddingModel",
    "BiddingView",
    "BiddingController",
    "AuthController",
    "BiddingControllerUI",
    "BiddingControllerForms",
    "BiddingControllerSync",
    "IntegrationWorkflowBridges",
  ]) {
    assert.doesNotMatch(workspaceSource, new RegExp(`^import .*${moduleName}`, "m"));
    assert.match(workspaceSource, new RegExp(`import\\([^)]*${moduleName}\\.js`));
  }
});

test("notification click initializes immediately even before scheduled maintenance", async () => {
  const previousDocument = globalThis.document;
  const trigger = new EventTarget();
  globalThis.document = { getElementById: () => trigger };
  let opened = 0;
  const scheduled = [];
  const controller = { schedulePostStartupTask: (task) => scheduled.push(task) };
  try {
    scheduleWorkspaceEnhancements(controller, {
      importNotificationCenter: async () => ({ initializeNotificationCenter: () => ({ open: () => opened++ }) }),
    });
    trigger.dispatchEvent(new Event("click"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(opened, 1);
    await scheduled[0]();
    assert.equal(opened, 1);
  } finally { globalThis.document = previousDocument; }
});

test("assistant and notification imports wait behind the post-startup interaction grace", async () => {
  const scheduled = [];
  const imports = [];
  const controller = {
    schedulePostStartupTask(task, options) {
      scheduled.push({ task, options });
    },
  };
  scheduleWorkspaceEnhancements(controller, {
    importAssistantLoader: async () => {
      imports.push("assistant-import");
      return { loadAssistant: async () => imports.push("assistant-mount") };
    },
    importNotificationCenter: async () => {
      imports.push("notification-import");
      return { initializeNotificationCenter: () => ({ ready: true }) };
    },
  });

  assert.deepEqual(imports, [], "optional chunks must not compete with the first interaction");
  assert.equal(scheduled.length, 2);
  assert.ok(scheduled.every(({ options }) => (
    options.delay >= POST_STARTUP_INTERACTION_GRACE_MS
  )));
  assert.ok(scheduled.every(({ options }) => options.priority === "maintenance"));

  await scheduled[0].task();
  await scheduled[1].task();
  assert.deepEqual(imports, [
    "notification-import",
    "assistant-import",
    "assistant-mount",
  ]);
  assert.deepEqual(controller.notificationCenter, { ready: true });
});

test("optional workspace jobs cannot enter the first-interaction window", () => {
  const scheduledDelayAfter = (marker) => {
    const start = controllerSource.indexOf(marker);
    assert.ok(start >= 0, `missing startup job: ${marker}`);
    const match = controllerSource.slice(start, start + 500).match(
      /delay:\s*POST_STARTUP_TIMING\.(\w+)/,
    );
    assert.ok(match, `missing startup delay: ${marker}`);
    return POST_STARTUP_TIMING[match[1]];
  };
  for (const marker of [
    "this.preloadPrimaryModals()",
    "this.loadHolidaysInBackground()",
  ]) {
    assert.ok(
      scheduledDelayAfter(marker) >= POST_STARTUP_INTERACTION_GRACE_MS,
      `${marker} must not contend with a user's first click`,
    );
  }
});

test("authoritative data readiness is not hidden behind multi-second startup timers", () => {
  assert.equal(
    POST_STARTUP_TIMING.primaryTabWarm,
    0,
    "exact first-page caches should start as soon as reconciliation releases them",
  );
  assert.ok(
    POST_STARTUP_TIMING.remainingStorageHydration <= 1000,
    "the model already dispatches remaining IndexedDB reads through requestIdleCallback",
  );
  assert.ok(
    POST_STARTUP_TIMING.referenceData <= 1500,
    "authorized employee/package reference data must not remain unavailable for tens of seconds",
  );
  assert.equal(
    POST_STARTUP_TIMING.backgroundSync,
    undefined,
    "live sync listeners must be armed directly after the interactive shell",
  );
  assert.doesNotMatch(
    controllerSource,
    /schedulePostStartupTask\(\(\)\s*=>\s*\{\s*this\.setupAutoSyncBackground\(\)/u,
    "WebSocket/focus/storage listeners must not wait for a maintenance timer",
  );
  assert.doesNotMatch(
    controllerSource,
    /schedulePostStartupTask\(\s*\(\)\s*=>\s*this\.model\.hydrateRemainingStorageKeysIdle/u,
    "dispatching the model's own idle hydration should happen immediately",
  );
});

test("elapsed startup time never imports route workflow modules", () => {
  assert.doesNotMatch(
    controllerSource,
    /schedulePostStartupTask\(async\s*\(\)\s*=>\s*\{\s*await this\.ensureBiddingWorkflows\(\)/,
    "BiddingWorkflows must remain owned by an explicit route or action",
  );
  assert.equal(
    POST_STARTUP_TIMING.biddingWorkflows,
    undefined,
    "a route-owned module must not have an elapsed-time startup trigger",
  );
});

test("service worker cannot intercept the secure module graph", () => {
  assert.doesNotMatch(serviceWorkerSource, /addEventListener\(["']fetch["']/u);
  assert.doesNotMatch(serviceWorkerSource, /respondWith\s*\(/u);
  assert.doesNotMatch(serviceWorkerSource, /manifest\.json/u);
  assert.doesNotMatch(serviceWorkerSource, /cache\.(?:match|put)\s*\(/u);
  assert.doesNotMatch(serviceWorkerSource, /addAll\s*\(/u);
  assert.doesNotMatch(serviceWorkerSource, /\bfetch\s*\(/u);
  assert.match(serviceWorkerSource, /registration\.unregister\s*\(/u);
  assert.match(serviceWorkerSource, /clients\.claim\s*\(/u);
});

test("runtime CSS rules are appended after bundled static styles", () => {
  assert.match(runtimeStylesSource, /insertRule\([^,]+,\s*[^)]*cssRules\.length\)/);
});
