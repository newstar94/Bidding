import assert from "node:assert/strict";
import test from "node:test";

import { PackageDetailModule } from "../../frontend/packages/detail/PackageDetailModule.js";

test("package detail module owns mount, save and disposal", async () => {
  const calls = [];
  const module = new PackageDetailModule({
    view: {},
    renderChrome: (_view, detail) => {
      calls.push(`mount:${detail.packageId}`);
      return () => calls.push(`dispose:${detail.packageId}`);
    },
  });
  const context = {
    route: { packageId: "package-1" },
    store: {},
    lifecyclePolicy: {},
    detail: { packageId: "package-1" },
    onNavigate: (route) => calls.push(`navigate:${route.workflowTab}`),
    onSave: async (command) => ({ status: "committed", command }),
  };

  module.mount({}, context);
  module.navigate({ workflowTab: "goods" });
  const saved = await module.save({ type: "save-goods" });
  module.dispose();

  assert.equal(saved.status, "committed");
  assert.deepEqual(calls, ["mount:package-1", "navigate:goods", "dispose:package-1"]);
});

test("package detail module rejects concurrent saves", async () => {
  let release;
  const module = new PackageDetailModule({ view: {}, renderChrome: () => () => {} });
  module.mount({}, {
    route: {}, store: {}, lifecyclePolicy: {}, detail: {},
    onSave: () => new Promise((resolve) => { release = resolve; }),
  });

  const first = module.save({});
  assert.deepEqual(await module.save({}), { status: "rejected", code: "SAVE_IN_PROGRESS" });
  release({ status: "committed" });
  assert.equal((await first).status, "committed");
});
