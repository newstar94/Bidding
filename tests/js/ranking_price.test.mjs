import assert from "node:assert/strict";
import test from "node:test";

import { calculateRankings } from "../../frontend/shared/BiddingCalculations.js";

test("goods and mixed packages rank by explicit ranking price without preference blocking", () => {
  const bids = [
    { id: "a", danhGiaKetLuan: "Đạt", danhGiaKyThuat: "Đạt", giaXepHang: 120, giaSoSanhSauUuDai: 90, giaDanhGiaSauUuDai: 90, trangThaiTinhUuDai: "draft" },
    { id: "b", danhGiaKetLuan: "Đạt", danhGiaKyThuat: "Đạt", giaXepHang: 110, giaSoSanhSauUuDai: 100, giaDanhGiaSauUuDai: 100, trangThaiTinhUuDai: "draft" },
  ];
  for (const linhVuc of ["Hàng hóa", "Hỗn hợp", "Xây lắp", "Phi tư vấn", "Tư vấn"]) {
    const methods = linhVuc === "Tư vấn" ? ["Giá thấp nhất"] : ["Giá thấp nhất", "Giá đánh giá"];
    for (const phuongPhapDanhGia of methods) {
      const pkg = { linhVuc, phuongPhapDanhGia, phanLo: "Không" };
      const label = `${linhVuc} / ${phuongPhapDanhGia}`;
      assert.deepEqual(calculateRankings(pkg, bids).rankings, { b: 1, a: 2 }, label);
      assert.deepEqual(calculateRankings(pkg, [{
        id: "preference-only",
        danhGiaKetLuan: "Đạt",
        giaSoSanhSauUuDai: 1,
        giaDanhGiaSauUuDai: 1,
        trangThaiTinhUuDai: "ready",
      }]).rankings, {}, `${label} must not fall back to preference prices`);
    }
  }
});
