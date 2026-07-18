import test from "node:test";
import assert from "node:assert/strict";

import {
  clearCommandArgsForTests,
  registerCommandArgs,
  resolveCommandArgs
} from "../../frontend/shared/commandArgs.js";

test("command argument registry keeps untrusted values outside HTML attributes", () => {
  clearCommandArgsForTests();
  const malicious = 'id\" onmouseover=\"alert(1)';
  const key = registerCommandArgs([malicious, null, 42]);

  assert.match(key, /^bf[a-z0-9]+$/);
  assert.deepEqual(resolveCommandArgs(key), [malicious, null, 42]);
  assert.deepEqual(resolveCommandArgs("missing"), []);
});

test("resolved command arguments cannot mutate the registry", () => {
  clearCommandArgsForTests();
  const key = registerCommandArgs(["original"]);
  const args = resolveCommandArgs(key);
  args[0] = "changed";
  assert.deepEqual(resolveCommandArgs(key), ["original"]);
});
