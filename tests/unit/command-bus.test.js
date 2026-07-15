import test from "node:test";
import assert from "node:assert/strict";

import {
  executeAppCommand,
  hasCommandExecutor,
  setCommandExecutor,
} from "../../frontend/app/commandBus.js";

test("command bus routes view actions without window globals", () => {
  const calls = [];
  setCommandExecutor((name, ...args) => calls.push([name, ...args]));

  executeAppCommand("show-package", "gt-1");

  assert.equal(hasCommandExecutor(), true);
  assert.deepEqual(calls, [["show-package", "gt-1"]]);
  setCommandExecutor(null);
});

