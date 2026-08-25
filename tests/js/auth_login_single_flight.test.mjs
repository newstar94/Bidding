import assert from "node:assert/strict";
import test from "node:test";

import { createSingleFlightSubmitHandler } from "../../frontend/auth/AuthFlowController.js";

test("login submit admits only one request until the current attempt settles", async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const submit = createSingleFlightSubmitHandler(async () => {
    calls += 1;
    await pending;
  });
  const event = { prevented: 0, preventDefault() { this.prevented += 1; } };

  const first = submit(event);
  const duplicate = submit(event);
  assert.equal(calls, 1);
  assert.equal(event.prevented, 2);

  release();
  await Promise.all([first, duplicate]);
  await submit(event);
  assert.equal(calls, 2);
});
