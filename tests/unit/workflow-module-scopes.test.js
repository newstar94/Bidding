import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWorkflowScope,
  WORKFLOW_SCOPES
} from "../../frontend/app/workflowModuleScopes.js";

test("workflow loader resolves plan, package and partner commands independently", () => {
  assert.deepEqual(WORKFLOW_SCOPES, ["plan", "package", "partner"]);
  assert.equal(resolveWorkflowScope("editKeHoach"), "plan");
  assert.equal(resolveWorkflowScope("editGoiThau"), "package");
  assert.equal(resolveWorkflowScope("renderDanhGiaHsdtPanel"), "package");
  assert.equal(resolveWorkflowScope("editNhaThau"), "partner");
});

test("workflow loader maps routes and leaves document integrations on their own loader", () => {
  assert.equal(resolveWorkflowScope("kehoach-detail"), "plan");
  assert.equal(resolveWorkflowScope("mothau"), "package");
  assert.equal(resolveWorkflowScope("hopdong-detail"), "partner");
  assert.equal(resolveWorkflowScope("triggerExcelImport"), null);
  assert.equal(resolveWorkflowScope(), "all");
});
