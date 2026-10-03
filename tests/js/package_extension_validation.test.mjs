import assert from "node:assert/strict";
import test from "node:test";
import { validateExtensionRows } from "../../frontend/packages/packageValidation.js";

const latestClosing = "2026-10-12T09:00:00";
const history = [
  { id: "extension-00", timeStr: "28/09/2026 10:00", reason: "Điều chỉnh E-HSMT", sourcePreviousClosingAt: "2026-09-18T10:00:00" },
  { id: "extension-01a", timeStr: "01/10/2026 10:00", reason: "Trả lời làm rõ" },
  { id: "extension-01b", timeStr: "12/10/2026 09:00", reason: "Sửa đổi E-HSMT" },
];

test("source extension history validates against its original deadline, not the latest notice closing", () => {
  assert.equal(validateExtensionRows(latestClosing, history).valid, true);
});

test("saved historical extensions can be saved again without original source metadata", () => {
  const rows = history.map(({ sourcePreviousClosingAt, ...row }) => row);
  const existingRows = rows.map((row) => ({ id: row.id, thoiGianDongThau: row.timeStr }));
  assert.equal(validateExtensionRows(latestClosing, rows, { existingRows }).valid, true);
});

test("new manual extensions still have to follow the current closing time", () => {
  for (const timeStr of ["01/10/2026 10:00", "12/10/2026 09:00"]) {
    assert.equal(validateExtensionRows(latestClosing, [{ id: "new", timeStr, reason: "Manual" }]).valid, false);
  }
  assert.equal(validateExtensionRows(latestClosing, [{ timeStr: "13/10/2026 09:00", reason: "Manual" }]).valid, true);
});

test("changing a saved first deadline does not gain an exemption from validation", () => {
  const row = { id: "saved", timeStr: "20/09/2026 10:00", reason: "Changed" };
  const existingRows = [{ id: "saved", thoiGianDongThau: "28/09/2026 10:00" }];
  assert.equal(validateExtensionRows(latestClosing, [row], { existingRows }).valid, false);
});

test("source history must progress beyond its prior deadline and every previous extension", () => {
  const first = { ...history[0], timeStr: "18/09/2026 10:00" };
  assert.equal(validateExtensionRows(latestClosing, [first]).rowIndex, 0);
  const reversed = [history[0], history[2], history[1]];
  assert.equal(validateExtensionRows(latestClosing, reversed).rowIndex, 2);
});

test("incomplete extension dates and reasons still prevent saving", () => {
  assert.equal(validateExtensionRows(latestClosing, [{ ...history[0], reason: "" }]).field, "reason");
  assert.equal(validateExtensionRows(latestClosing, [{ ...history[0], timeStr: "invalid" }]).field, "time");
});
