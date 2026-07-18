import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import {
  hasCurrentModulePermission,
  moduleForTab
} from "../../frontend/app/BiddingControllerUI.js";


const MODULES = [
  "kehoach",
  "goithau",
  "chudautu",
  "nhathau",
  "chuyengia",
  "hopdong",
  "thongtinmothau"
];


function modelWithPermission(mode, activeRole = "employee") {
  const model = Object.create(BiddingModel.prototype);
  model.state = {
    activerole: activeRole,
    permissionmatrix: [{
      empId: "employee-1",
      ...Object.fromEntries(MODULES.map(moduleName => [moduleName, mode]))
    }]
  };
  return model;
}


test("every UI module enforces none, view and edit consistently", () => {
  for (const moduleName of MODULES) {
    const none = modelWithPermission("");
    assert.equal(none.hasPermission("employee-1", moduleName, "view"), false);
    assert.equal(none.hasPermission("employee-1", moduleName, "edit"), false);

    const view = modelWithPermission("view");
    assert.equal(view.hasPermission("employee-1", moduleName, "view"), true);
    assert.equal(view.hasPermission("employee-1", moduleName, "edit"), false);

    const edit = modelWithPermission("edit");
    assert.equal(edit.hasPermission("employee-1", moduleName, "view"), true);
    assert.equal(edit.hasPermission("employee-1", moduleName, "edit"), true);
  }
});


test("UI permission lookup is employee-scoped and managers inherit access", () => {
  const employee = modelWithPermission("edit");
  assert.equal(employee.hasPermission("employee-2", "kehoach", "view"), false);
  assert.equal(employee.hasPermission("employee-2", "kehoach", "edit"), false);

  const manager = modelWithPermission("", "manager");
  assert.equal(manager.hasPermission("employee-2", "kehoach", "edit"), true);

  const superAdminInEmployeeMode = modelWithPermission("", "employee");
  superAdminInEmployeeMode.state.activeuser = {
    id: "super-admin-1",
    dbRoles: ["super_admin", "manager", "employee"]
  };
  assert.equal(
    superAdminInEmployeeMode.hasPermission("super-admin-1", "kehoach", "edit"),
    true
  );
});


test("every protected UI route maps to its backend permission module", () => {
  assert.equal(moduleForTab("kehoach-detail"), "kehoach");
  assert.equal(moduleForTab("goithau-timeline"), "goithau");
  assert.equal(moduleForTab("danhgiahsdt"), "goithau");
  assert.equal(moduleForTab("mothau"), "thongtinmothau");
  assert.equal(moduleForTab("hopdong-detail"), "hopdong");
  assert.equal(moduleForTab("chudautu-detail"), "chudautu");
  assert.equal(moduleForTab("nhathau-detail"), "nhathau");
  assert.equal(moduleForTab("chuyengia"), "chuyengia");
  assert.equal(moduleForTab("profile"), null);
});


test("current-user UI checks use the active account id and fail closed", () => {
  const model = modelWithPermission("view");
  model.state.activeuser = { id: "employee-1" };
  assert.equal(hasCurrentModulePermission(model, "kehoach", "view"), true);
  assert.equal(hasCurrentModulePermission(model, "kehoach", "edit"), false);
  model.state.activeuser = { id: "employee-2" };
  assert.equal(hasCurrentModulePermission(model, "kehoach", "view"), false);
  model.state.activeuser = { id: "" };
  assert.equal(hasCurrentModulePermission(model, "kehoach", "view"), false);
});
