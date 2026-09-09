import assert from "node:assert/strict";
import test from "node:test";
import { populateNhanVienPhuTrachDropdowns } from "../../frontend/admin/SystemUserView.js";

test("background profile refresh leaves initialized multi-assignee options intact", () => {
  const original = globalThis.document;
  const packageSelect = { __bfMultiAssigneeSelect: {}, innerHTML: "selected-package-assignee" };
  const contractSelect = { __bfMultiAssigneeSelect: {}, innerHTML: "selected-contract-assignee" };
  globalThis.document = { getElementById: (id) => id.startsWith("gt-") ? packageSelect : contractSelect };
  try {
    populateNhanVienPhuTrachDropdowns.call({ model: { state: { activerole: "super_admin", employees: [] } } });
    assert.equal(packageSelect.innerHTML, "selected-package-assignee");
    assert.equal(contractSelect.innerHTML, "selected-contract-assignee");
  } finally { globalThis.document = original; }
});
