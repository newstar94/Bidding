import assert from "node:assert/strict";
import test from "node:test";

import { buildQualifiedApprovalState } from "../../frontend/packages/detail/QualifiedApprovalPanel.js";

function viewWithBids(bids, editing = false) {
  return {
    _editingState: { qualified: editing },
    model: { state: { thongtinmothau: bids } },
  };
}

test("qualified approval keeps a lot-scoped decision in the metadata object that is saved", () => {
  const batch = { saved: true, status: "ACTIVE", lotIds: ["lot-1"] };
  const pkg = {
    id: "pkg-1",
    phanLo: "Có",
    phanLoList: [{ id: "lot-1", maPhanLo: "L1" }, { id: "lot-2", maPhanLo: "L2" }],
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: {
        saved: true,
        activeLotBatchId: "batch-1",
        lotBatches: { "batch-1": batch },
      },
      financial: {},
    }),
  };
  const state = buildQualifiedApprovalState({
    view: viewWithBids([
      { id: "bid-1", goiThauId: pkg.id, lotId: "lot-1", danhGiaKetLuan: "Đạt" },
      { id: "bid-2", goiThauId: pkg.id, lotId: "lot-2", danhGiaKetLuan: "Đạt" },
    ]),
    pkg,
    isTechEvalSaved: true,
  });

  assert.equal(state.target, state.metadata.technical.lotBatches["batch-1"]);
  assert.deepEqual(state.qualifiedBids.map((bid) => bid.id), ["bid-1"]);
});

test("qualified approval locks completed decisions until explicitly edited", () => {
  const pkg = {
    id: "pkg-1",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: true },
      financial: {},
    }),
  };

  assert.equal(buildQualifiedApprovalState({
    view: viewWithBids([]), pkg, isTechEvalSaved: true,
  }).isReadOnly, true);
  assert.equal(buildQualifiedApprovalState({
    view: viewWithBids([], true), pkg, isTechEvalSaved: true,
  }).isReadOnly, false);
});
