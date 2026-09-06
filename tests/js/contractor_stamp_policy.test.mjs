import test from "node:test";
import assert from "node:assert/strict";
import { canWriteContractorStamp } from "../../frontend/partners/contractorStampPolicy.js";

test("contractor stamp follows create or edit permission, not creator identity", () => {
  let permission = "view";
  const model = {
    state: { activeuser: { id: "employee" } },
    hasPermission: (_id, module, action) => module === "nhathau"
      && (permission === "edit" || (permission === "view" && action === "view")),
  };
  assert.equal(canWriteContractorStamp(model), true);
  assert.equal(canWriteContractorStamp(model, "existing"), false);
  model.state.nhathau = [{ id: "mine", canEdit: true }];
  assert.equal(canWriteContractorStamp(model, "mine"), true);
  permission = "edit";
  assert.equal(canWriteContractorStamp(model, "existing"), true);
  assert.equal(canWriteContractorStamp(model, "existing", true), false);
  permission = "";
  assert.equal(canWriteContractorStamp(model), false);
  assert.equal(canWriteContractorStamp(model, "mine"), false);
  assert.equal(canWriteContractorStamp(model, "created-by-me"), false);
});
