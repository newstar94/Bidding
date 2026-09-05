import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveBidEvaluationProgress,
  deriveDetailedEvaluationProgress,
  getEvaluationProgressVisual,
} from "../../frontend/packages/BidEvaluationProgress.js";

test("progress visual is neutral at zero and continuously transitions red-orange to yellow to green", () => {
  assert.deepEqual(getEvaluationProgressVisual(0), {
    percent: 0,
    state: "empty",
    startHue: 0,
    endHue: 0,
  });
  const low = getEvaluationProgressVisual(20);
  const middle = getEvaluationProgressVisual(50);
  const high = getEvaluationProgressVisual(90);
  const complete = getEvaluationProgressVisual(100);
  assert.equal(low.state, "in-progress");
  assert.ok(low.endHue > 0 && low.endHue < 60);
  assert.ok(middle.endHue >= 60 && middle.endHue < high.endHue);
  assert.ok(high.endHue < 120);
  assert.deepEqual(complete, {
    percent: 100,
    state: "complete",
    startHue: 96,
    endHue: 120,
  });
});

test("upstream failures resolve downstream work as not applicable and exclude it from stage denominators", () => {
  const progress = deriveBidEvaluationProgress({
    round: "technical",
    bids: [
      { id: "a", danhGiaHopLe: "Không đạt" },
      { id: "b", danhGiaHopLe: "Đạt", danhGiaNangLuc: "Không đạt" },
      { id: "c", danhGiaHopLe: "Đạt", danhGiaNangLuc: "Đạt", danhGiaKyThuat: "82" },
      { id: "d", danhGiaHopLe: "" },
    ],
    requiresTechnicalScore: true,
  });

  assert.deepEqual(progress.stages.map(({ key, completed, applicable }) => ({
    key, completed, applicable,
  })), [
    { key: "validity", completed: 3, applicable: 4 },
    { key: "capacity", completed: 2, applicable: 3 },
    { key: "technical", completed: 1, applicable: 2 },
  ]);
  assert.equal(progress.resolvedSlots, 9);
  assert.equal(progress.potentialSlots, 12);
  assert.equal(progress.percent, 75);
  assert.equal(progress.byBid.a.capacity, "NOT_APPLICABLE");
  assert.equal(progress.byBid.b.technical, "NOT_APPLICABLE");
});

test("scope and 1G2T rounds derive independently without mutating source records", () => {
  const bids = [
    { id: "lot-1-bid", lotId: "lot-1", danhGiaHopLe: "Đạt", danhGiaNangLuc: "Đạt", danhGiaKyThuat: "Đạt", giaXepHang: 100, danhGiaTaiChinh: "--" },
    { id: "lot-2-bid", lotId: "lot-2", danhGiaHopLe: "" },
  ];
  const before = structuredClone(bids);
  const technical = deriveBidEvaluationProgress({ round: "technical", bids: [bids[0]] });
  const financial = deriveBidEvaluationProgress({ round: "financial", bids: [bids[0]] });

  assert.equal(technical.percent, 100);
  assert.equal(financial.percent, 50);
  assert.deepEqual(bids, before);
});

test("editable binary defaults are included in progress before the user reselects them", () => {
  const progress = deriveBidEvaluationProgress({
    round: "technical",
    bids: [{ id: "new-bid", danhGiaHopLe: "", danhGiaNangLuc: "", danhGiaKyThuat: "" }],
    defaultEmptyBinaryResultsToPass: true,
  });

  assert.deepEqual(progress.stages.map(({ key, completed, applicable }) => ({
    key, completed, applicable,
  })), [
    { key: "validity", completed: 1, applicable: 1 },
    { key: "capacity", completed: 1, applicable: 1 },
    { key: "technical", completed: 0, applicable: 1 },
  ]);
  assert.equal(progress.percent, 67);
});

test("a financially rejected bidder resolves ranking as not applicable", () => {
  const progress = deriveBidEvaluationProgress({
    round: "financial",
    bids: [{
      id: "rejected",
      giaXepHang: 100,
      chapThuanGiaDeNghiTrungThauDuoi50: false,
      danhGiaTaiChinh: "--",
    }],
  });
  assert.equal(progress.byBid.rejected.ranking, "NOT_APPLICABLE");
  assert.equal(progress.stages[1].applicable, 0);
  assert.equal(progress.percent, 100);
});

test("detailed progress respects required leaf criteria and resolved not-applicable rows", () => {
  const criteria = [
    { id: "parent", required: true, hasChildren: true },
    { id: "required-pass", required: true },
    { id: "required-na", required: true },
    { id: "optional", required: false },
  ];
  const report = { chiTietList: [
    { tieuChiDanhGiaId: "required-pass", ketQua: "pass" },
    { tieuChiDanhGiaId: "required-na", ketQua: "not_applicable" },
  ] };
  const progress = deriveDetailedEvaluationProgress({ report, criteria });

  assert.equal(progress.requiredCompleted, 2);
  assert.equal(progress.requiredTotal, 2);
  assert.equal(progress.percent, 100);
  assert.equal(progress.statuses["required-na"], "NOT_APPLICABLE");
});
