import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { scheduleWorkspaceEnhancements } from "../../frontend/app/workspaceBootstrap.js";

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
  assert.ok(scheduled.every(({ options }) => options.delay >= 1500));
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

test("non-critical workspace jobs cannot enter the first-interaction window", () => {
  const scheduledDelayAfter = (marker) => {
    const start = controllerSource.indexOf(marker);
    assert.ok(start >= 0, `missing startup job: ${marker}`);
    const match = controllerSource.slice(start, start + 500).match(/delay:\s*(\d+)/);
    assert.ok(match, `missing startup delay: ${marker}`);
    return Number(match[1]);
  };
  for (const marker of [
    "await this.ensureBiddingWorkflows()",
    "this.preloadPrimaryModals()",
    "this.setupFileUploads()",
    "this.setupAutoSyncBackground()",
    "this.model.hydrateRemainingStorageKeysIdle?.()",
  ]) {
    assert.ok(
      scheduledDelayAfter(marker) >= 1500,
      `${marker} must not contend with a user's first click`,
    );
  }
});

test("service worker cache writes do not delay the network response", () => {
  assert.doesNotMatch(serviceWorkerSource, /await cache\.put\(request, response\.clone\(\)\)/);
  assert.match(serviceWorkerSource, /event\.waitUntil\(/);
});

test("runtime CSS rules are appended after bundled static styles", () => {
  assert.match(runtimeStylesSource, /insertRule\([^,]+,\s*[^)]*cssRules\.length\)/);
});
