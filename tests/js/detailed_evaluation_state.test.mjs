import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDetailedEvaluationDraft,
  resolveDetailedEvaluationState,
} from "../../frontend/packages/DetailedEvaluationState.js";

function createController({ pkg, bids, currentTab = "unified", canEdit = true } = {}) {
  return {
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: bids,
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => canEdit,
    },
    view: {
      getActiveElement: (id) => (
        id === "danhgiahsdt-goithau-select" ? { value: pkg.id } : null
      ),
    },
    currentDanhGiaTab: currentTab,
    selectedDetailedEvaluationTab: "missing-group",
    selectedEvaluationBidId: "missing-bid",
  };
}

function oneEnvelopePackage(overrides = {}) {
  return {
    id: "pkg-1",
    linhVuc: "Hàng hóa",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    quyTrinhDanhGia: "quytrinh1",
    trangThai: "Đang chấm thầu",
    ...overrides,
  };
}

test("state resolver selects a valid bidder/group and creates an empty configurable draft", () => {
  const pkg = oneEnvelopePackage();
  const bids = [
    { id: "bid-1", goiThauId: pkg.id, tenNhaThau: "Nhà thầu A" },
    { id: "bid-2", goiThauId: pkg.id, tenNhaThau: "Nhà thầu B" },
  ];
  const controller = createController({ pkg, bids });
  const state = resolveDetailedEvaluationState(controller);

  assert.equal(controller.selectedEvaluationBidId, "bid-1");
  assert.equal(controller.selectedDetailedEvaluationTab, "validity");
  assert.equal(state.bid.id, "bid-1");
  assert.equal(state.report.trangThai, "draft");
  assert.deepEqual(state.criteria, []);
  assert.deepEqual(state.report.chiTietList, []);
  assert.deepEqual(controller._detailedEvaluationDrafts.get(state.draftKey), state.report);
});

test("criteria override is the canonical source for a newly configured report", () => {
  const pkg = oneEnvelopePackage();
  const bids = [{ id: "bid-1", goiThauId: pkg.id }];
  const controller = createController({ pkg, bids });
  controller.selectedEvaluationBidId = "bid-1";
  controller.selectedDetailedEvaluationTab = "validity";
  controller._detailedEvaluationCriteriaOverrides = new Map([[`${pkg.id}:single`, [{
    id: "criterion-1",
    code: "CUSTOM_1",
    name: "Tiêu chí tự cấu hình",
    group: "validity",
    resultType: "pass_fail",
    required: true,
    order: 0,
    source: "custom",
    isCustom: true,
  }]]]);

  const state = resolveDetailedEvaluationState(controller);

  assert.equal(state.criteria.length, 1);
  assert.equal(state.criteria[0].name, "Tiêu chí tự cấu hình");
  assert.equal(state.report.chiTietList[0].tieuChiDanhGiaId, "criterion-1");
  assert.equal(Object.hasOwn(state.report.chiTietList[0], "lyDoKhongDat"), false);
});

test("financial round contains only technically qualified bidders", () => {
  const pkg = oneEnvelopePackage({
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true },
      financial: { saved: false },
    }),
    thoiGianMoEhsdxtc: "2026-07-26T09:00:00",
  });
  const bids = [
    { id: "qualified", goiThauId: pkg.id, danhGiaKetLuan: "Đạt" },
    { id: "failed", goiThauId: pkg.id, danhGiaKetLuan: "Không đạt" },
  ];
  const controller = createController({ pkg, bids, currentTab: "financial" });
  const state = resolveDetailedEvaluationState(controller);

  assert.equal(state.roundType, "financial");
  assert.deepEqual(state.rawBids.map((bid) => bid.id), ["qualified"]);
  assert.equal(state.context.visibleGroups[0], "financial");
  assert.equal(controller.selectedDetailedEvaluationTab, "financial");
});

test("completed report can reopen only when stage and permission allow it", () => {
  const pkg = oneEnvelopePackage();
  const completed = buildDetailedEvaluationDraft({
    pkg,
    bid: { id: "bid-1" },
    roundType: "single",
  });
  completed.trangThai = "completed";
  const bids = [{
    id: "bid-1",
    goiThauId: pkg.id,
    baoCaoDanhGiaChiTietList: [completed],
  }];
  const controller = createController({ pkg, bids });
  controller.selectedEvaluationBidId = "bid-1";
  controller.selectedDetailedEvaluationTab = "validity";
  const locked = resolveDetailedEvaluationState(controller);
  controller._editingDetailedEvaluationKey = locked.draftKey;
  const editing = resolveDetailedEvaluationState(controller);

  assert.equal(locked.canReopen, true);
  assert.equal(locked.readOnly, true);
  assert.equal(editing.readOnly, false);

  const viewOnly = createController({ pkg, bids, canEdit: false });
  viewOnly.selectedEvaluationBidId = "bid-1";
  viewOnly.selectedDetailedEvaluationTab = "validity";
  const denied = resolveDetailedEvaluationState(viewOnly);
  assert.equal(denied.canReopen, false);
  assert.equal(denied.readOnly, true);
});
