import assert from "node:assert/strict";
import test from "node:test";

import { mergeScopedAwardLotResults } from "../../frontend/packages/lotAwardResultScope.js";
import { buildAwardResultApprovalMarkup } from "../../frontend/packages/detail/AwardResultApprovalMarkup.js";
import {
  beginOfficialResultBatchEdit,
  beginWholePackageResultEdit,
  buildOfficialResultHistoryMarkup,
  shouldFinalizeOfficialResultLifecycle,
} from "../../frontend/packages/detail/AwardResultDetailsPanel.js";

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
  assert.match(html, /Phê duyệt kết quả đợt/);
  assert.doesNotMatch(html, /Lưu nháp/);

  const { html: editHtml } = buildAwardResultApprovalMarkup(view, {
    gt: pkg,
    metadata: { result: {} },
    soBctdResult: "",
    ngayBctdResult: "",
    is1G2T2: false,
    bids: [lotOneBid],
    scopedDraft: {
      label: "đợt PL1",
      lotCodes: ["PL1"],
      sequenceNo: 1,
      isEditingOfficialResult: true,
    },
  });
  assert.match(
    editHtml,
    /official-result-form-actions[\s\S]*id="btn-cancel-official-result-edit"[^>]*>Hủy chỉnh sửa<\/button>[\s\S]*id="btn-approve-award"[\s\S]*data-lucide="save"[\s\S]*Lưu thay đổi/,
  );
  assert.doesNotMatch(editHtml, /scoped-result-context[\s\S]{0,500}id="btn-cancel-official-result-edit"/);
});

test("each editable official result round exposes its own edit action", () => {
  const view = {
    model: {
      state: { thongtinmothau: [] },
      formatCurrency: (value) => String(value || 0),
      formatDate: (value) => String(value || ""),
    },
  };
  const pkg = {
    id: "pkg-1",
    phanLo: "Có",
    phanLoList: [{ id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Phần lô 1" }],
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  };
  const state = {
    history: [{
      batchId: "batch-1",
      sequenceNo: 1,
      lotIds: ["lot-1"],
      lotCodes: ["PL1"],
      result: { saved: true, soQuyetDinhKetQua: "01/QĐ" },
    }],
    pendingLots: [],
  };

  const editableHtml = buildOfficialResultHistoryMarkup(view, pkg, state, {}, { isEditable: true });
  const readonlyHtml = buildOfficialResultHistoryMarkup(view, pkg, state, {}, { isEditable: false });

  assert.match(editableHtml, /data-edit-official-result-batch="batch-1"/);
  assert.match(editableHtml, /class="btn btn-primary action-strong evaluation-round-edit-button"/);
  assert.doesNotMatch(editableHtml, /btn-outline-secondary evaluation-round-edit-button/);
  assert.match(editableHtml, /evaluation-round-table[\s\S]*evaluation-round-action-row[\s\S]*data-edit-official-result-batch="batch-1"/);
  assert.match(editableHtml, /data-lucide="edit-3"/);
  assert.match(editableHtml, />\s*Chỉnh sửa\s*</);
  assert.doesNotMatch(readonlyHtml, /data-edit-official-result-batch/);
});

test("official result history tolerates malformed legacy lot data", () => {
  const view = {
    model: {
      state: { thongtinmothau: [] },
      formatCurrency: (value) => String(value || 0),
      formatDate: (value) => String(value || ""),
    },
  };
  const html = buildOfficialResultHistoryMarkup(
    view,
    {
      id: "pkg-malformed",
      phanLoList: "{",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    },
    {
      history: [{
        batchId: "batch-legacy",
        sequenceNo: 1,
        lotCodes: ["PL1"],
        result: { soQuyetDinhKetQua: "01/QĐ" },
      }],
    },
  );

  assert.match(html, /official-result-history/);
  assert.match(html, /01\/QĐ/);
});

test("clicking an official result edit action selects its batch and rerenders once", () => {
  const view = {};
  const pkg = {
    phanLo: "Có",
    phanLoList: [
      { id: "lot-1", maPhanLo: "PL1" },
      { id: "lot-2", maPhanLo: "PL2" },
    ],
    trangThai: "Đã có kết quả",
    danhGiaHsdtMetadata: JSON.stringify({
      lotBatches: {
        "batch-1": {
          batchId: "batch-1",
          lotIds: ["lot-1"],
          status: "FINAL",
          result: { saved: true },
        },
        "batch-2": {
          batchId: "batch-2",
          lotIds: ["lot-2"],
          status: "FINAL",
          result: { saved: true },
        },
      },
    }),
  };
  let renderCount = 0;

  assert.equal(beginOfficialResultBatchEdit(view, pkg, " batch-2 ", () => {
    renderCount += 1;
  }), true);
  assert.equal(view._editingOfficialResultLotBatchId, "batch-2");
  assert.equal(view._currentResultLotBatchId, "batch-2");
  assert.deepEqual(JSON.parse(pkg.danhGiaHsdtMetadata).resultEdit, {
    type: "batch",
    batchId: "batch-2",
  });
  assert.equal(pkg.trangThai, "Đã có kết quả một phần");
  assert.equal(renderCount, 1);

  assert.equal(beginOfficialResultBatchEdit(view, pkg, " ", () => {
    renderCount += 1;
  }), false);
  assert.equal(renderCount, 1);
});

test("clicking the whole-package result edit action persists its non-final status", () => {
  const view = {};
  const pkg = {
    id: "pkg-1",
    phanLo: "Không",
    trangThai: "Đã có kết quả",
    danhGiaHsdtMetadata: JSON.stringify({ result: { saved: true } }),
  };
  let renderCount = 0;

  assert.equal(beginWholePackageResultEdit(view, pkg, () => {
    renderCount += 1;
  }), true);
  assert.equal(view._editingWholePackageResult, true);
  assert.deepEqual(JSON.parse(pkg.danhGiaHsdtMetadata).resultEdit, { type: "whole" });
  assert.equal(pkg.trangThai, "Đang chấm thầu");
  assert.equal(renderCount, 1);
});

test("editing a finalized result updates metadata without finalizing the closed batch again", () => {
  assert.equal(shouldFinalizeOfficialResultLifecycle({ status: "FINAL" }, true), false);
  assert.equal(shouldFinalizeOfficialResultLifecycle({ status: "CLOSED" }, true), false);
  assert.equal(shouldFinalizeOfficialResultLifecycle({ status: "ACTIVE" }, false), true);
  assert.equal(shouldFinalizeOfficialResultLifecycle({}, true), true);
});
