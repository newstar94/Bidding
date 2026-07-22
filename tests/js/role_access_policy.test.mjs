import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";


function modelFor({ dbRoles, permission = "" }) {
  const model = Object.create(BiddingModel.prototype);
  model.state = {
    activerole: "employee",
    activeuser: {
      id: "user-1",
      activeOrganizationId: "org-1",
      dbRoles,
      organizations: [],
    },
    permissionmatrix: permission
      ? [{ empId: "user-1", chuyengia: permission }]
      : [],
  };
  return model;
}


test("admin and manager retain specialist edit access in employee context", () => {
  assert.equal(modelFor({ dbRoles: ["super_admin", "manager", "employee"] }).hasPermission("user-1", "chuyengia", "edit"), true);
  assert.equal(modelFor({ dbRoles: ["manager", "employee"] }).hasPermission("user-1", "chuyengia", "edit"), true);
});


test("ordinary employee still follows the configured module permission", () => {
  assert.equal(modelFor({ dbRoles: ["employee"], permission: "view" }).hasPermission("user-1", "chuyengia", "edit"), false);
  assert.equal(modelFor({ dbRoles: ["employee"], permission: "edit" }).hasPermission("user-1", "chuyengia", "edit"), true);
});
