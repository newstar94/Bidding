import assert from "node:assert/strict";
import test from "node:test";

import { packageTeamsAreEditable } from "../../frontend/packages/packageTeamPolicy.js";

test("package teams remain editable through contractor selection result", () => {
  for (const status of [
    "Chuẩn bị",
    "Đang mời thầu",
    "Đã mở thầu",
    "Đang chấm thầu",
    "Đã có kết quả một phần",
    "Đã có kết quả",
  ]) {
    assert.equal(packageTeamsAreEditable(status), true, status);
  }
});

test("cancelled and read-only package teams remain immutable", () => {
  assert.equal(packageTeamsAreEditable("Hủy thầu"), false);
  assert.equal(packageTeamsAreEditable("Đã có kết quả", true), false);
});
