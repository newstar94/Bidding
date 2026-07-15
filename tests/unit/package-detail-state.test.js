import test from "node:test";
import assert from "node:assert/strict";
import { resolvePackageDetailState } from "../../frontend/packages/detail/PackageDetailState.js";

test("package detail keeps a valid tab only for the same package", () => {
  const tabs = [{ id: "preparation" }, { id: "result" }];
  assert.equal(resolvePackageDetailState({ tabs, currentTab: "result", currentPackageId: "gt-1", packageId: "gt-1" }).activeTab, "result");
  assert.equal(resolvePackageDetailState({ tabs, currentTab: "result", currentPackageId: "gt-1", packageId: "gt-2" }).activeTab, "preparation");
  assert.equal(resolvePackageDetailState({ tabs, currentTab: "missing", currentPackageId: "gt-1", packageId: "gt-1" }).activeTab, "preparation");
});
