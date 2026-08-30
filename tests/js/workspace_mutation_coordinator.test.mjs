import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceMutationCoordinator } from "../../frontend/shared/WorkspaceMutationCoordinator.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("canonical render coalescing does not drop a callback queued during an active flight", async () => {
  const firstRender = deferred();
  const calls = [];
  const coordinator = new WorkspaceMutationCoordinator({
    view: { showToast() {} },
  });

  const first = coordinator.afterCanonicalSync("chudautu", async () => {
    calls.push("first:start");
    await firstRender.promise;
    calls.push("first:end");
  });
  await Promise.resolve();

  const second = coordinator.afterCanonicalSync("chudautu", async () => {
    calls.push("second");
  });
  firstRender.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(calls, ["first:start", "first:end", "second"]);
  assert.equal(coordinator.canonicalFlights.size, 0);
});

test("canonical render coalescing keeps the latest pending callback for the same key", async () => {
  const firstRender = deferred();
  const calls = [];
  const coordinator = new WorkspaceMutationCoordinator({
    view: { showToast() {} },
  });

  const first = coordinator.afterCanonicalSync("nhathau", async () => {
    calls.push("first");
    await firstRender.promise;
  });
  await Promise.resolve();
  const stale = coordinator.afterCanonicalSync("nhathau", async () => {
    calls.push("stale");
  });
  const latest = coordinator.afterCanonicalSync("nhathau", async () => {
    calls.push("latest");
  });

  firstRender.resolve();
  await Promise.all([first, stale, latest]);

  assert.deepEqual(calls, ["first", "latest"]);
});
