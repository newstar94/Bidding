import assert from "node:assert/strict";
import test from "node:test";

import { createAwardResultApprovalWorkflow } from "../../frontend/packages/detail/AwardResultApprovalWorkflow.js";

function contractor(id, rootId, version, effectiveDate, isLatest = 0) {
  return {
    id,
    rootId,
    phienBan: version,
    ngayApDung: effectiveDate,
    isLatest,
  };
}

test("award result keeps the contractor and joint-venture versions frozen at bid opening", async () => {
  const pkg = {
    id: "package-1",
    rootId: "package-1",
    isLatest: 1,
    phanLo: "Không",
    tenGoiThau: "Gói thầu thử nghiệm",
    danhGiaHsdtMetadata: "{}",
  };
  const model = {
    state: {
      goithau: [pkg],
      nhathau: [
        contractor("lead-v2", "lead-v1", "02", "2026-07-10"),
        contractor("lead-v3", "lead-v1", "03", "2026-08-10", 1),
        contractor("member-a-v1", "member-a-v1", "01", "2026-06-10"),
        contractor("member-a-v2", "member-a-v1", "02", "2026-08-10", 1),
        contractor("member-b-v1", "member-b-v1", "01", "2026-07-01", 1),
      ],
      thongtinmothau: [{
        id: "opening-bid-1",
        goiThauId: pkg.id,
        nhaThauId: "lead-v2",
        loaiNhaThau: "Liên danh",
        tenNhaThau: "Liên danh A-B",
        thanhVienLienDanh: [
          { thanhVienNhaThauId: "member-a-v1" },
          { thanhVienNhaThauId: "member-b-v1" },
        ],
      }],
    },
  };
  const view = {
    model,
    renderGoiThauTable: async () => {},
    showPackageDetails: async () => {},
    customAlert: async () => {},
  };
  const workflow = createAwardResultApprovalWorkflow({
    commitDependencies: async () => ({ ok: true }),
    commitDecision: async () => ({ ok: true }),
    finalizeLotBatch: async () => ({ packageStatus: "COMPLETED", packageRowVersion: 2 }),
  });
  const winner = {
    bidId: "opening-bid-1",
    contractorId: "lead-v2",
    contractorName: "Liên danh A-B",
    contractorType: "Liên danh",
    isWinner: true,
    awardPrice: 100,
    packageDuration: "30 ngày",
    contractDuration: "30 ngày",
  };

  const result = await workflow.execute({
    view,
    pkg,
    command: {
      ok: true,
      isDirectOrSpecial: false,
      rows: [winner],
      winnerRows: [winner],
      decision: {
        number: "01/QĐ",
        date: "2026-08-15",
        appraisalNumber: "",
        appraisalDate: "",
      },
    },
    viewModel: {
      activeScopedEvaluation: null,
      isTwoEnvelope: false,
      officialLotState: {},
      isEditingOfficialResult: false,
    },
  });

  const metadata = JSON.parse(pkg.danhGiaHsdtMetadata);
  assert.equal(result.ok, true);
  assert.equal(pkg.nhaThauTrungThauId, "lead-v2");
  assert.deepEqual(metadata.result.contractorBindings, [{
    bidId: "opening-bid-1",
    jointVentureName: "Liên danh A-B",
    contractorVersionId: "lead-v2",
    memberVersionIds: ["member-a-v1", "member-b-v1"],
  }]);
});

test("lot award stores the contractor version frozen on each opening bid", async () => {
  const pkg = {
    id: "package-lots",
    rootId: "package-lots",
    isLatest: 1,
    phanLo: "Có",
    phanLoList: [{ id: "lot-1", maPhanLo: "Lô 01" }],
    tenGoiThau: "Gói thầu phân lô",
    danhGiaHsdtMetadata: "{}",
  };
  const winner = {
    bidId: "opening-lot-bid",
    contractorId: "lot-winner-v1",
    contractorName: "Nhà thầu lô",
    contractorType: "Độc lập",
    lotCode: "Lô 01",
    isWinner: true,
    awardPrice: 200,
    packageDuration: "45 ngày",
    contractDuration: "45 ngày",
  };
  const model = {
    state: {
      goithau: [pkg],
      nhathau: [
        contractor("lot-winner-v1", "lot-winner-v1", "01", "2026-07-01"),
        contractor("lot-winner-v2", "lot-winner-v1", "02", "2026-08-01", 1),
      ],
      thongtinmothau: [{
        id: winner.bidId,
        goiThauId: pkg.id,
        nhaThauId: "lot-winner-v1",
        maPhanLo: "Lô 01",
        loaiNhaThau: "Độc lập",
        thanhVienLienDanh: [],
      }],
    },
  };
  const view = {
    model,
    renderGoiThauTable: async () => {},
    showPackageDetails: async () => {},
    customAlert: async () => {},
  };
  const workflow = createAwardResultApprovalWorkflow({
    commitDependencies: async () => ({ ok: true }),
    commitDecision: async () => ({ ok: true }),
    finalizeLotBatch: async () => ({ packageStatus: "COMPLETED", packageRowVersion: 2 }),
  });

  const result = await workflow.execute({
    view,
    pkg,
    command: {
      ok: true,
      isDirectOrSpecial: false,
      rows: [winner],
      winnerRows: [winner],
      decision: { number: "02/QĐ", date: "2026-08-15" },
    },
    viewModel: {
      activeScopedEvaluation: null,
      isTwoEnvelope: false,
      officialLotState: {},
      isEditingOfficialResult: false,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(pkg.phanLoList[0].nhaThauTrungThauId, "lot-winner-v1");
  assert.equal(pkg.nhaThauTrungThauId, "lot-winner-v1");
});
