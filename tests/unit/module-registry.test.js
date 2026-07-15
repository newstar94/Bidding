import test from "node:test";
import assert from "node:assert/strict";

import {
  getInstalledPrototypeModules,
  installPrototypeModules,
} from "../../frontend/app/moduleRegistry.js";

test("prototype module registry installs named functions and records ownership", () => {
  class Target {}
  installPrototypeModules(Target, [
    { name: "first", module: { run() { return "ok"; }, value: 1 } },
  ]);

  assert.equal(new Target().run(), "ok");
  assert.equal(Target.prototype.value, undefined);
  assert.equal(getInstalledPrototypeModules(Target).get("run"), "first");
});

test("prototype module registry detects accidental collisions", () => {
  class Target {}
  installPrototypeModules(Target, [{ name: "first", module: { run() {} } }]);

  assert.throws(() => installPrototypeModules(Target, [
    { name: "second", module: { run() {} } },
  ], { allowOverride: false }), /already provided/);
});

