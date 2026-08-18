import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";


test("manager employee persona inherits view and honors explicit edit", () => {
  const model = Object.create(BiddingModel.prototype);
  model.state = {
    activerole: "employee",
    activeuser: {
      activeOrganizationId: "org-1",
      dbRole: "manager",
      dbRoles: ["manager", "employee"],
      id: "manager-1",
      organizations: [{
        id: "org-1",
        role: "manager",
        scope_type: "organization",
        status: "active",
      }],
    },
    assignments: [{ empId: "manager-1", targetId: "package-assigned", type: "goithau" }],
    goithau: [
      { id: "package-assigned", rootId: "package-assigned", isLatest: 1 },
      { id: "package-unassigned", rootId: "package-unassigned", isLatest: 1 },
    ],
    kehoach: [],
    permissionmatrix: [],
  };

  assert.equal(model.hasInheritedSpecialistAccess(), true);
  assert.equal(model.hasPermission("manager-1", "goithau", "view"), true);
  assert.equal(model.hasPermission("manager-1", "goithau", "edit"), false);
  model.state.permissionmatrix = [{ empId: "manager-1", goithau: "edit" }];
  assert.equal(model.hasPermission("manager-1", "goithau", "edit"), true);
  assert.deepEqual(
    model.getFilteredGoiThau().map((item) => item.id),
    ["package-assigned"],
  );
});
