import assert from "node:assert/strict";
import test from "node:test";

import {
  packageFieldsLockedAfterInvitation,
} from "../../frontend/app/BiddingControllerForms.js";
import { lifecycleContract } from "../../frontend/packages/LifecyclePolicy.js";

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

test("invited packages lock every package scheduling field", () => {
  const locked = new Set(lifecycleContract().lockedAfterInvitation);
  assert.ok(locked.has("thoiGianThucHien"));
  assert.ok(locked.has("thoiGianToChuc"));
  assert.ok(locked.has("thoiGianBatDauToChuc"));
});

test("locked package fields remain part of the visible read-only form contract", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(
    new URL("../../frontend/app/BiddingControllerForms.js", import.meta.url),
    "utf8",
  ));
  assert.match(source, /if \(isLocked\) \{\s*setVisible\(formGroup, true\);\s*setDisabled\(input, true\);/u);
  assert.doesNotMatch(source, /if \(isLocked\) \{\s*setVisible\(formGroup, false\);/u);
  assert.match(source, /thoiGianThucHien: "gt-thoigian"/u);
  assert.match(source, /thoiGianToChuc: "gt-thoigiantochuc"/u);
  assert.match(source, /thoiGianBatDauToChuc: "gt-thoigianbatdautochuc"/u);
});

test("modal setup reapplies lifecycle locking after legacy field handlers", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(
    new URL("../../frontend/packages/GoiThauWorkflow.js", import.meta.url),
    "utf8",
  ));
  const handlerIndex = source.indexOf("this.handleHinhThucChange();", source.indexOf("const isOpenedOrLater"));
  const finalPolicyIndex = source.indexOf("this.updatePackageFieldsVisibility(isReadOnly);", handlerIndex);
  const readOnlyIndex = source.indexOf("if (isReadOnly) {", finalPolicyIndex);
  assert.ok(handlerIndex >= 0);
  assert.ok(finalPolicyIndex > handlerIndex);
  assert.ok(readOnlyIndex > finalPolicyIndex);
});

test("existing packages do not invent a missing MSC evaluation method", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(
    new URL("../../frontend/app/BiddingControllerForms.js", import.meta.url),
    "utf8",
  ));
  assert.match(source, /preserveMissingSourceValue[\s\S]+-- Chưa có dữ liệu --/u);
  assert.match(source, /else if \(preserveMissingSourceValue\) \{\s*gtPhuongPhapDanhGiaSelect\.value = "";/u);
});
