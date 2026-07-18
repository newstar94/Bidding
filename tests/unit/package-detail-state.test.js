import test from "node:test";
import assert from "node:assert/strict";
import { resolvePackageDetailState, selectPackageDetailTab } from "../../frontend/packages/detail/PackageDetailState.js";

test("package detail keeps a valid tab only for the same package", () => {
  const tabs = [{ id: "preparation" }, { id: "result" }];
  assert.equal(resolvePackageDetailState({ tabs, currentTab: "result", currentPackageId: "gt-1", packageId: "gt-1" }).activeTab, "result");
  assert.equal(resolvePackageDetailState({ tabs, currentTab: "result", currentPackageId: "gt-1", packageId: "gt-2" }).activeTab, "preparation");
  assert.equal(resolvePackageDetailState({ tabs, currentTab: "missing", currentPackageId: "gt-1", packageId: "gt-1" }).activeTab, "preparation");
});

test("selecting a workflow tab pins it to the currently rendered package", () => {
  const view = { _currentWorkflowTab: "preparation", _currentWorkflowPackageId: "gt-old" };
  selectPackageDetailTab(view, "result", "gt-current");
  assert.equal(view._currentWorkflowTab, "result");
  assert.equal(view._currentWorkflowPackageId, "gt-current");
});
