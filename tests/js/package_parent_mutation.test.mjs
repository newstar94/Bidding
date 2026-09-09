import assert from "node:assert/strict";
import test from "node:test";
import { changedPackageParentPlans } from "../../frontend/packages/GoiThauWorkflow.js";

test("package save excludes unchanged parents but retains actual total changes", () => {
  const original = { id: "plan", tongMucDauTu: 1000000, isTongMucTuDong: false };
  const baseline = structuredClone([original]);
  assert.deepEqual(changedPackageParentPlans([original], baseline, new Set(["plan"])), []);
  const updated = { ...original, tongMucDauTu: 2000000, isTongMucTuDong: true };
  assert.deepEqual(changedPackageParentPlans([updated], baseline, new Set(["plan"])), [updated]);
  assert.deepEqual(changedPackageParentPlans([updated], baseline, new Set(["other"])), []);
});
