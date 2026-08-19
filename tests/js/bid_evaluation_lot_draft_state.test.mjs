import test from "node:test";
import assert from "node:assert/strict";

import { buildBidEvaluationPanelState } from "../../frontend/packages/BidEvaluationPanelState.js";

const pkg = {
  id: "pkg-lot",
  phanLo: "Có",
  phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  phanLoList: JSON.stringify([
    { id: "lot-1", maPhanLo: "L01", tenPhanLo: "Lô 1" },
    { id: "lot-2", maPhanLo: "L02", tenPhanLo: "Lô 2" },
  ]),
  danhGiaHsdtMetadata: JSON.stringify({
    schemaVersion: 1,
    draftScopes: {
      "lot-1": {
        lotIds: ["lot-1"],
        soBaoCao: "DRAFT-L01",
        saved: false,
        trangThai: "draft",
        draftSavedAt: "2026-08-19T08:00:00.000Z",
      },
    },
  }),
};

test("reopening a lot package selects the latest draft scope without treating it as official history", () => {
  const state = buildBidEvaluationPanelState({ pkg });

  assert.deepEqual(state.lotScope.selectedLotIds, ["lot-1"]);
  assert.equal(state.activeMeta.soBaoCao, "DRAFT-L01");
  assert.equal(state.activeMeta.saved, false);
  assert.equal(state.isCompleted, false);
  assert.equal(state.hasScopedHistory, false);
  assert.equal(state.effectiveStatus, "");
});
