import assert from "node:assert/strict";
import test from "node:test";

import { parseBidEvaluationImport } from "../../frontend/documents/excelImportAdapters.js";

import {
  EVALUATION_LOT_SCOPE_MODE,
  ensureWholePackageEvaluationAvailable,
  ensureEvaluationLotBatch,
  finalizeEvaluationLotBatch,
  filterBidsByEvaluationLotScope,
  findScopedEvaluationMetadata,
  getOfficialEvaluationLotState,
  getEvaluationLotScopeDetails,
  initializeEvaluationLotScope,
  isPartialEvaluationLotScope,
  resolveActiveSavedEvaluationScope,
  resolvePackageResultStatus,
  saveEvaluationScopeMetadata,
  finalizeEvaluationScopeMetadata,
  updateEvaluationLotScope,
} from "../../frontend/packages/lotEvaluationScope.js";
import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";

const pkg = {
  id: "pkg-1",
  phanLo: "Có",
  phanLoList: [
    { id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Phần lô 1" },
    { id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Phần lô 2" },
  ],
};

test("whole-package scope includes every lot and selected scope filters bidder-lot rows", () => {
  const initial = initializeEvaluationLotScope(pkg);
  assert.equal(initial.mode, EVALUATION_LOT_SCOPE_MODE.ALL);
  assert.deepEqual(initial.selectedLotIds, ["lot-1", "lot-2"]);

  const selected = updateEvaluationLotScope(initial, pkg.phanLoList, {
    mode: EVALUATION_LOT_SCOPE_MODE.SELECTED,
    selectedLotIds: ["lot-2"],
  });
  const details = getEvaluationLotScopeDetails(pkg, selected);
  assert.deepEqual(details.lotCodes, ["PL2"]);
  assert.equal(details.isWholePackage, false);

  const rows = filterBidsByEvaluationLotScope([
    { id: "bid-1", maPhanLo: "PL1" },
    { id: "bid-2", maPhanLo: " pl2 " },
    { id: "bid-conflict", lotId: "lot-1", maPhanLo: "PL2" },
  ], pkg, selected);
  assert.deepEqual(rows.map((row) => row.id), ["bid-2"]);

  const emptySelection = initializeEvaluationLotScope(pkg, {}, {
    mode: EVALUATION_LOT_SCOPE_MODE.SELECTED,
    selectedLotIds: [],
  });
  assert.deepEqual(emptySelection.selectedLotIds, []);
  assert.equal(isPartialEvaluationLotScope(details), true);
  assert.equal(isPartialEvaluationLotScope(getEvaluationLotScopeDetails(pkg, initial)), false);
});

test("partial reports are stored by immutable batch scope without completing the whole package", () => {
  const saved = saveEvaluationScopeMetadata(
    { saved: false },
    { id: "batch-1", lotIds: ["lot-1"], lotCodes: ["PL1"] },
    { saved: true, soBaoCao: "01/BC" },
    ["lot-1", "lot-2"],
  );

  assert.equal(saved.saved, false);
  assert.equal(saved.activeLotBatchId, "batch-1");
  assert.equal(saved.lotBatches["batch-1"].soBaoCao, "01/BC");
  assert.equal(saved.lotBatches["batch-1"].status, "ACTIVE");
  assert.deepEqual(
    findScopedEvaluationMetadata(saved, ["lot-1"]).lotIds,
    ["lot-1"],
  );
});

test("official rounds expose completed history and only remaining lots for the next round", () => {
  const fiveLotPackage = {
    ...pkg,
    phanLoList: Array.from({ length: 5 }, (_, index) => ({
      id: `lot-${index + 1}`,
      maPhanLo: `PL${index + 1}`,
      tenPhanLo: `Phần lô ${index + 1}`,
    })),
  };
  const evaluated = saveEvaluationScopeMetadata(
    {},
    { id: "batch-1", sequenceNo: 1, lotIds: ["lot-1", "lot-2"], lotCodes: ["PL1", "PL2"] },
    { saved: true, soBaoCao: "01/BC" },
    fiveLotPackage.phanLoList.map((lot) => lot.id),
  );
  const finalized = finalizeEvaluationScopeMetadata(evaluated, "batch-1", {
    saved: true,
    soQuyetDinhKetQua: "01/QĐ",
  });
  const state = getOfficialEvaluationLotState(fiveLotPackage, finalized);

  assert.deepEqual(state.completedLotIds, ["lot-1", "lot-2"]);
  assert.deepEqual(state.pendingLots.map((lot) => lot.id), ["lot-3", "lot-4", "lot-5"]);
  assert.equal(state.history[0].sequenceNo, 1);
  assert.equal(state.history[0].status, "FINAL");

  const nextScope = initializeEvaluationLotScope(fiveLotPackage, finalized);
  assert.deepEqual(nextScope.availableLotIds, ["lot-3", "lot-4", "lot-5"]);
  assert.deepEqual(nextScope.selectedLotIds, ["lot-3", "lot-4", "lot-5"]);

  const oneMoreLot = updateEvaluationLotScope(nextScope, fiveLotPackage.phanLoList, {
    mode: EVALUATION_LOT_SCOPE_MODE.SELECTED,
    selectedLotIds: ["lot-3", "lot-1"],
  });
  assert.deepEqual(oneMoreLot.selectedLotIds, ["lot-3"]);
});

test("legacy saved lot result is projected as an official round instead of reopening the form", () => {
  const legacyMetadata = {
    saved: false,
    activeLotBatchId: "batch-legacy",
    lotBatches: {
      "batch-legacy": {
        batchId: "batch-legacy",
        sequenceNo: 1,
        lotIds: ["lot-1"],
        lotCodes: ["PL1"],
        saved: true,
        result: {
          saved: true,
          soQuyetDinhKetQua: "01/QD",
        },
      },
    },
  };

  const state = getOfficialEvaluationLotState(pkg, legacyMetadata);

  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].batchId, "batch-legacy");
  assert.deepEqual(state.completedLotIds, ["lot-1"]);
  assert.deepEqual(state.pendingLots.map((lot) => lot.id), ["lot-2"]);
  assert.equal(resolveActiveSavedEvaluationScope(pkg, legacyMetadata), null);
});

