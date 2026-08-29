import assert from "node:assert/strict";
import test from "node:test";

import {
  getPrototypeModuleInventory,
  installPrototypeModules,
} from "../../frontend/app/moduleRegistry.js";


test("prototype module registration rejects class and module collisions by default", () => {
  class Controller {
    existing() {}
  }

  assert.throws(
    () => installPrototypeModules(Controller, [{
      name: "feature-a",
      module: { existing() {} },
    }]),
    /already provided by Controller\.prototype/,
  );

  installPrototypeModules(Controller, [{
    name: "feature-a",
    module: { execute() {} },
  }]);
  assert.throws(
    () => installPrototypeModules(Controller, [{
      name: "feature-b",
      module: { execute() {} },
    }]),
    /already provided by feature-a/,
  );
});


test("prototype module inventory records stable command ownership", () => {
  class Controller {}
  const feature = { beta() {}, alpha() {}, ignored: "value" };

  installPrototypeModules(Controller, [{ name: "feature", module: feature }]);
  installPrototypeModules(Controller, [{ name: "feature", module: feature }]);

  assert.deepEqual(getPrototypeModuleInventory(Controller), {
    alpha: "feature",
    beta: "feature",
  });
  assert.equal(Object.isFrozen(getPrototypeModuleInventory(Controller)), true);
});


test("identical re-exports may share a prototype command without an override", () => {
  class Controller {}
  const sharedCommand = () => "shared";

  installPrototypeModules(Controller, [{
    name: "feature-a",
    module: { sharedCommand },
  }]);
  installPrototypeModules(Controller, [{
    name: "feature-b",
    module: { sharedCommand },
  }]);

  assert.equal(new Controller().sharedCommand(), "shared");
  assert.deepEqual(getPrototypeModuleInventory(Controller), {
    sharedCommand: "feature-a",
  });
});


test("prototype modules can never be installed on Object.prototype", () => {
  const commandName = "__biddingflow_object_prototype_guard__";

  assert.throws(
    () => installPrototypeModules(Object, [{
      name: "unsafe-controller",
      module: { [commandName]() {} },
    }]),
    /Object\.prototype/u,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(Object.prototype, commandName),
    false,
  );
});
