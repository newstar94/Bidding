import assert from "node:assert/strict";
import test from "node:test";

import {
  packageFieldsLockedAfterInvitation,
} from "../../frontend/app/BiddingControllerForms.js";

const STATUS_ORDER = [
  "Chưa xác định",
  "Chuẩn bị",
  "Đang mời thầu",
  "Đã mở thầu",
  "Đang chấm thầu",
  "Đã có kết quả một phần",
  "Đã có kết quả",
  "Hủy thầu",
];

test("preparation package keeps its populated base fields visible in edit modal", () => {
  assert.equal(
    packageFieldsLockedAfterInvitation("Chuẩn bị", STATUS_ORDER),
    false,
  );
});

test("package base fields lock only from invitation onward", () => {
  assert.equal(packageFieldsLockedAfterInvitation("Chưa xác định", STATUS_ORDER), false);
  assert.equal(packageFieldsLockedAfterInvitation("Đang mời thầu", STATUS_ORDER), true);
  assert.equal(packageFieldsLockedAfterInvitation("Đã mở thầu", STATUS_ORDER), true);
  assert.equal(packageFieldsLockedAfterInvitation("Chuẩn bị", STATUS_ORDER, true), false);
});