test("package status is completed when every lot has an official result round", () => {
  const completedPackage = {
    ...pkg,
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({
      lotBatches: {
        "batch-1": {
          batchId: "batch-1",
          lotIds: ["lot-1"],
          lotCodes: ["PL1"],
          saved: true,
          result: { saved: true },
        },
        "batch-2": {
          batchId: "batch-2",
          lotIds: ["lot-2"],
          lotCodes: ["PL2"],
          saved: true,
          result: { saved: true },
        },
      },
    }),
  };

  assert.equal(resolvePackageResultStatus(completedPackage), "Đã có kết quả");
  assert.equal(resolvePackageResultStatus({
    ...completedPackage,
    danhGiaHsdtMetadata: JSON.stringify({
      lotBatches: {
        "batch-1": {
          lotIds: ["lot-1"],
          saved: true,
          result: { saved: true },
        },
      },
    }),
  }), "Đã có kết quả một phần");
  assert.equal(resolvePackageResultStatus({
    ...completedPackage,
    danhGiaHsdtMetadata: JSON.stringify({ lotBatches: {} }),
  }), "Đang chấm thầu");
});

test("editing an official result immediately exposes the package's non-final workflow status", () => {
  const completedPackage = {
    ...pkg,
    trangThai: "Đã có kết quả",
    danhGiaHsdtMetadata: JSON.stringify({
      lotBatches: {
        "batch-1": {
          batchId: "batch-1",
          lotIds: ["lot-1"],
          saved: true,
          result: { saved: true },
        },
        "batch-2": {
          batchId: "batch-2",
          lotIds: ["lot-2"],
          saved: true,
          result: { saved: true },
        },
      },
    }),
  };

  assert.equal(
    resolvePackageResultStatus(completedPackage, { editingBatchId: "batch-1" }),
    "Đã có kết quả một phần",
  );
  assert.equal(
    resolvePackageResultStatus(completedPackage, { editingWholePackage: true }),
    "Đang chấm thầu",
  );
  assert.equal(resolvePackageResultStatus(completedPackage), "Đã có kết quả");
});

test("persisted result-edit state remains visible to package list and dashboard status resolvers", () => {
  const completedPackage = {
    ...pkg,
    trangThai: "Đã có kết quả",
    danhGiaHsdtMetadata: JSON.stringify({
      resultEdit: { type: "batch", batchId: "batch-1" },
      lotBatches: {
        "batch-1": {
          batchId: "batch-1",
          lotIds: ["lot-1"],
          saved: true,
          result: { saved: true },
        },
        "batch-2": {
          batchId: "batch-2",
          lotIds: ["lot-2"],
          saved: true,
          result: { saved: true },
        },
      },
    }),
  };

  assert.equal(resolvePackageResultStatus(completedPackage), "Đã có kết quả một phần");
  assert.equal(resolvePackageResultStatus({
    ...completedPackage,
    phanLo: "Không",
    danhGiaHsdtMetadata: JSON.stringify({
      resultEdit: { type: "whole" },
      result: { saved: true },
    }),
  }), "Đang chấm thầu");
});

