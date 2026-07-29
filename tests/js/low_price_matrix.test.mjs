import test from "node:test";
import assert from "node:assert/strict";

import { calculateRankings } from "../../frontend/shared/BiddingCalculations.js";
import {
  getLowPriceRejectionReason,
  isLowPriceBidRejected,
  isProposedAwardPriceBelowHalf,
  normalizeLowPriceAcceptance,
} from "../../frontend/packages/bidEvaluationLowPriceRules.js";

const packageWithoutLots = {
  linhVuc: "Xây lắp",
  phanLo: "Không",
  giaGoiThau: 1_000,
  phuongPhapDanhGia: "Giá thấp nhất",
};

test("LP-01..LP-09 use a strict positive below-half boundary", () => {
  const cases = [
    ["LP-01", 1_000, false],
    ["LP-02", 501, false],
    ["LP-03", 500, false],
    ["LP-04", 499, true],
    ["LP-05", 490, true],
    ["LP-06", 300, true],
    ["LP-07", 1, true],
    ["LP-08", 0, false],
    ["LP-09", -1, false],
  ];
  for (const [id, price, expected] of cases) {
    assert.equal(
      isProposedAwardPriceBelowHalf(packageWithoutLots, {}, price),
      expected,
      id,
    );
  }
});

test("LP-12 and LP-13 compare against the matching lot or whole package only", () => {
  const packageWithLots = {
    ...packageWithoutLots,
    phanLo: "Có",
    giaGoiThau: 10_000,
    phanLoList: [
      { maPhanLo: "L1", giaTriPhanLo: 300 },
      { maPhanLo: "L2", giaTriPhanLo: 800 },
    ],
  };
  assert.equal(isProposedAwardPriceBelowHalf(packageWithLots, { maPhanLo: "L1" }, 149), true);
  assert.equal(isProposedAwardPriceBelowHalf(packageWithLots, { maPhanLo: "L1" }, 151), false);
  assert.equal(isProposedAwardPriceBelowHalf(packageWithLots, { maPhanLo: "L2" }, 399), true);
  assert.match(getLowPriceRejectionReason(packageWithLots, { maPhanLo: "L2" }, 399), /giá phần lô/);
  assert.match(getLowPriceRejectionReason(packageWithoutLots, {}, 499), /giá gói thầu/);
});

test("LP-10 and LP-11 use the final proposed award price after discount and correction", () => {
  const discountedBid = {
    giaDuThau: 800,
    giaSauGiamGia: 400,
    giaDeNghiTrungThau: 400,
  };
  assert.equal(isProposedAwardPriceBelowHalf(packageWithoutLots, discountedBid), true);

  const correctedBid = {
    giaDuThau: 800,
    giaSauGiamGia: 600,
    giaTriHieuChinh: -201,
    giaDeNghiTrungThau: 399,
  };
  assert.equal(isProposedAwardPriceBelowHalf(packageWithoutLots, correctedBid), true);
  assert.equal(
    isProposedAwardPriceBelowHalf(packageWithoutLots, correctedBid, 500),
    false,
    "the strict boundary still applies to the corrected final price",
  );
});

test("LP-16 and LP-17 acceptance controls rejection and reranking", () => {
  const accepted = {
    id: "accepted",
    danhGiaKetLuan: "Đạt",
    giaXepHang: 100,
    giaDeNghiTrungThau: 400,
    chapThuanGiaDeNghiTrungThauDuoi50: true,
  };
  const rejected = {
    id: "rejected",
    danhGiaKetLuan: "Đạt",
    giaXepHang: 90,
    giaDeNghiTrungThau: 400,
    chapThuanGiaDeNghiTrungThauDuoi50: false,
  };
  const next = {
    id: "next",
    danhGiaKetLuan: "Đạt",
    giaXepHang: 110,
    giaDeNghiTrungThau: 600,
  };
  assert.equal(isLowPriceBidRejected(packageWithoutLots, accepted), false);
  assert.equal(isLowPriceBidRejected(packageWithoutLots, rejected), true);
  assert.deepEqual(calculateRankings(packageWithoutLots, [rejected, next]).rankings, { next: 1 });
  assert.deepEqual(calculateRankings(packageWithoutLots, [accepted, next]).rankings, { accepted: 1, next: 2 });
  assert.equal(normalizeLowPriceAcceptance("Chấp thuận"), true);
  assert.equal(normalizeLowPriceAcceptance("Không chấp thuận"), false);
  assert.equal(normalizeLowPriceAcceptance(""), null);
});

test("LP-19 and LP-20 recalculate the warning after every proposed-price change", () => {
  assert.equal(isProposedAwardPriceBelowHalf(packageWithoutLots, {}, 400), true);
  assert.equal(isProposedAwardPriceBelowHalf(packageWithoutLots, {}, 500), false);
  assert.equal(isProposedAwardPriceBelowHalf(packageWithoutLots, {}, 600), false);
  assert.equal(isProposedAwardPriceBelowHalf(packageWithoutLots, {}, 499), true);
});

test("LP-30 promotes the next qualified bidder when the cheaper bid is rejected", () => {
  const rejected = {
    id: "first",
    danhGiaKetLuan: "Đạt",
    giaXepHang: 100,
    giaDeNghiTrungThau: 400,
    chapThuanGiaDeNghiTrungThauDuoi50: false,
  };
  const second = {
    id: "second",
    danhGiaKetLuan: "Đạt",
    giaXepHang: 200,
    giaDeNghiTrungThau: 600,
  };
  const third = {
    id: "third",
    danhGiaKetLuan: "Đạt",
    giaXepHang: 300,
    giaDeNghiTrungThau: 700,
  };
  assert.deepEqual(
    calculateRankings(packageWithoutLots, [rejected, second, third]).rankings,
    { second: 1, third: 2 },
  );
});

test("LP-29 rejects only the affected lot and keeps rankings isolated", () => {
  const packageWithLots = {
    ...packageWithoutLots,
    phanLo: "Có",
    phanLoList: [
      { maPhanLo: "L1", giaTriPhanLo: 1_000 },
      { maPhanLo: "L2", giaTriPhanLo: 2_000 },
    ],
  };
  const bids = [
    {
      id: "l1-rejected",
      maPhanLo: "L1",
      danhGiaKetLuan: "Đạt",
      giaXepHang: 100,
      giaDeNghiTrungThau: 400,
      chapThuanGiaDeNghiTrungThauDuoi50: false,
    },
    {
      id: "l1-next",
      maPhanLo: "L1",
      danhGiaKetLuan: "Đạt",
      giaXepHang: 600,
      giaDeNghiTrungThau: 600,
    },
    {
      id: "l2-first",
      maPhanLo: "L2",
      danhGiaKetLuan: "Đạt",
      giaXepHang: 1_100,
      giaDeNghiTrungThau: 1_100,
    },
  ];
  assert.deepEqual(calculateRankings(packageWithLots, bids).rankings, {
    "l1-next": 1,
    "l2-first": 1,
  });
});
