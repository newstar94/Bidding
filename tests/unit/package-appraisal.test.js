import assert from "node:assert/strict";
import test from "node:test";

import { clearCompetitiveQuotationAppraisal, isCompetitiveQuotationPackage } from "../../frontend/packages/packageAppraisal.js";

test("recognizes competitive quotation packages", () => {
  assert.equal(isCompetitiveQuotationPackage({ hinhThucLuaChon: "Chào hàng cạnh tranh" }), true);
  assert.equal(isCompetitiveQuotationPackage({ hinhThucLuaChon: "Đấu thầu rộng rãi" }), false);
});

test("clears every appraisal field for a competitive quotation package", () => {
  const pkg = {
    hinhThucLuaChon: "Chào hàng cạnh tranh",
    yeuCauThamDinhHsmt: "Có",
    soBaoCaoThamDinhHsmt: "12/BC-TĐ",
    ngayBaoCaoThamDinhHsmt: "2026-07-12",
    toThamDinh: [{ chuyenGiaId: "cg-1" }],
    danhGiaHsdtMetadata: JSON.stringify({
      technical: { soBctdKt: "1", ngayBctdKt: "2026-07-12", qualifiedSaved: true },
      result: { soBctdKetQua: "2", ngayBctdKetQua: "2026-07-13", approved: true }
    })
  };
  clearCompetitiveQuotationAppraisal(pkg);
  assert.deepEqual(pkg, {
    hinhThucLuaChon: "Chào hàng cạnh tranh",
    yeuCauThamDinhHsmt: "Không",
    soBaoCaoThamDinhHsmt: "",
    ngayBaoCaoThamDinhHsmt: "",
    toThamDinh: [],
    danhGiaHsdtMetadata: JSON.stringify({
      technical: { qualifiedSaved: true },
      result: { approved: true }
    })
  });
});

test("keeps appraisal fields for other procurement methods", () => {
  const pkg = { hinhThucLuaChon: "Đấu thầu rộng rãi", yeuCauThamDinhHsmt: "Có" };
  clearCompetitiveQuotationAppraisal(pkg);
  assert.equal(pkg.yeuCauThamDinhHsmt, "Có");
});