test("two-envelope packages retain result-edit state in the persisted technical block", () => {
  const twoEnvelopePackage = {
    ...pkg,
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    trangThai: "Đã có kết quả",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: {
        resultEdit: { type: "batch", batchId: "batch-1" },
        lotBatches: {
          "batch-1": {
            batchId: "batch-1",
            lotIds: ["lot-1"],
            saved: true,
            result: { saved: true },
          },
          "batch-2": {
            batchId: "batch-2",
            lotIds: ["lot-2"],
            saved: true,
            result: { saved: true },
          },
        },
      },
      financial: {},
    }),
  };

  assert.equal(resolvePackageResultStatus(twoEnvelopePackage), "Đã có kết quả một phần");
});

test("finalizing an official batch calls the lifecycle endpoint with an outcome for every lot", async () => {
  const calls = [];
  const response = await finalizeEvaluationLotBatch({
    packageId: "pkg-1",
    batchId: "batch-1",
    outcomes: { "lot-1": "AWARDED", "lot-2": "NO_RESPONSIVE_BID" },
    packageAward: {
      expectedVersion: 3,
      decisionNumber: "01/QĐ",
      decisionDate: "2026-07-24",
      metadata: { result: { saved: true } },
      lotResults: [],
    },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ packageStatus: "PARTIALLY_COMPLETED", counts: { pendingLots: 3 } }),
      };
    },
  });

  assert.equal(response.packageStatus, "PARTIALLY_COMPLETED");
  assert.equal(calls[0].url, "/api/packages/pkg-1/lot-batches/batch-1/finalize");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    outcomes: { "lot-1": "AWARDED", "lot-2": "NO_RESPONSIVE_BID" },
    packageAward: {
      expectedVersion: 3,
      decisionNumber: "01/QĐ",
      decisionDate: "2026-07-24",
      metadata: { result: { saved: true } },
      lotResults: [],
    },
  });
});

test("an all-lot batch keeps the legacy completed projection compatible", () => {
  const saved = saveEvaluationScopeMetadata(
    {},
    { id: "batch-all", lotIds: ["lot-2", "lot-1"] },
    { saved: true, soBaoCao: "02/BC" },
    ["lot-1", "lot-2"],
  );

  assert.equal(saved.saved, true);
  assert.equal(saved.soBaoCao, "02/BC");
  assert.equal(saved.lotBatches["batch-all"].isWholePackage, true);
});

test("a saved active selected-lot batch exposes the 1G1T result tab without completing the whole package", () => {
  const metadata = {
    saved: false,
    activeLotBatchId: "batch-partial",
    lotBatches: {
      "batch-partial": {
        batchId: "batch-partial",
        lotIds: ["lot-1"],
        saved: true,
      },
    },
  };
  const packageWithPartialResult = {
    ...pkg,
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    danhGiaHsdtMetadata: JSON.stringify(metadata),
  };

  assert.deepEqual(
    resolveActiveSavedEvaluationScope(packageWithPartialResult, metadata),
    {
      batchId: "batch-partial",
      lotIds: ["lot-1"],
      lotCodes: ["PL1"],
      isWholePackage: false,
      batch: metadata.lotBatches["batch-partial"],
    },
  );

  const state = buildPackageTabs(packageWithPartialResult, []);
  assert.equal(state.isSingleEnvelopeEvalSaved, false);
  assert.equal(state.isSingleEnvelopeScopedEvalSaved, true);
  assert.equal(state.tabs.some((tab) => tab.id === "result"), true);
});

test("active saved scope resolution rejects unsaved, invalid, or already-resulted lot snapshots", () => {
  const metadata = {
    activeLotBatchId: "active",
    lotBatches: {
      active: { saved: false, lotIds: ["lot-1"] },
      empty: { saved: true, lotIds: [] },
      unknown: { saved: true, lotIds: ["lot-missing"] },
      saved: { saved: true, lotIds: ["lot-2"], result: { saved: true } },
    },
  };

  assert.equal(resolveActiveSavedEvaluationScope(pkg, metadata), null);
  assert.equal(resolveActiveSavedEvaluationScope(pkg, metadata, "empty"), null);
  assert.equal(resolveActiveSavedEvaluationScope(pkg, metadata, "unknown"), null);
  assert.equal(resolveActiveSavedEvaluationScope(pkg, metadata, "saved"), null);
});

