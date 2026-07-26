import assert from "node:assert/strict";
import test from "node:test";

import { createAwardResultApprovalWorkflow } from "../../frontend/packages/detail/AwardResultApprovalWorkflow.js";

function approvalRow(overrides = {}) {
  return {
    bidId: "bid-1",
    contractorId: "contractor-1",
    status: "trung",
    isWinner: true,
    contractorCode: "NT-01",
    contractorName: "Nhà thầu 1",
    contractorType: "Độc lập",
    jointVentureMembers: [],
    leadMemberContractorId: "",
    leadMemberName: "",
    lotCode: "",
    lotName: "",
    awardPriceRaw: "1.000",
    awardPrice: 1_000,
    packageDuration: "60 ngày",
    contractDuration: "90 ngày",
    rejectionReason: "",
    ...overrides,
  };
}

function command(rows, overrides = {}) {
  return {
    ok: true,
    decision: {
      number: "12/QĐ",
      date: "2026-07-26",
      rawDate: "26/07/2026",
      appraisalNumber: "11/BCTĐ",
      appraisalDate: "2026-07-25",
      appraisalRawDate: "25/07/2026",
    },
    rows,
    winnerRows: rows.filter((row) => row.isWinner),
    errors: [],
    isDirectOrSpecial: false,
    ...overrides,
  };
}

function harness({ bids = [], contractors = [], ports = {} } = {}) {
  const events = [];
  const model = {
    state: {
      thongtinmothau: bids,
      nhathau: contractors,
      goithau: [],
    },
    getLatestNhaThau: () => contractors,
    applyCommittedRowVersions: async (versions) => events.push(["versions", versions]),
  };
  const view = {
    model,
    renderGoiThauTable: async () => events.push("render-table"),
    showPackageDetails: async (id) => events.push(["show-details", id]),
    customAlert: async (title, message, icon) => events.push(["alert", title, message, icon]),
  };
  const adapter = {
    commitDependencies: ports.commitDependencies || (async () => {
      events.push("commit-dependencies");
      return { ok: true };
    }),
    commitDecision: ports.commitDecision || (async (_controller, options = {}) => {
      events.push("commit-decision");
      await options.afterPersist?.();
      return { ok: true };
    }),
    finalizeLotBatch: ports.finalizeLotBatch || (async () => {
      events.push("finalize-lot-batch");
      return {
        packageStatus: "COMPLETED",
        packageRowVersion: 2,
        counts: { pendingLots: 0 },
      };
    }),
  };
  return {
    events,
    model,
    view,
    workflow: createAwardResultApprovalWorkflow(adapter),
  };
}

test("workflow approves a whole-package winner and commits once", async () => {
  const bid = {
    id: "bid-1",
    goiThauId: "pkg-1",
    nhaThauId: "contractor-1",
    loaiNhaThau: "Độc lập",
    lyDoTruot: "Lý do cũ",
  };
  const pkg = {
    id: "pkg-1",
    tenGoiThau: "Gói 1",
    phanLo: "Không",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({ result: {} }),
  };
  const { workflow, view, events } = harness({ bids: [bid] });

  const result = await workflow.execute({
    view,
    pkg,
    command: command([approvalRow()]),
    appController: { name: "controller" },
    viewModel: {
      activeScopedEvaluation: null,
      isTwoEnvelope: false,
      officialLotState: { isComplete: false },
      isEditingOfficialResult: false,
    },
  });

  assert.deepEqual(result, { ok: true, kind: "awarded" });
  assert.equal(pkg.nhaThauTrungThauId, "contractor-1");
  assert.equal(pkg.giaTrungThau, 1_000);
  assert.equal(pkg.trangThai, "Đã có kết quả");
  assert.equal(bid.lyDoTruot, "");
  const metadata = JSON.parse(pkg.danhGiaHsdtMetadata);
  assert.equal(metadata.result.saved, true);
  assert.equal(metadata.result.soQuyetDinhKetQua, "12/QĐ");
  assert.deepEqual(metadata.result.contractorBindings, [{
    bidId: "bid-1",
    jointVentureName: "",
    contractorVersionId: "contractor-1",
    memberVersionIds: [],
  }]);
  assert.equal(events.filter((event) => event === "commit-decision").length, 1);
  assert.ok(events.some((event) => Array.isArray(event) && event[0] === "show-details"));
});

