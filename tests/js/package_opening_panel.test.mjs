import assert from "node:assert/strict";
import test from "node:test";

import { resolvePackageOpeningMode } from "../../frontend/packages/detail/PackageOpeningPanel.js";

test("package opening routes standard lifecycle states to the matching panel", () => {
  assert.equal(resolvePackageOpeningMode({ trangThai: "Chuẩn bị" }), "preparation");
  assert.equal(resolvePackageOpeningMode({ trangThai: "Đang mời thầu" }), "invitation");
  assert.equal(resolvePackageOpeningMode({ trangThai: "Đã mở thầu" }), "opening");
});

test("direct and special selection always opens contractor data", () => {
  [
    "Chỉ định thầu rút gọn",
    "Lựa chọn nhà thầu trong trường hợp đặc biệt",
  ].forEach((selectionMethod) => {
    assert.equal(resolvePackageOpeningMode({
      trangThai: "Chuẩn bị",
      hinhThucLuaChon: selectionMethod,
    }), "opening");
  });
});
