import assert from "node:assert/strict";
import test from "node:test";

import {
  derivePackageAssigneeControlState,
  ensureCurrentUserAssignee,
  resolveInitialPackageAssigneeId,
  resolvePackageAssigneeId,
} from "../../frontend/packages/packageAssignmentPolicy.js";


test("manager and admin accounts remain valid package assignees", () => {
  for (const role of ["manager", "super_admin"]) {
    const candidates = ensureCurrentUserAssignee(
      [{ id: "employee-1", name: "Chuyên viên A", role: "employee" }],
      { id: `${role}-1`, name: `Người tạo ${role}`, role }
    );

    assert.equal(candidates.length, 2);
    assert.deepEqual(
      candidates.find((candidate) => candidate.id === `${role}-1`),
      { id: `${role}-1`, name: `Người tạo ${role}`, email: "", role }
    );
  }
});


test("new package defaults to its creator unless another assignee is selected", () => {
  assert.equal(resolvePackageAssigneeId("", "manager-1"), "manager-1");
  assert.equal(resolvePackageAssigneeId("employee-2", "manager-1"), "employee-2");
});


test("new package form visibly selects its creator for every supported role", () => {
  for (const creatorRole of ["employee", "manager", "super_admin"]) {
    assert.equal(
      resolveInitialPackageAssigneeId({
        packageId: "",
        assignedEmpId: "",
        creatorId: `${creatorRole}-1`,
      }),
      `${creatorRole}-1`
    );
  }
});


test("existing package form restores its saved assignee instead of the viewer", () => {
  assert.equal(
    resolveInitialPackageAssigneeId({
      packageId: "package-1",
      assignedEmpId: "employee-2",
      creatorId: "manager-1",
    }),
    "employee-2"
  );
});


test("employee sees the creator selected but cannot assign another specialist", () => {
  assert.deepEqual(
    derivePackageAssigneeControlState({
      activeRole: "employee",
      packageId: "",
      assignedEmpId: "",
      creatorId: "employee-1",
    }),
    { value: "employee-1", disabled: true }
  );
});


test("manager sees the creator selected and may choose another specialist", () => {
  assert.deepEqual(
    derivePackageAssigneeControlState({
      activeRole: "manager",
      packageId: "",
      assignedEmpId: "",
      creatorId: "manager-1",
    }),
    { value: "manager-1", disabled: false }
  );
});


test("assignee candidates are deduplicated when the creator is already loaded", () => {
  const candidates = ensureCurrentUserAssignee(
    [{ id: "manager-1", name: "Quản lý", email: "manager@example.test", role: "manager" }],
    { id: "manager-1", name: "Tên trong phiên", role: "manager" }
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, "Quản lý");
});
