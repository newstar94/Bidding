import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProcurementPartnerName } from "../../frontend/procurement/partnerNameCase.js";

test("casing-only procurement partner normalization preserves acronyms", () => {
  assert.equal(
    normalizeProcurementPartnerName("CÔNG TY TNHH DƯỢC PHẨM THANH PHƯỢNG"),
    "Công ty TNHH Dược phẩm Thanh Phượng",
  );
  assert.equal(normalizeProcurementPartnerName("Công ty TNHH ABC"), "Công ty TNHH ABC");
  assert.equal(normalizeProcurementPartnerName("CÔNG TY 123 ABC"), "Công ty 123 Abc");
  assert.equal(normalizeProcurementPartnerName("Công ty Hdn ABC"), "Công ty HDN ABC");
  assert.equal(
    normalizeProcurementPartnerName("CÔNG TY TNHH DƯỢC PHẨM SANTA VIỆT NAM"),
    "Công ty TNHH Dược phẩm Santa Việt Nam",
  );
});

test("casing-only procurement partner normalization keeps the conjunction và lowercase", () => {
  assert.equal(
    normalizeProcurementPartnerName(
      "CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÀI NGUYÊN VÀ MÔI TRƯỜNG VIỆT NAM",
    ),
    "Công ty Cổ phần Đầu tư Phát triển Công Nghệ Tài Nguyên và Môi Trường Việt Nam",
  );
});
