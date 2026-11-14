import assert from "node:assert/strict";
import test from "node:test";

import { buildEvaluationPriceCells } from "../../frontend/packages/BidEvaluationPriceCells.js";
import { resolveEvaluationPriceDefaults } from "../../frontend/packages/bidEvaluationPriceDefaults.js";
import { formatVND, parseVND } from "../../frontend/shared/formatters.js";

const model = { formatVND, parseVND };
const pkg = { phanLo: "Không", giaGoiThau: 1_000_000 };

test("empty evaluation prices default to the discounted price", () => {
  const defaults = resolveEvaluationPriceDefaults({ giaSauGiamGia: 900_000 });
  assert.deepEqual(defaults.ranking, { value: "900000", auto: true, source: "discounted" });
  assert.deepEqual(defaults.proposedAward, { value: "900000", auto: true, source: "discounted" });
});

test("ranking price uses the price after discount and preference once the preference is official", () => {
  const bid = {
    giaSauGiamGia: 900_000,
    giaSoSanhSauUuDai: "967500",
    trangThaiTinhUuDai: "ready",
  };
  assert.equal(resolveEvaluationPriceDefaults(bid).ranking.value, "967500");
  // A ranking price previously auto-filled with the discounted price follows the preference.
  assert.equal(resolveEvaluationPriceDefaults({ ...bid, giaXepHang: 900_000 }).ranking.value, "967500");
  // Proposed award price stays the discounted price.
  assert.equal(resolveEvaluationPriceDefaults(bid).proposedAward.value, "900000");
  // Draft or stale preference results are not used.
  assert.equal(resolveEvaluationPriceDefaults({ ...bid, trangThaiTinhUuDai: "stale" }).ranking.value, "900000");
});

test("manually entered prices are kept", () => {
  const defaults = resolveEvaluationPriceDefaults({
    giaSauGiamGia: 900_000,
    giaXepHang: 880_000,
    giaDeNghiTrungThau: 870_000,
  });
  assert.deepEqual(defaults.ranking, { value: 880_000, auto: false, source: "" });
  assert.deepEqual(defaults.proposedAward, { value: 870_000, auto: false, source: "" });
});

test("editable price cells are prefilled but remain editable inputs", () => {
  const html = buildEvaluationPriceCells({
    pkg,
    bid: { id: "bid-1", giaSauGiamGia: 900_000 },
    model,
    rowReadOnly: false,
  });
  assert.match(html, /class="form-control mt-gia-xep-hang" value="900\.000"[^>]*data-price-auto="true"/);
  assert.match(html, /class="form-control mt-gia-de-nghi-trung-thau" value="900\.000"[^>]*data-price-auto="true"/);
  assert.doesNotMatch(html, /readonly/);
});

test("read-only price cells show only saved values", () => {
  const html = buildEvaluationPriceCells({
    pkg,
    bid: { id: "bid-1", giaSauGiamGia: 900_000 },
    model,
    rowReadOnly: true,
  });
  assert.doesNotMatch(html, /900\.000/);
});

test("ranking price auto-fills the price after preference and recalculation never adds it twice", async () => {
  const { calculateBidderGoodsPreference } = await import("../../frontend/packages/bidderGoodsPreference.js");
  const lines = [
    { id: "a", khoiLuong: 1, thanhTienDuThau: "600000000", maUuDai: 3 },
    { id: "b", khoiLuong: 1, thanhTienDuThau: "400000000", maUuDai: 0 },
  ];
  const bid = { tyLeGiamGia: 10, giaSauGiamGia: 900_000_000, giaXepHang: 900_000_000 };
  for (let round = 0; round < 3; round += 1) {
    const result = calculateBidderGoodsPreference(lines, {
      discountRatePercent: String(bid.tyLeGiamGia),
      scopeAfterDiscount: bid.giaSauGiamGia,
    });
    Object.assign(bid, {
      giaSoSanhSauUuDai: result.giaSoSanhSauUuDai,
      giaDanhGiaSauUuDai: result.giaDanhGiaSauUuDai,
      trangThaiTinhUuDai: "ready",
    });
    bid.giaXepHang = resolveEvaluationPriceDefaults(bid).ranking.value;
    assert.equal(result.giaDanhGiaSauUuDai, "936000000");
    assert.equal(bid.giaXepHang, "936000000");
  }
  // A ranking price typed by the user is kept as-is.
  assert.equal(resolveEvaluationPriceDefaults({ ...bid, giaXepHang: 950_000_000 }).ranking.value, 950_000_000);
});

test("evaluated price method reminds that the automatic ranking price excludes ΔG", () => {
  const bid = { id: "bid-1", giaSauGiamGia: 900_000_000, giaSoSanhSauUuDai: "936000000", trangThaiTinhUuDai: "ready" };
  const evaluated = buildEvaluationPriceCells({
    pkg: { ...pkg, phuongPhapDanhGia: "Giá đánh giá" }, bid, model, rowReadOnly: false,
  });
  assert.match(evaluated, /value="936\.000\.000"[^>]*data-price-auto="true"/);
  assert.match(evaluated, /data-evaluated-price-hint="true"[^>]*>[^<]*ΔG/);

  const lowestPrice = buildEvaluationPriceCells({
    pkg: { ...pkg, phuongPhapDanhGia: "Giá thấp nhất" }, bid, model, rowReadOnly: false,
  });
  assert.doesNotMatch(lowestPrice, /data-evaluated-price-hint/);

  // A typed giá đánh giá (G + ΔG + ưu đãi) is final: kept as-is and no reminder.
  const typed = buildEvaluationPriceCells({
    pkg: { ...pkg, phuongPhapDanhGia: "Giá đánh giá" },
    bid: { ...bid, giaXepHang: 980_000_000 },
    model,
    rowReadOnly: false,
  });
  assert.match(typed, /value="980\.000\.000"[^>]*data-price-auto="false"/);
  assert.doesNotMatch(typed, /data-evaluated-price-hint/);
});
