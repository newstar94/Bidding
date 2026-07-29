import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAssignmentDelta,
  computeAssignmentDelta,
  normalizeAssigneeIds,
} from "../../frontend/shared/MultiAssigneeSelect.js";
import {
  derivePackageAssigneeControlState,
  resolvePackageAssigneeIds,
} from "../../frontend/packages/packageAssignmentPolicy.js";
import {
  ACTIVITY_LABELS,
  buildActivityTimelineMarkup,
  formatActivityTime,
} from "../../frontend/shared/ActivityTimeline.js";


test("assignee ids are normalized and deduplicated", () => {
  assert.deepEqual(normalizeAssigneeIds([" a ", "b", "a", "", null]), ["a", "b"]);
});


test("explicit assignee set does not inject creator", () => {
  assert.deepEqual(resolvePackageAssigneeIds(["a", "b"], "creator"), ["a", "b"]);
  assert.deepEqual(resolvePackageAssigneeIds([], "creator"), ["creator"]);
});


test("form state restores every existing assignee", () => {
  assert.deepEqual(derivePackageAssigneeControlState({
    activeRole: "manager",
    packageId: "package-1",
    assignedEmpIds: ["a", "b", "a"],
    creatorId: "creator",
  }), { values: ["a", "b"], disabled: false });
});


test("assignment delta preserves unchanged row identity", () => {
  const rowA = { id: "row-a", empId: "a" };
  const rowB = { id: "row-b", empId: "b", rowVersion: 7 };
  const delta = computeAssignmentDelta([rowA, rowB], ["b", "c"]);

  assert.deepEqual(delta.addedIds, ["c"]);
  assert.deepEqual(delta.removedAssignments, [rowA]);
  assert.equal(delta.unchangedAssignments[0], rowB);
  assert.equal(delta.unchangedAssignments[0].rowVersion, 7);
});


test("new version stages the complete confirmed assignee set", async () => {
  const model = {
    state: { assignments: [] },
    async addRecord(_table, row) {
      this.state.assignments.push(row);
    },
    async deleteRecord() {
      throw new Error("new version must not delete an existing assignment");
    },
  };

  await applyAssignmentDelta(model, {
    targetId: "package-v2",
    type: "goithau",
    selectedIds: ["a", "b", "c"],
  });

  assert.deepEqual(
    model.state.assignments.map((assignment) => assignment.empId).sort(),
    ["a", "b", "c"],
  );
});


test("timeline maps stable action keys and absolute timestamps", () => {
  const value = "2026-07-29T08:30:00+07:00";
  assert.equal(ACTIVITY_LABELS["assignment.removed"], "Đã gỡ người phụ trách");
  assert.notEqual(formatActivityTime(value), "Không rõ thời gian");
  const markup = buildActivityTimelineMarkup([{
    actorName: "Nguyễn A",
    action: "assignment.removed",
    occurredAt: value,
    metadata: { assigneeName: "Trần B" },
  }]);
  assert.match(markup, /Nguyễn A/);
  assert.match(markup, /Trần B/);
  assert.match(markup, /datetime=/);
});
