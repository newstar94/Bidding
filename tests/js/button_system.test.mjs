import assert from "node:assert/strict";
import test from "node:test";

import { inferButtonIcon, inferButtonVariant } from "../../frontend/shared/buttonSystem.js";

test("button icons follow the shared action vocabulary", () => {
  assert.equal(inferButtonIcon({ text: "Lưu thay đổi" }), "save");
  assert.equal(inferButtonIcon({ text: "Hủy chỉnh sửa" }), "");
  assert.equal(inferButtonIcon({ text: "Hủy" }), "");
  assert.equal(inferButtonIcon({ text: "Hủy bỏ" }), "");
  assert.equal(inferButtonIcon({ text: "Thêm gói thầu mới" }), "plus");
  assert.equal(inferButtonIcon({ text: "Phát hành HSMT" }), "send");
  assert.equal(inferButtonIcon({ text: "Tải Excel mẫu" }), "download");
  assert.equal(inferButtonIcon({ text: "Nhập từ Excel" }), "upload");
  assert.equal(inferButtonIcon({ text: "Chỉnh sửa kết quả" }), "pencil");
  assert.equal(inferButtonIcon({ text: "Xóa phần lô" }), "trash-2");
});

test("button id can supply an icon when the label is generic", () => {
  assert.equal(inferButtonIcon({ id: "btn-save-permission-matrix", text: "Cập nhật" }), "save");
  assert.equal(inferButtonIcon({ id: "btn-result-export-excel-template", text: "Excel" }), "download");
  assert.equal(inferButtonIcon({ id: "btn-dialog-cancel", text: "Bỏ qua" }), "x");
  assert.equal(inferButtonIcon({ text: "KT" }), "");
});

test("dismiss and destructive actions receive consistent semantic variants", () => {
  assert.equal(inferButtonVariant("Hủy"), "cancel");
  assert.equal(inferButtonVariant("Hủy chỉnh sửa"), "cancel");
  assert.equal(inferButtonVariant("Hủy bỏ"), "cancel");
  assert.equal(inferButtonVariant("Đóng"), "secondary");
  assert.equal(inferButtonVariant("Bỏ qua"), "secondary");
  assert.equal(inferButtonVariant("Xóa phần lô"), "danger");
  assert.equal(inferButtonVariant("Xác nhận hủy thầu"), "danger");
  assert.equal(inferButtonVariant("Lưu thông tin"), "");
});
