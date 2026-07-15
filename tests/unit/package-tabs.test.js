import test from "node:test";
import assert from "node:assert/strict";
import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";

const ids = (result) => result.tabs.map((tab) => tab.id);

test("single-envelope package tabs follow saved evaluation state", () => {
  const result = buildPackageTabs({
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    danhGiaHsdtMetadata: JSON.stringify({ saved: true })
  }, []);
  assert.deepEqual(ids(result), ["preparation", "opening", "eval_tech", "result"]);
});

test("two-envelope package tabs open financial stages only after required saves", () => {
  const result = buildPackageTabs({
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: true },
      financial: { saved: true }
    })
  }, [{ danhGiaKetLuan: "Đạt", giaDuThau: 100 }]);
  assert.deepEqual(ids(result), ["preparation", "opening_tech", "eval_tech", "qualified", "opening_fin", "eval_fin", "result"]);
});

test("cancel tab remains available for stored cancellation details", () => {
  const result = buildPackageTabs({
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    danhGiaHsdtMetadata: JSON.stringify({ cancelDetails: { lyDoHuyThau: "Không có nhà thầu đạt" } })
  });
  assert.equal(ids(result).at(-1), "cancel");
});
