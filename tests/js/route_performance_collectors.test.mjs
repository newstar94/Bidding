import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  installRoutePerformanceCollectors,
  waitForRoutePerformanceSnapshot,
} from "../../scripts/route_performance_collectors.mjs";

function collectorEnvironment({ supported, observeError, missingObserver } = {}) {
  const observers = new Map();
  let now = 10;
  class BoundaryPerformanceObserver {
    static supportedEntryTypes = supported || ["longtask", "long-animation-frame"];

    constructor(callback) {
      this.callback = callback;
      this.buffer = [];
    }

    observe({ type }) {
      if (observeError) throw new Error(observeError);
      observers.set(type, this);
    }

    takeRecords() {
      return this.buffer.splice(0);
    }

    disconnect() {}
  }
  const context = vm.createContext({
    PerformanceObserver: missingObserver ? undefined : BoundaryPerformanceObserver,
    performance: { now: () => now },
    requestAnimationFrame: (callback) => queueMicrotask(() => {
      now += 10;
      callback(now);
    }),
    setTimeout,
    clearTimeout,
  });
  return {
    install: () => vm.runInContext(`(${installRoutePerformanceCollectors.toString()})()`, context),
    snapshot: () => vm.runInContext(`(${waitForRoutePerformanceSnapshot.toString()})()`, context),
    enqueue: (type, entry) => observers.get(type).buffer.push(entry),
    deliver: (type, entries) => observers.get(type).callback({ getEntries: () => entries }),
  };
}

test("route metrics include queued entries before callback delivery without duplicates", async () => {
  const environment = collectorEnvironment();
  environment.install();
  environment.deliver("longtask", [{ startTime: 1, duration: 51, attribution: [] }]);
  environment.enqueue("longtask", { startTime: 2, duration: 121, attribution: [] });
  environment.enqueue("long-animation-frame", {
    startTime: 2,
    duration: 126,
    blockingDuration: 71,
    scripts: [],
  });

  const first = await environment.snapshot();
  assert.deepEqual(Array.from(first.longTasks, (entry) => entry.duration), [51, 121]);
  assert.equal(first.longAnimationFrames[0].blockingDuration, 71);
  const second = await environment.snapshot();
  assert.deepEqual(Array.from(second.longTasks, (entry) => entry.duration), [51, 121]);
});

test("route metrics reject missing and unsupported collectors instead of reporting zero", async (t) => {
  await t.test("missing installation", async () => {
    await assert.rejects(collectorEnvironment().snapshot(), /collector is missing/i);
  });
  await t.test("missing browser observer API", async () => {
    const environment = collectorEnvironment({ missingObserver: true });
    environment.install();
    await assert.rejects(environment.snapshot(), /PerformanceObserver is unavailable/);
  });
  await t.test("unsupported required entry type", async () => {
    const environment = collectorEnvironment({ supported: ["longtask"] });
    environment.install();
    await assert.rejects(environment.snapshot(), /long-animation-frame is unsupported/);
  });
  await t.test("observer installation failure", async () => {
    const environment = collectorEnvironment({ observeError: "controlled observer failure" });
    environment.install();
    await assert.rejects(environment.snapshot(), /controlled observer failure/);
  });
});

test("route snapshot fixes the render cutoff and retains full crossing tasks", async () => {
  const environment = collectorEnvironment();
  environment.install();
  environment.enqueue("longtask", { startTime: 29, duration: 120, attribution: [] });
  environment.enqueue("longtask", { startTime: 31, duration: 140, attribution: [] });

  const snapshot = await environment.snapshot();
  assert.equal(snapshot.readyMs, 10);
  assert.equal(snapshot.observationEndMs, 30);
  assert.deepEqual(Array.from(snapshot.longTasks, (entry) => entry.duration), [120]);
});
