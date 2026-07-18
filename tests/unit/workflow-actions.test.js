import test from "node:test";
import assert from "node:assert/strict";

import { renderWorkflowActions } from "../../frontend/packages/detail/WorkflowActions.js";

test("workflow actions show and emit cancellation only when allowed", () => {
  const cancelButton = {};
  const container = {
    innerHTML: "",
    querySelector: () => cancelButton
  };
  let cancelled = false;
  renderWorkflowActions(container, { canCancel: true, onCancel: () => { cancelled = true; } });
  assert.match(container.innerHTML, /Hủy thầu/);
  cancelButton.onclick();
  assert.equal(cancelled, true);

  container.querySelector = () => null;
  renderWorkflowActions(container, { canCancel: false });
  assert.doesNotMatch(container.innerHTML, /Hủy thầu/);
});
