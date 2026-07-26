import assert from "node:assert/strict";
import test from "node:test";

import { getLotWinnersStore } from "../../frontend/shared/runtimeState.js";
import { getJvData } from "../../frontend/packages/jvDataStore.js";
import { buildAwardResultSummaryPresentation } from "../../frontend/packages/detail/AwardResultSummaryPresentation.js";

function model(contractors = []) {
  return {
    state: { nhathau: contractors },
    formatCurrency: (value) => `${value} đ`,
  };
}

test("summary presentation infers a whole-package winner and renders both outcomes", () => {
  const pkg = { id: "pkg-1", nhaThauTrungThauId: "" };
  const winner = {
    id: "bid-1",
    nhaThauId: "contractor-1",
    tenNhaThau: "Nhà thầu Một",
    maNhaThau: "0101",
    loaiNhaThau: "Độc lập",
  };
  const loser = {
    id: "bid-2",
    nhaThauId: "contractor-2",
    tenNhaThau: "Nhà thầu Hai",
    maNhaThau: "0202",
    loaiNhaThau: "Độc lập",
  };
  const result = buildAwardResultSummaryPresentation({
    model: model([
      { id: "contractor-1", tenNhaThau: "Nhà thầu Một", maSoThue: "0101" },
      { id: "contractor-2", tenNhaThau: "Nhà thầu Hai", maSoThue: "0202" },
    ]),
    pkg,
    allBids: [winner, loser],
    summary: {
      inferredPackageWinnerId: "contractor-1",
      hasMultipleWinners: false,
      currentWinnerBid: winner,
      isLotPackage: false,
      bidderRows: [
        {
          bid: winner,
          index: 0,
          isWinner: true,
          awardPrice: 100,
          packageDuration: "30 ngày",
          rejectionReason: "",
        },
        {
          bid: loser,
          index: 1,
          isWinner: false,
          awardPrice: 0,
          packageDuration: "",
          rejectionReason: "Xếp hạng sau",
        },
      ],
    },
  });

  assert.equal(pkg.nhaThauTrungThauId, "contractor-1");
  assert.match(result.winnerHtml, /show-contractor-modal/);
  assert.match(result.winnerHtml, /0101/);
  assert.match(result.bidderRowsHtml, /100 đ/);
  assert.match(result.bidderRowsHtml, /Trúng thầu/);
  assert.match(result.bidderRowsHtml, /Trượt thầu/);
  assert.match(result.bidderRowsHtml, /Xếp hạng sau/);
  assert.doesNotMatch(result.tableHeaderHtml, /Mã phần lô/);
});

test("multiple-lot presentation matches contractor ids across string and number forms", () => {
  const pkg = { id: "pkg-lots", nhaThauTrungThauId: "" };
  const bidder = {
    id: "bid-1",
    nhaThauId: 123,
    tenNhaThau: "Nhà thầu theo lô",
    loaiNhaThau: "Độc lập",
  };
  const result = buildAwardResultSummaryPresentation({
    model: model([{ id: 123, tenNhaThau: "Tên từ danh mục" }]),
    pkg,
    allBids: [bidder],
    summary: {
      inferredPackageWinnerId: "",
      hasMultipleWinners: true,
      currentWinnerBid: null,
      isLotPackage: true,
      winningLots: [{
        maPhanLo: "PL1",
        tenPhanLo: "Phần lô 1",
        nhaThauTrungThauId: "123",
        giaTrungThau: 200,
      }],
      bidderRows: [{
        bid: { ...bidder, maPhanLo: "PL1", tenPhanLo: "Phần lô 1" },
        index: 0,
        isWinner: true,
        awardPrice: 200,
        packageDuration: "45 ngày",
        rejectionReason: "",
      }],
    },
  });

  assert.match(result.winnerHtml, /show-lot-winners/);
  assert.match(result.tableHeaderHtml, /Mã phần lô/);
  assert.equal(getLotWinnersStore()[pkg.id][0].tenNhaThau, "Tên từ danh mục");
});

test("joint-venture summary rows register their modal data", () => {
  const pkg = { id: "pkg-jv", nhaThauTrungThauId: "jv-1" };
  const jointVenture = {
    id: "bid-jv",
    nhaThauId: "lead-1",
    tenNhaThau: "Liên danh A-B",
    loaiNhaThau: "Liên danh",
    thanhVienLienDanh: [
      { thanhVienNhaThauId: "lead-1", vaiTro: "Đứng đầu liên danh" },
      { thanhVienNhaThauId: "member-1", vaiTro: "Thành viên liên danh" },
    ],
  };
  const result = buildAwardResultSummaryPresentation({
    model: model([
      { id: "lead-1", tenNhaThau: "Nhà thầu A", maNhaThau: "A01" },
      { id: "member-1", tenNhaThau: "Nhà thầu B", maNhaThau: "B01" },
    ]),
    pkg,
    allBids: [jointVenture],
    summary: {
      inferredPackageWinnerId: "",
      hasMultipleWinners: false,
      currentWinnerBid: jointVenture,
      isLotPackage: false,
      bidderRows: [{
        bid: jointVenture,
        index: 0,
        isWinner: true,
        awardPrice: 300,
        packageDuration: "60 ngày",
        rejectionReason: "",
      }],
    },
  });

  assert.match(result.winnerHtml, /show-jv/);
  assert.match(result.bidderRowsHtml, /Liên danh A-B/);
  assert.equal(getJvData("pkg-jv")?.leadName, "Nhà thầu A");
  assert.equal(getJvData("pkg-jv_result_bidder_0")?.members[0]?.tenNhaThau, "Nhà thầu B");
});
