import assert from "node:assert/strict";
import test from "node:test";

import { organizationEmployeeLabel } from "../../frontend/auth/accessContext.js";
import { ensureCurrentUserAssignee } from "../../frontend/packages/packageAssignmentPolicy.js";

test("assignee label uses the employee name in the active organization and email only", () => {
  const user = {
    name: "Tên tài khoản",
    email: "admin@localhost",
    organizations: [
      {
        id: "org-1",
        name: "Tổ chức 1",
        scope_type: "organization",
        role: "manager",
        employee_name: "Quản lý JV E2E",
      },
    ],
  };

  assert.equal(
    organizationEmployeeLabel(user, "org-1"),
    "Quản lý JV E2E - admin@localhost",
  );
});

test("current assignee fallback does not copy the account username into employee name", () => {
  const [candidate] = ensureCurrentUserAssignee([], {
    id: "user-1",
    name: "",
    username: "account-name",
    email: "employee@example.com",
    role: "employee",
  });

  assert.equal(candidate.name, "");
  assert.equal(candidate.email, "employee@example.com");
});

test("assignee label never falls back to the account name in an organization", () => {
  const user = {
    name: "Tên tài khoản không dùng",
    email: "manager@example.com",
    organizations: [
      {
        id: "org-1",
        name: "Tổ chức 1",
        scope_type: "organization",
        role: "manager",
        employee_name: "",
      },
    ],
  };

  assert.equal(organizationEmployeeLabel(user, "org-1"), "manager@example.com");
});
