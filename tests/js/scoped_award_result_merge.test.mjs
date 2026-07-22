import assert from "node:assert/strict";
import test from "node:test";

import { mergeScopedAwardLotResults } from "../../frontend/packages/lotAwardResultScope.js";
import { buildAwardResultApprovalMarkup } from "../../frontend/packages/detail/AwardResultApprovalMarkup.js";

test("a scoped lot without a winner is cleared without changing an out-of-scope award", () => {
  const selectedLot = {
    id: "lot-1",
    maPhanLo: "PL1",
    tenPhanLo: "Phần lô 1",
    nhaThauTrungThauId: "contractor-old",
    giaTrungThau: 100,
    thoiGianGoiThau: "30 ngày",
    thoiGianHopDong: "40 ngày",
  };
  const untouchedLot = {
    id: "lot-2",
    maPhanLo: "PL2",
    tenPhanLo: "Phần lô 2",
    nhaThauTrungThauId: "contractor-2",
    giaTrungThau: 250,
    auditMarker: { revision: 7 },
  };

  const result = mergeScopedAwardLotResults({
    phanLoList: [selectedLot, untouchedLot],
    scope: { lotIds: ["lot-1"], lotCodes: ["PL1"] },
    scopedLotResults: [],
  });

  assert.deepEqual(result.phanLoList[0], {
    ...selectedLot,
    nhaThauTrungThauId: "",
    giaTrungThau: 0,
    thoiGianGoiThau: "",
    thoiGianHopDong: "",
  });
  assert.equal(result.phanLoList[1], untouchedLot);
  assert.equal(result.nhaThauTrungThauId, "contractor-2");
  assert.equal(result.giaTrungThau, 250);
  assert.equal(selectedLot.nhaThauTrungThauId, "contractor-old");
});

test("immutable lot id is authoritative and code fallback is limited to legacy lots without an id", () => {
  const stableLot = {
    id: "lot-stable",
    maPhanLo: "PL1",
    nhaThauTrungThauId: "contractor-old",
    giaTrungThau: 100,
  };
  const legacyLot = {
    maPhanLo: " PL2 ",
    nhaThauTrungThauId: "",
    giaTrungThau: 0,
  };

  const result = mergeScopedAwardLotResults({
    phanLoList: [stableLot, legacyLot],
    scope: {
      lotIds: ["lot-stable"],
      lotCodes: ["PL1", "pl2"],
    },
    scopedLotResults: [
      {
        id: "different-lot-id",
        maPhanLo: "PL1",
        nhaThauTrungThauId: "contractor-wrong",
        giaTrungThau: 999,
      },
      {
        maPhanLo: "PL2",
        nhaThauTrungThauId: "contractor-legacy",
        giaTrungThau: 75,
      },
    ],
  });

  assert.equal(result.phanLoList[0].nhaThauTrungThauId, "");
  assert.equal(result.phanLoList[0].giaTrungThau, 0);
  assert.equal(result.phanLoList[1].nhaThauTrungThauId, "contractor-legacy");
  assert.equal(result.phanLoList[1].giaTrungThau, 75);
  assert.equal(result.nhaThauTrungThauId, "contractor-legacy");
  assert.equal(result.giaTrungThau, 75);
});

test("multiple lot winners keep the package winner projection unambiguous and sum the full merged price", () => {
  const existingAward = {
    id: "lot-1",
    maPhanLo: "PL1",
    nhaThauTrungThauId: "contractor-a",
    giaTrungThau: 120,
  };
  const pendingLot = {
    id: "lot-2",
    maPhanLo: "PL2",
    nhaThauTrungThauId: "",
    giaTrungThau: 0,
  };

  const result = mergeScopedAwardLotResults({
    phanLoList: [existingAward, pendingLot],
    scope: { lotIds: ["lot-2"], lotCodes: ["PL2"] },
    scopedLotResults: [{
      id: "lot-2",
      maPhanLo: "PL2",
      nhaThauTrungThauId: "contractor-b",
      giaTrungThau: 80,
      thoiGianGoiThau: "60 ngày",
    }],
  });

  assert.equal(result.phanLoList[0], existingAward);
  assert.equal(result.phanLoList[1].nhaThauTrungThauId, "contractor-b");
  assert.equal(result.nhaThauTrungThauId, "");
  assert.equal(result.giaTrungThau, 200);
});

test("scoped award markup renders only bidder rows from the selected lot batch", () => {
  const lotOneBid = {
    id: "bid-1",
    goiThauId: "pkg-1",
    lotId: "lot-1",
    maPhanLo: "PL1",
    tenPhanLo: "Phần lô 1",
    maNhaThau: "NT1",
    tenNhaThau: "Nhà thầu 1",
    nhaThauId: "contractor-1",
    danhGiaKetLuan: "Đạt",
    giaDuThau: 100,
  };
  const lotTwoBid = {
    ...lotOneBid,
    id: "bid-2",
    lotId: "lot-2",
    maPhanLo: "PL2",
    tenPhanLo: "Phần lô 2",
    maNhaThau: "NT2",
    tenNhaThau: "Nhà thầu 2",
  };
  const view = {
    model: {
      state: { thongtinmothau: [lotOneBid, lotTwoBid], chudautu: [] },
      getLatestPlan: () => null,
      formatCurrency: (value) => String(value || 0),
      formatDateWithTime: (value) => String(value || ""),
      formatForDateInput: (value) => String(value || ""),
      formatVND: (value) => String(value || ""),
    },
  };
  const pkg = {
    id: "pkg-1",
    phanLo: "Có",
    phanLoList: [
      { id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Phần lô 1" },
      { id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Phần lô 2" },
    ],
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  };

  const { html, allBids } = buildAwardResultApprovalMarkup(view, {
    gt: pkg,
    metadata: { result: {} },
    soBctdResult: "",
    ngayBctdResult: "",
    is1G2T2: false,
    bids: [lotOneBid],
    scopedDraft: { label: "đợt PL1", lotCodes: ["PL1"] },
  });

  assert.deepEqual(allBids.map((bid) => bid.id), ["bid-1"]);
  assert.match(html, /Nhà thầu 1/);
  assert.doesNotMatch(html, /Nhà thầu 2/);
  assert.match(html, /Lưu nháp kết quả đợt phần lô/);
});
