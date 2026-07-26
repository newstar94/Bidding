import assert from "node:assert/strict";
import test from "node:test";

import { buildFinancialOpeningState } from "../../frontend/packages/detail/FinancialOpeningPanel.js";

function viewWithBids(bids, editing = false) {
  return {
    _editingState: { opening_fin: editing },
    model: { state: { thongtinmothau: bids } },
  };
}

test("financial opening follows the active technical lot scope and stable display order", () => {
  const pkg = {
    id: "pkg-1",
    phanLo: "Có",
    phanLoList: [
      { id: "lot-1", maPhanLo: "L1" },
      { id: "lot-2", maPhanLo: "L2" },
    ],
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: {
        activeLotBatchId: "batch-1",
        lotBatches: {
          "batch-1": { saved: true, status: "ACTIVE", lotIds: ["lot-1"] },
        },
      },
      financial: {},
    }),
  };
  const state = buildFinancialOpeningState({
    view: viewWithBids([
      { id: "bid-z", goiThauId: pkg.id, lotId: "lot-1", maPhanLo: "L1", maNhaThau: "NT-10", danhGiaKetLuan: "Đạt" },
      { id: "bid-a", goiThauId: pkg.id, lotId: "lot-1", maPhanLo: "L1", maNhaThau: "NT-2", danhGiaKetLuan: "Đạt" },
      { id: "bid-other", goiThauId: pkg.id, lotId: "lot-2", maPhanLo: "L2", maNhaThau: "NT-1", danhGiaKetLuan: "Đạt" },
    ]),
    pkg,
  });

  assert.deepEqual(state.qualifiedBids.map((bid) => bid.id), ["bid-a", "bid-z"]);
  assert.equal(state.technicalScope.batch, state.metadata.technical.lotBatches["batch-1"]);
});

test("financial opening can reopen saved minutes but never after financial evaluation", () => {
  const basePackage = {
    id: "pkg-1",
    danhGiaHsdtMetadata: JSON.stringify({ is1G2T: true, technical: {}, financial: {} }),
  };
  const bid = { goiThauId: basePackage.id, danhGiaKetLuan: "Đạt", giaDuThau: 100 };
  assert.equal(buildFinancialOpeningState({
    view: viewWithBids([bid]),
    pkg: basePackage,
  }).isReadOnly, true);
  assert.equal(buildFinancialOpeningState({
    view: viewWithBids([bid], true),
    pkg: basePackage,
  }).isReadOnly, false);

  const evaluatedPackage = {
    ...basePackage,
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: {},
      financial: { saved: true },
    }),
  };
  const evaluated = buildFinancialOpeningState({
    view: viewWithBids([bid], true),
    pkg: evaluatedPackage,
  });
  assert.equal(evaluated.isFinancialEvaluationSaved, true);
  assert.equal(evaluated.isReadOnly, true);
  assert.equal(evaluated.canEdit, false);
});
