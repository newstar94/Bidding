import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveDetailedEvaluationState,
} from "../../frontend/packages/DetailedEvaluationState.js";
import {
  buildBidEvaluationPanelState,
} from "../../frontend/packages/BidEvaluationPanelState.js";
import {
  filterBidsByEvaluationLotScope,
} from "../../frontend/packages/lotEvaluationScope.js";

function controllerForSelectedLotScope() {
  const pkg = {
    id: "package-1",
    linhVuc: "Hàng hóa",
    phanLo: "Có",
    phanLoList: [
      { id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Lô 1" },
      { id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Lô 2" },
    ],
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: {},
  };
  const bids = [
    { id: "bid-pl1", goiThauId: pkg.id, maPhanLo: "PL1", tenPhanLo: "Lô 1", tenNhaThau: "Nhà thầu 1" },
    { id: "bid-pl2", goiThauId: pkg.id, maPhanLo: "PL2", tenPhanLo: "Lô 2", tenNhaThau: "Nhà thầu 2" },
  ];
  return {
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: "bid-pl2",
    _evaluationLotScopes: {
      "package-1:unified": {
        mode: "selected",
        selectedLotIds: ["lot-1"],
        availableLotIds: ["lot-1", "lot-2"],
        batchId: null,
      },
    },
    view: {
      _editingState: {},
      getActiveElement: (id) => id === "danhgiahsdt-goithau-select"
        ? { value: pkg.id }
        : null,
    },
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: bids,
        hanghoaduthaunhathau: [],
        activeuser: { id: "user-1" },
      },
      hasPermission: () => true,
    },
  };
}

test("detailed evaluation bidder selector only includes bids in the active lot scope", () => {
  const controller = controllerForSelectedLotScope();
  const pkg = controller.model.state.goithau[0];
  const panelState = buildBidEvaluationPanelState({
    pkg,
    requestedTab: controller.currentDanhGiaTab,
    editingState: controller.view._editingState,
    cachedScopes: controller._evaluationLotScopes,
  });

  assert.deepEqual(panelState.lotScope.selectedLotIds, ["lot-1"]);
  assert.deepEqual(
    filterBidsByEvaluationLotScope(
      controller.model.state.thongtinmothau,
      pkg,
      panelState.lotScope,
    ).map((bid) => bid.id),
    ["bid-pl1"],
  );

  const state = resolveDetailedEvaluationState(controller);

  assert.deepEqual(state.bids.map((bid) => bid.id), ["bid-pl1"]);
  assert.deepEqual(state.rawBids.map((bid) => bid.id), ["bid-pl1"]);
  assert.equal(state.selectedBidId, "bid-pl1");
  assert.equal(state.bid.id, "bid-pl1");
});