test("workflow routes a package without winners to cancellation review", async () => {
  const losingRow = approvalRow({
    status: "truot",
    isWinner: false,
    awardPriceRaw: "",
    awardPrice: 0,
    packageDuration: "",
    contractDuration: "",
    rejectionReason: "Không đạt",
  });
  const bid = {
    id: "bid-1",
    goiThauId: "pkg-1",
    nhaThauId: "contractor-1",
    lyDoTruot: "",
  };
  const pkg = {
    id: "pkg-1",
    phanLo: "Không",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: "{}",
  };
  const { workflow, view, events } = harness({ bids: [bid] });

  const result = await workflow.execute({
    view,
    pkg,
    command: command([losingRow]),
    viewModel: {
      activeScopedEvaluation: null,
      isTwoEnvelope: false,
      officialLotState: { isComplete: false },
      isEditingOfficialResult: false,
    },
  });

  assert.deepEqual(result, { ok: true, kind: "cancelled" });
  assert.equal(bid.lyDoTruot, "Không đạt");
  assert.equal(pkg.soQuyetDinhKetQua, "12/QĐ");
  assert.match(JSON.parse(pkg.danhGiaHsdtMetadata).cancelDetails.lyDoHuyThau, /Tất cả các hồ sơ/);
  assert.equal(events.filter((event) => event === "commit-decision").length, 1);
  assert.ok(events.some((event) => Array.isArray(event) && event[1] === "pkg-1"));
});

test("workflow finalizes a scoped lot batch through the lifecycle port", async () => {
  const lot = { id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Lô 1" };
  const batch = {
    batchId: "batch-1",
    sequenceNo: 1,
    status: "SAVED",
    saved: true,
    lotIds: ["lot-1"],
    lotCodes: ["PL1"],
    result: {},
  };
  const pkg = {
    id: "pkg-1",
    phanLo: "Có",
    phanLoList: [lot],
    trangThai: "Đang chấm thầu",
    rowVersion: 1,
    danhGiaHsdtMetadata: JSON.stringify({
      activeLotBatchId: "batch-1",
      lotBatches: { "batch-1": batch },
    }),
  };
  const bid = {
    id: "bid-1",
    goiThauId: "pkg-1",
    nhaThauId: "contractor-1",
    maPhanLo: "PL1",
  };
  const scopedRow = approvalRow({ lotCode: "PL1", lotName: "Lô 1" });
  const { workflow, view, events } = harness({ bids: [bid] });

  const result = await workflow.execute({
    view,
    pkg,
    command: command([scopedRow]),
    viewModel: {
      activeScopedEvaluation: {
        batchId: "batch-1",
        lotIds: ["lot-1"],
        lotCodes: ["PL1"],
        batch,
      },
      isTwoEnvelope: false,
      officialLotState: { isComplete: false },
      isEditingOfficialResult: false,
    },
  });

  assert.deepEqual(result, { ok: true, kind: "scoped_awarded" });
  assert.equal(pkg.trangThai, "Đã có kết quả");
  assert.equal(pkg.rowVersion, 2);
  assert.equal(pkg.phanLoList[0].nhaThauTrungThauId, "contractor-1");
  assert.ok(events.includes("commit-dependencies"));
  assert.ok(events.includes("finalize-lot-batch"));
  assert.equal(events.includes("commit-decision"), false);
  assert.ok(events.some((event) => Array.isArray(event) && event[0] === "versions"));
});

test("workflow edits a finalized batch without finalizing its lifecycle twice", async () => {
  const lot = {
    id: "lot-1",
    maPhanLo: "PL1",
    tenPhanLo: "Lô 1",
    nhaThauTrungThauId: "contractor-1",
    giaTrungThau: 900,
  };
  const batch = {
    batchId: "batch-1",
    sequenceNo: 1,
    status: "FINAL",
    saved: true,
    lotIds: ["lot-1"],
    lotCodes: ["PL1"],
    result: { saved: true },
  };
  const pkg = {
    id: "pkg-1",
    phanLo: "Có",
    phanLoList: [lot],
    trangThai: "Đã có kết quả",
    rowVersion: 3,
    danhGiaHsdtMetadata: JSON.stringify({
      resultEdit: { type: "batch", batchId: "batch-1" },
      lotBatches: { "batch-1": batch },
    }),
  };
  const bid = { id: "bid-1", goiThauId: "pkg-1", nhaThauId: "contractor-1", maPhanLo: "PL1" };
  const { workflow, view, events } = harness({ bids: [bid] });

  const result = await workflow.execute({
    view,
    pkg,
    command: command([approvalRow({ lotCode: "PL1", awardPrice: 950 })]),
    viewModel: {
      activeScopedEvaluation: {
        batchId: "batch-1",
        lotIds: ["lot-1"],
        lotCodes: ["PL1"],
        batch,
      },
      isTwoEnvelope: false,
      officialLotState: { isComplete: true },
      isEditingOfficialResult: true,
    },
  });

  assert.deepEqual(result, { ok: true, kind: "scoped_awarded" });
  assert.equal(events.includes("finalize-lot-batch"), false);
  assert.equal(events.includes("commit-dependencies"), false);
  assert.equal(events.filter((event) => event === "commit-decision").length, 1);
  assert.equal(pkg.phanLoList[0].giaTrungThau, 950);
  assert.equal(JSON.parse(pkg.danhGiaHsdtMetadata).resultEdit, undefined);
});
