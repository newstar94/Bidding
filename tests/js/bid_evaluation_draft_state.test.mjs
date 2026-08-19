import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBidEvaluationPatches,
  buildBidEvaluationDraftMetadata,
  collectBidEvaluationDraftPatches,
  createBidEvaluationDirtyState,
} from "../../frontend/packages/BidEvaluationDraftState.js";
import { parseEvaluationMetadataStrict } from "../../frontend/packages/evaluationMetadata.js";

function control(value, { disabled = false } = {}) {
  return { value, disabled };
}

function row(bidId, values) {
  const controls = new Map(Object.entries(values));
  return {
    getAttribute: (name) => name === "data-bid-id" ? bidId : null,
    querySelector: (selector) => controls.get(selector) || null,
  };
}

test("dirty collection emits only the intended bidder field and record", () => {
  const bids = [
    { id: "bid-1", rowVersion: 7, danhGiaHopLe: "", danhGiaNangLuc: "Giữ nguyên" },
    { id: "bid-2", rowVersion: 2, danhGiaHopLe: "Đạt" },
  ];
  const dirty = createBidEvaluationDirtyState();
  dirty.markBidField("bid-1", "danhGiaHopLe");
  const patches = collectBidEvaluationDraftPatches({
    rows: [
      row("bid-1", { ".mt-dg-hop-le": control("Đạt") }),
      row("bid-2", { ".mt-dg-hop-le": control("Không đạt") }),
    ],
    bids,
    dirtyState: dirty,
    parseMoney: Number,
  });

  assert.deepEqual(patches, [{ id: "bid-1", rowVersion: 7, danhGiaHopLe: "Đạt" }]);
  applyBidEvaluationPatches(bids, patches);
  assert.equal(bids[0].danhGiaNangLuc, "Giữ nguyên");
  assert.equal(bids[1].danhGiaHopLe, "Đạt");
});

test("draft can persist validity and capacity while technical evaluation remains untouched", () => {
  const bids = [{ id: "bid-1", danhGiaHopLe: "", danhGiaNangLuc: "", danhGiaKyThuat: "" }];
  const dirty = createBidEvaluationDirtyState();
  dirty.markBidField("bid-1", "danhGiaHopLe");
  dirty.markBidField("bid-1", "danhGiaNangLuc");
  const patches = collectBidEvaluationDraftPatches({
    rows: [row("bid-1", {
      ".mt-dg-hop-le": control("Đạt"),
      ".mt-dg-nang-luc": control("Đạt"),
      ".mt-dg-ky-thuat": control(""),
    })],
    bids,
    dirtyState: dirty,
    parseMoney: Number,
  });

  assert.deepEqual(patches, [{
    id: "bid-1",
    danhGiaHopLe: "Đạt",
    danhGiaNangLuc: "Đạt",
  }]);
});

test("upstream failure invalidates downstream draft fields in the same patch", () => {
  const bids = [{
    id: "bid-1",
    danhGiaHopLe: "Đạt",
    danhGiaNangLuc: "Đạt",
    danhGiaKyThuat: "82",
    danhGiaKetLuan: "Đạt",
    danhGiaTaiChinh: "Xếp hạng 1",
  }];
  const dirty = createBidEvaluationDirtyState();
  dirty.markBidField("bid-1", "danhGiaHopLe");
  const patches = collectBidEvaluationDraftPatches({
    rows: [row("bid-1", { ".mt-dg-hop-le": control("Không đạt") })],
    bids,
    dirtyState: dirty,
    parseMoney: Number,
  });

  assert.deepEqual(patches[0], {
    id: "bid-1",
    danhGiaHopLe: "Không đạt",
    danhGiaNangLuc: "",
    danhGiaKyThuat: "",
    danhGiaKetLuan: "Không đạt yêu cầu về tính hợp lệ",
    danhGiaTaiChinh: "--",
  });
});

test("capacity failure clears stale technical work without rewriting unrelated bidder fields", () => {
  const bids = [{
    id: "bid-1",
    danhGiaHopLe: "Đạt",
    danhGiaNangLuc: "Đạt",
    danhGiaKyThuat: "82",
    danhGiaKetLuan: "Đạt",
    lamRoHopLe: "Giữ nguyên",
  }];
  const dirty = createBidEvaluationDirtyState();
  dirty.markBidField("bid-1", "danhGiaNangLuc");
  const patches = collectBidEvaluationDraftPatches({
    rows: [row("bid-1", { ".mt-dg-nang-luc": control("Không đạt") })],
    bids,
    dirtyState: dirty,
    parseMoney: Number,
  });

  assert.deepEqual(patches[0], {
    id: "bid-1",
    danhGiaNangLuc: "Không đạt",
    danhGiaKyThuat: "",
    danhGiaKetLuan: "Không đạt yêu cầu về năng lực, kinh nghiệm",
    danhGiaTaiChinh: "--",
  });
  assert.equal(Object.hasOwn(patches[0], "lamRoHopLe"), false);
});

test("draft metadata stays non-official for regular, lot, and 1G2T rounds", () => {
  const regular = parseEvaluationMetadataStrict(buildBidEvaluationDraftMetadata({
    existing: "",
    round: "single",
    report: { soBaoCao: "", ngayBaoCao: "" },
    now: () => "2026-08-19T07:00:00.000Z",
  }));
  assert.equal(regular.saved, false);
  assert.equal(regular.trangThai, "draft");
  assert.equal(regular.hoanThanhLuc, null);

  const lot = parseEvaluationMetadataStrict(buildBidEvaluationDraftMetadata({
    existing: JSON.stringify({ schemaVersion: 1 }),
    round: "single",
    lotIds: ["lot-2", "lot-1"],
    report: { soBaoCao: "D-01" },
    now: () => "2026-08-19T07:00:00.000Z",
  }));
  assert.equal(lot.saved, undefined);
  assert.equal(lot.lotBatches, undefined);
  assert.equal(lot.draftScopes["lot-1|lot-2"].saved, false);

  const twoEnvelope = parseEvaluationMetadataStrict(buildBidEvaluationDraftMetadata({
    existing: JSON.stringify({
      schemaVersion: 1,
      is1G2T: true,
      technical: { saved: false },
      financial: { saved: false },
    }),
    round: "technical",
    report: { soBaoCao: "KT-01" },
    now: () => "2026-08-19T07:00:00.000Z",
  }));
  assert.equal(twoEnvelope.technical.saved, false);
  assert.equal(twoEnvelope.financial.saved, false);
});

test("dirty state clears acknowledged fields only after success", () => {
  const dirty = createBidEvaluationDirtyState();
  dirty.markReportField("soBaoCao");
  dirty.markBidField("bid-1", "danhGiaHopLe");
  const checkpoint = dirty.checkpoint();

  dirty.acknowledge(checkpoint, { ok: false });
  assert.equal(dirty.hasChanges(), true);
  dirty.acknowledge(checkpoint, { ok: true });
  assert.equal(dirty.hasChanges(), false);
});
