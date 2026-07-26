import assert from "node:assert/strict";
import test from "node:test";

import { buildAwardResultViewModel } from "../../frontend/packages/detail/AwardResultViewModel.js";

const LOTS = [
  { id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Lô 1", sortOrder: 1 },
  { id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Lô 2", sortOrder: 2 },
];

function packageRecord(overrides = {}) {
  return {
    id: "package-1",
    phanLo: "Có",
    phanLoList: LOTS,
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({}),
    ...overrides,
  };
}

function bid(id, lotId, conclusion = "Đạt") {
  return {
    id,
    goiThauId: "package-1",
    nhaThauId: `contractor-${id}`,
    lotId,
    maPhanLo: LOTS.find((lot) => lot.id === lotId)?.maPhanLo || "",
    danhGiaKetLuan: conclusion,
  };
}

test("view model selects a saved pending lot batch and qualified bids", () => {
  const metadata = {
    activeLotBatchId: "batch-active",
    lotBatches: {
      "batch-final": {
        batchId: "batch-final",
        sequenceNo: 1,
        status: "FINAL",
        saved: true,
        lotIds: ["lot-1"],
        result: { saved: true },
      },
      "batch-active": {
        batchId: "batch-active",
        sequenceNo: 2,
        status: "SAVED",
        saved: true,
        lotIds: ["lot-2"],
        result: { soBctdKetQua: "02/BCTĐ" },
      },
    },
  };
  const result = buildAwardResultViewModel({
    pkg: packageRecord({ danhGiaHsdtMetadata: JSON.stringify(metadata) }),
    bids: [bid("bid-1", "lot-1"), bid("bid-2", "lot-2"), bid("bid-3", "lot-2", "Không đạt")],
    isEditable: true,
    editState: { currentBatchId: "batch-active" },
  });

  assert.equal(result.mode, "approval");
  assert.equal(result.activeScopedEvaluation.batchId, "batch-active");
  assert.deepEqual(result.activeScopedEvaluation.lotCodes, ["PL2"]);
  assert.deepEqual(result.scopedBidsForResult.map((item) => item.id), ["bid-2", "bid-3"]);
  assert.deepEqual(result.allBidsForResult.map((item) => item.id), ["bid-2"]);
  assert.equal(result.resultMetadata.soBctdKetQua, "02/BCTĐ");
  assert.equal(result.effectiveEditState.currentBatchId, "batch-active");
});

test("view model exposes history-only mode when no unfinished scope is active", () => {
  const metadata = {
    lotBatches: {
      "batch-final": {
        batchId: "batch-final",
        sequenceNo: 1,
        status: "FINAL",
        saved: true,
        lotIds: ["lot-1"],
        result: { saved: true },
      },
    },
  };
  const result = buildAwardResultViewModel({
    pkg: packageRecord({ danhGiaHsdtMetadata: JSON.stringify(metadata) }),
    bids: [bid("bid-1", "lot-1"), bid("bid-2", "lot-2")],
    isEditable: true,
  });

  assert.equal(result.mode, "history");
  assert.equal(result.activeScopedEvaluation, null);
  assert.equal(result.officialLotState.history.length, 1);
  assert.deepEqual(result.officialLotState.pendingLots.map((lot) => lot.id), ["lot-2"]);
});

test("view model restores persisted official batch editing", () => {
  const metadata = {
    resultEdit: { type: "batch", batchId: "batch-final" },
    lotBatches: {
      "batch-final": {
        batchId: "batch-final",
        sequenceNo: 1,
        status: "FINAL",
        saved: true,
        lotIds: ["lot-1"],
        result: { saved: true, soBctdKetQua: "01/BCTĐ" },
      },
    },
  };
  const result = buildAwardResultViewModel({
    pkg: packageRecord({ danhGiaHsdtMetadata: JSON.stringify(metadata) }),
    bids: [bid("bid-1", "lot-1")],
    isEditable: true,
  });

  assert.equal(result.mode, "approval");
  assert.equal(result.isEditingOfficialResult, true);
  assert.equal(result.editingOfficialScope.batchId, "batch-final");
  assert.equal(result.effectiveEditState.officialBatchId, "batch-final");
  assert.equal(result.effectiveEditState.currentBatchId, "batch-final");
});

test("view model restores persisted whole-package editing only for editable views", () => {
  const pkg = packageRecord({
    phanLo: "Không",
    phanLoList: [],
    trangThai: "Đã có kết quả",
    danhGiaHsdtMetadata: JSON.stringify({
      resultEdit: { type: "whole" },
      result: { saved: true },
    }),
  });

  const editable = buildAwardResultViewModel({
    pkg,
    bids: [bid("bid-1", "")],
    isEditable: true,
  });
  const readonly = buildAwardResultViewModel({
    pkg,
    bids: [bid("bid-1", "")],
    isEditable: false,
  });

  assert.equal(editable.mode, "approval");
  assert.equal(editable.isEditingWholePackageResult, true);
  assert.equal(editable.effectiveEditState.wholePackageId, "package-1");
  assert.equal(readonly.mode, "approval");
  assert.equal(readonly.isEditingWholePackageResult, false);
});

test("completed whole-package result binds frozen contractor versions", () => {
  const pkg = packageRecord({
    phanLo: "Không",
    phanLoList: [],
    trangThai: "Đã có kết quả",
    danhGiaHsdtMetadata: JSON.stringify({
      result: {
        saved: true,
        contractorBindings: [{
          bidId: "bid-1",
          contractorVersionId: "contractor-version-2",
          jointVentureName: "Liên danh A-B",
          memberVersionIds: ["member-version-1", "member-version-2"],
        }],
      },
    }),
  });
  const sourceBid = {
    ...bid("bid-1", ""),
    loaiNhaThau: "Liên danh",
    tenNhaThau: "Tên hiện tại",
    thanhVienLienDanh: [
      { thanhVienNhaThauId: "member-current-1" },
      { thanhVienNhaThauId: "member-current-2" },
    ],
  };

  const result = buildAwardResultViewModel({ pkg, bids: [sourceBid], isEditable: true });

  assert.equal(result.mode, "summary");
  assert.equal(result.boundPackageBidsForResult[0].nhaThauId, "contractor-version-2");
  assert.equal(result.allBidsForResult[0].nhaThauId, "contractor-version-2");
  assert.equal(result.allBidsForResult[0].tenNhaThau, "Liên danh A-B");
  assert.deepEqual(
    result.allBidsForResult[0].thanhVienLienDanh.map((member) => member.thanhVienNhaThauId),
    ["member-version-1", "member-version-2"],
  );
  assert.equal(sourceBid.nhaThauId, "contractor-bid-1");
});

test("malformed metadata is isolated behind a safe default view model", () => {
  for (const metadata of ["{", "null", "[]"]) {
    const result = buildAwardResultViewModel({
      pkg: packageRecord({ danhGiaHsdtMetadata: metadata }),
      bids: [bid("bid-1", "lot-1")],
      isEditable: true,
    });

    assert.deepEqual(result.metadata, { technical: {}, result: {} });
    assert.equal(result.mode, "approval");
  }
});

test("summary infers the only qualified whole-package winner without mutating input", () => {
  const pkg = packageRecord({
    phanLo: "Không",
    phanLoList: [],
    trangThai: "Đã có kết quả",
    nhaThauTrungThauId: "",
    giaTrungThau: 950,
    thoiGianGoiThau: "60 ngày",
    danhGiaHsdtMetadata: JSON.stringify({ result: { saved: true } }),
  });
  const result = buildAwardResultViewModel({
    pkg,
    bids: [bid("bid-qualified", ""), bid("bid-failed", "", "Không đạt")],
    isEditable: true,
  });

  assert.equal(result.summary.inferredPackageWinnerId, "contractor-bid-qualified");
  assert.equal(result.summary.currentWinnerBid.id, "bid-qualified");
  assert.equal(result.summary.bidderRows[0].isWinner, true);
  assert.equal(result.summary.bidderRows[0].awardPrice, 950);
  assert.equal(result.summary.bidderRows[0].packageDuration, "60 ngày");
  assert.equal(pkg.nhaThauTrungThauId, "");
});

test("summary derives lot winners and rejection reasons in stable lot order", () => {
  const pkg = packageRecord({
    trangThai: "Đã có kết quả",
    phanLoList: [
      { ...LOTS[1], nhaThauTrungThauId: "contractor-bid-2", giaTrungThau: 200, thoiGianGoiThau: "40 ngày" },
      { ...LOTS[0], nhaThauTrungThauId: "contractor-bid-1", giaTrungThau: 100, thoiGianGoiThau: "30 ngày" },
    ],
    danhGiaHsdtMetadata: JSON.stringify({ result: { saved: true } }),
  });
  const failed = {
    ...bid("bid-3", "lot-2", "Không đạt"),
    danhGiaHopLe: "Đạt",
    danhGiaNangLuc: "Đạt",
    danhGiaKyThuat: "Không đạt",
  };
  const result = buildAwardResultViewModel({
    pkg,
    bids: [bid("bid-2", "lot-2"), failed, bid("bid-1", "lot-1")],
    isEditable: true,
  });

  assert.equal(result.summary.hasMultipleWinners, true);
  assert.deepEqual(result.summary.uniqueWinnerIds, ["contractor-bid-2", "contractor-bid-1"]);
  assert.deepEqual(result.summary.bidderRows.map((row) => row.bid.id), ["bid-1", "bid-2", "bid-3"]);
  assert.deepEqual(result.summary.bidderRows.slice(0, 2).map((row) => row.awardPrice), [100, 200]);
  assert.equal(result.summary.bidderRows[2].rejectionReason, "Không đạt ở bước: Đánh giá kỹ thuật");
});

test("summary preserves the process-two not-evaluated explanation", () => {
  const pkg = packageRecord({
    phanLo: "Không",
    phanLoList: [],
    trangThai: "Đã có kết quả",
    nhaThauTrungThauId: "contractor-winner",
    quyTrinhDanhGia: "quytrinh2",
    danhGiaHsdtMetadata: JSON.stringify({ result: { saved: true } }),
  });
  const result = buildAwardResultViewModel({
    pkg,
    bids: [{
      ...bid("loser", "", "Không đánh giá"),
      nhaThauId: "contractor-loser",
    }],
    isEditable: true,
  });

  assert.equal(
    result.summary.bidderRows[0].rejectionReason,
    "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",
  );
});
