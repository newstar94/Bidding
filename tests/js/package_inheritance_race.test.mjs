import assert from "node:assert/strict";
import test from "node:test";

import {
  trackPackageInheritance,
  waitForPackageInheritance,
} from "../../frontend/packages/packageRebidWorkflow.js";

test("package submit waits for canceled-package inheritance to finish", async () => {
  const controller = {};
  let releaseInheritance;
  const gate = new Promise((resolve) => { releaseInheritance = resolve; });
  let inherited = false;

  trackPackageInheritance(controller, async () => {
    await gate;
    inherited = true;
  });

  let submitContinued = false;
  const submitWait = waitForPackageInheritance(controller).then(() => {
    submitContinued = true;
  });
  await Promise.resolve();
  assert.equal(submitContinued, false);
  assert.equal(inherited, false);

  releaseInheritance();
  await submitWait;
  assert.equal(inherited, true);
  assert.equal(submitContinued, true);
});

test("an older inheritance completion cannot clear a newer pending selection", async () => {
  const controller = {};
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  const first = trackPackageInheritance(controller, () => firstGate);
  const second = trackPackageInheritance(controller, () => secondGate);

  releaseFirst();
  await first;
  let secondFinished = false;
  const wait = waitForPackageInheritance(controller).then(() => { secondFinished = true; });
  await Promise.resolve();
  assert.equal(secondFinished, false);

  releaseSecond();
  await Promise.all([second, wait]);
  assert.equal(secondFinished, true);
});