test("whole-package 1G1T result-tab behavior remains based on the legacy saved projection", () => {
  const wholePackage = {
    ...pkg,
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    danhGiaHsdtMetadata: JSON.stringify({ saved: true }),
  };

  const state = buildPackageTabs(wholePackage, []);
  assert.equal(state.isSingleEnvelopeEvalSaved, true);
  assert.equal(state.tabs.some((tab) => tab.id === "result"), true);
});

test("a finalized 1G2T round keeps evaluation and result history tabs available", () => {
  const twoEnvelope = {
    ...pkg,
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: {
        lotBatches: {
          "batch-1": {
            batchId: "batch-1",
            sequenceNo: 1,
            lotIds: ["lot-1"],
            lotCodes: ["PL1"],
            saved: true,
            status: "FINAL",
            result: { saved: true, soQuyetDinhKetQua: "01/QĐ" },
          },
        },
      },
      financial: {},
    }),
  };

  const state = buildPackageTabs(twoEnvelope, []);
  assert.equal(state.hasOfficialLotResults, true);
  assert.equal(state.tabs.some((tab) => tab.id === "eval_tech"), true);
  assert.equal(state.tabs.some((tab) => tab.id === "result"), true);
});

test("batch creation reuses an active batch with the exact same lot snapshot", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        batches: [{
          id: "batch-existing",
          status: "ACTIVE",
          lots: [{ lot_id: "lot-2" }, { lot_id: "lot-1" }],
        }],
      }),
    };
  };

  const batch = await ensureEvaluationLotBatch({
    packageId: pkg.id,
    lotIds: ["lot-1", "lot-2"],
    fetcher,
  });

  assert.equal(batch.id, "batch-existing");
  assert.equal(batch.reused, true);
  assert.equal(calls.length, 1);
});

test("new selected scope is posted as an official staged round without special authorization", async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (!options.method) {
      return { ok: true, json: async () => ({ batches: [] }) };
    }
    return {
      ok: true,
      json: async () => ({ batch: { id: "batch-new", lotIds: ["lot-2"] } }),
    };
  };

  const batch = await ensureEvaluationLotBatch({
    packageId: pkg.id,
    lotIds: ["lot-2"],
    fetcher,
  });

  assert.equal(batch.id, "batch-new");
  assert.equal(batch.reused, false);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    lotIds: ["lot-2"],
    approvalMode: "STAGED_APPROVAL",
  });
});

test("whole-package legacy save is blocked after a partial batch has started", async () => {
  await assert.rejects(
    ensureWholePackageEvaluationAvailable({
      packageId: pkg.id,
      fetcher: async () => ({
        ok: true,
        json: async () => ({ batches: [{ id: "batch-partial", status: "ACTIVE" }] }),
      }),
    }),
    /đợt đánh giá phần lô/,
  );

  await assert.doesNotReject(ensureWholePackageEvaluationAvailable({
    packageId: pkg.id,
    fetcher: async () => ({ ok: true, json: async () => ({ batches: [] }) }),
  }));
});

test("Excel preview rejects bidder-lot rows outside the selected scope", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => id === "danhgiahsdt-goithau-select" ? { value: pkg.id } : null,
  };
  const controller = {
    currentDanhGiaTab: "unified",
    _evaluationLotScopes: {
      [`${pkg.id}:unified`]: {
        mode: EVALUATION_LOT_SCOPE_MODE.SELECTED,
        selectedLotIds: ["lot-1"],
      },
    },
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: [{
          id: "bid-lot-2",
          goiThauId: pkg.id,
          lotId: "lot-2",
          maPhanLo: "PL2",
          maNhaThau: "NT2",
          tenNhaThau: "Nhà thầu 2",
        }],
      },
      parseVND: () => 0,
    },
    view: { customAlert: async () => {} },
  };

  try {
    const parsed = await parseBidEvaluationImport(controller, [{
      "Mã phần lô": "PL2",
      "Mã nhà thầu": "NT2",
    }]);
    assert.equal(parsed[0]._valid, false);
    assert.match(parsed[0]._comment, /ngoài phạm vi/);
  } finally {
    globalThis.document = originalDocument;
  }
});
