import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceTaskScheduler } from "../../frontend/shared/WorkspaceTaskScheduler.js";

function schedulerHarness({ idle = true } = {}) {
  const timers = [];
  const idleCallbacks = [];
  const scheduler = new WorkspaceTaskScheduler({
    setTimeoutFn(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeoutFn() {},
    requestIdleCallbackFn: idle
      ? (callback, options) => { idleCallbacks.push({ callback, options }); return idleCallbacks.length; }
      : null,
    cancelIdleCallbackFn() {},
  });
  return { idleCallbacks, scheduler, timers };
}

for (const idle of [true, false]) {
  test(`scheduler honors delay before ${idle ? "idle callback" : "fallback"} dispatch`, async () => {
    const { idleCallbacks, scheduler, timers } = schedulerHarness({ idle });
    const calls = [];
    const result = scheduler.schedule(() => { calls.push("run"); return "done"; }, {
      key: "workspace-1:warm:first-page",
      priority: "warm",
      delay: 900,
      idleTimeout: 700,
    });
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 900);
    assert.deepEqual(calls, []);
    assert.equal(idleCallbacks.length, 0);

    timers[0].callback();
    if (idle) {
      assert.deepEqual(calls, []);
      assert.equal(idleCallbacks[0].options.timeout, 700);
      idleCallbacks[0].callback();
    }
    assert.equal(await result, "done");
    assert.deepEqual(calls, ["run"]);
  });
}

test("scheduler deduplicates an exact task key and bounds network concurrency", async () => {
  const { scheduler, timers } = schedulerHarness({ idle: false });
  let active = 0;
  let maximum = 0;
  const releases = [];
  const task = () => new Promise((resolve) => {
    active += 1;
    maximum = Math.max(maximum, active);
    releases.push(() => { active -= 1; resolve(true); });
  });
  const first = scheduler.schedule(task, { key: "same", priority: "intent", delay: 0 });
  const duplicate = scheduler.schedule(task, { key: "same", priority: "intent", delay: 0 });
  const second = scheduler.schedule(task, { key: "second", priority: "intent", delay: 0 });
  const third = scheduler.schedule(task, { key: "third", priority: "intent", delay: 0 });
  assert.equal(first, duplicate);
  timers.forEach(({ callback }) => callback());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 2);
  assert.equal(releases.length, 2);
  releases.splice(0).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 1);
  releases[0]();
  await Promise.all([first, second, third]);
});
