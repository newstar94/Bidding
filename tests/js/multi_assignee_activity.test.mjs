import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAssignmentDelta,
  computeAssignmentDelta,
  filterAvailableAssigneeOptions,
  normalizeAssigneeIds,
} from "../../frontend/shared/MultiAssigneeSelect.js";
import {
  derivePackageAssigneeControlState,
  resolvePackageAssigneeIds,
} from "../../frontend/packages/packageAssignmentPolicy.js";
import {
  ACTIVITY_LABELS,
  activityChangedFieldLabels,
  buildActivityTimelineMarkup,
  formatActivityTime,
} from "../../frontend/shared/ActivityTimeline.js";


test("assignee ids are normalized and deduplicated", () => {
  assert.deepEqual(normalizeAssigneeIds([" a ", "b", "a", "", null]), ["a", "b"]);
});


test("searchable assignee dropdown excludes selected people", () => {
  const options = [
    { value: "a", label: "Nguyễn An", searchText: "an@example.com" },
    { value: "b", label: "Trần Bình", searchText: "binh@example.com" },
    { value: "c", label: "Lê Chi", searchText: "chi@example.com", disabled: true },
  ];

  assert.deepEqual(
    filterAvailableAssigneeOptions(options, ["a"], "binh").map((option) => option.value),
    ["b"],
  );
  assert.deepEqual(
    filterAvailableAssigneeOptions(options, ["a"], "nguyen"),
    [],
  );
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


test("timeline describes changed fields with business labels instead of database columns", () => {
  const item = {
    actorName: "Administrator",
    action: "goithau.updated",
    occurredAt: "2026-07-30T15:07:43+07:00",
    metadata: {
      changedFields: ["thoi_gian_mo_thau", "trang_thai"],
    },
  };

  assert.deepEqual(activityChangedFieldLabels(item), [
    "Thời gian mở thầu",
    "Trạng thái gói thầu",
  ]);

  const markup = buildActivityTimelineMarkup([item]);
  assert.match(markup, /Nội dung đã thay đổi/);
  assert.match(markup, /Thời gian mở thầu/);
  assert.match(markup, /Trạng thái gói thầu/);
  assert.match(markup, /activity-card/);
  assert.match(markup, /activity-change-list/);
  assert.doesNotMatch(markup, /Trường thay đổi/);
  assert.doesNotMatch(markup, /thoi_gian_mo_thau|trang_thai/);
});


test("timeline never exposes an unknown technical column name", () => {
  const markup = buildActivityTimelineMarkup([{
    actorName: "Administrator",
    action: "goithau.updated",
    occurredAt: "2026-07-30T15:07:43+07:00",
    metadata: { changedFields: ["future_internal_column"] },
  }]);

  assert.match(markup, /1 thông tin khác/);
  assert.doesNotMatch(markup, /future_internal_column/);
});
