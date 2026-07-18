import test from "node:test";
import assert from "node:assert/strict";

import { bindAwardResultPanel } from "../../frontend/packages/detail/AwardResultPanel.js";

test("award result panel emits edit and restores export button after failure", async () => {
  const editButton = {};
  const exportButton = { innerHTML: "Xuất", disabled: false };
  const container = {
    querySelector: selector => selector.includes("edit-result") ? editButton : exportButton
  };
  const calls = [];
  bindAwardResultPanel(container, {
    onEdit: () => calls.push("edit"),
    onExport: async () => { throw new Error("failed"); },
    onExportError: error => calls.push(error.message),
    refreshIcons: () => calls.push("icons")
  });
  editButton.onclick();
  await exportButton.onclick();
  assert.deepEqual(calls, ["edit", "icons", "failed", "icons"]);
  assert.equal(exportButton.disabled, false);
  assert.equal(exportButton.innerHTML, "Xuất");
});
