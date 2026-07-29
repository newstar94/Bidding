import assert from "node:assert/strict";
import test from "node:test";

import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";

const ONE_ENVELOPE = "Một giai đoạn một túi hồ sơ";
const TWO_ENVELOPE = "Một giai đoạn hai túi hồ sơ";

function hasResultTab(pkg) {
  return buildPackageTabs(pkg).tabs.some((tab) => tab.id === "result");
}

test("partial-result status always exposes the result tab for 1G1T and 1G2T", () => {
  for (const phuongThucLuaChon of [ONE_ENVELOPE, TWO_ENVELOPE]) {
    assert.equal(hasResultTab({
      id: "package-1",
      phuongThucLuaChon,
      phanLo: "Không",
      trangThai: "Đã có kết quả một phần",
      danhGiaHsdtMetadata: "",
    }), true, phuongThucLuaChon);
  }
});

test("full-result status keeps the result tab even when legacy metadata is missing", () => {
  for (const phuongThucLuaChon of [ONE_ENVELOPE, TWO_ENVELOPE]) {
    assert.equal(hasResultTab({
      id: "package-1",
      phuongThucLuaChon,
      phanLo: "Không",
      trangThai: "Đã có kết quả",
      danhGiaHsdtMetadata: "",
    }), true, phuongThucLuaChon);
  }
});

test("in-progress packages do not expose the result tab without saved result evidence", () => {
  assert.equal(hasResultTab({
    id: "package-1",
    phuongThucLuaChon: ONE_ENVELOPE,
    phanLo: "Không",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: "",
  }), false);
});
