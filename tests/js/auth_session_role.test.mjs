import assert from "node:assert/strict";
import test from "node:test";

import { resolveSessionRequestedRole } from "../../frontend/auth/AuthFlowController.js";

test("a fresh authenticated session does not preserve the model placeholder role", () => {
  assert.equal(resolveSessionRequestedRole({
    previousUser: { name: "Khách", id: "" },
    previousRole: "employee",
    sessionUser: { id: "admin-1", username: "admin", active_role: null },
  }), null);
});

test("the same account keeps its stored role when a legacy session has no server role", () => {
  assert.equal(resolveSessionRequestedRole({
    previousUser: { id: "admin-1", username: "admin" },
    previousRole: "manager",
    sessionUser: { id: "admin-1", username: "admin", active_role: null },
  }), "manager");
});

test("an explicit server session role wins over a stored role", () => {
  assert.equal(resolveSessionRequestedRole({
    previousUser: { id: "admin-1", username: "admin" },
    previousRole: "employee",
    sessionUser: { id: "admin-1", username: "admin", active_role: "super_admin" },
  }), "super_admin");
});
