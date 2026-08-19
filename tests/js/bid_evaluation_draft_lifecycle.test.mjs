import test from "node:test";
import assert from "node:assert/strict";

import { buildBidEvaluationDraftMetadata } from "../../frontend/packages/BidEvaluationDraftState.js";
import { buildBidEvaluationPanelState } from "../../frontend/packages/BidEvaluationPanelState.js";
import { getOfficialEvaluationLotState, resolvePackageResultStatus } from "../../frontend/packages/lotEvaluationScope.js";
import { parseEvaluationMetadataStrict } from "../../frontend/packages/evaluationMetadata.js";

const lots = [
  { id: "lot-1", maPhanLo: "L01", tenPhanLo: "Lô 1" },
  { id: "lot-2", maPhanLo: "L02", tenPhanLo: "Lô 2" },
];

test("one or multiple lot drafts never enter official batch history or package partial-result lifecycle", () => {
  const pkg = {
    id: "pkg-lot",
    phanLo: "Có",
    phanLoList: JSON.stringify(lots),
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: "",
  };
  pkg.danhGiaHsdtMetadata = buildBidEvaluationDraftMetadata({
    existing: pkg.danhGiaHsdtMetadata,
    lotIds: ["lot-1"],
    report: { soBaoCao: "D-L01" },
  });
  pkg.danhGiaHsdtMetadata = buildBidEvaluationDraftMetadata({
    existing: pkg.danhGiaHsdtMetadata,
    lotIds: ["lot-1", "lot-2"],
    report: { soBaoCao: "D-ALL" },
  });
  const metadata = parseEvaluationMetadataStrict(pkg.danhGiaHsdtMetadata);
  const official = getOfficialEvaluationLotState(pkg, metadata);

  assert.equal(metadata.lotBatches, undefined);
  assert.equal(Object.keys(metadata.draftScopes).length, 2);
  assert.equal(official.history.length, 0);
  assert.deepEqual(official.completedLotIds, []);
  assert.equal(resolvePackageResultStatus(pkg), "Đang chấm thầu");
});

test("technical draft keeps 1G2T financial locked while official technical completion still unlocks it", () => {
  const pkg = {
    id: "pkg-1g2t",
    phanLo: "Không",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
  };
  pkg.danhGiaHsdtMetadata = buildBidEvaluationDraftMetadata({
    existing: JSON.stringify({
      schemaVersion: 1,
      is1G2T: true,
      technical: { saved: false },
      financial: { saved: false },
    }),
    round: "technical",
    report: { soBaoCao: "KT-DRAFT" },
  });
  const draftState = buildBidEvaluationPanelState({ pkg, requestedTab: "financial" });
  assert.equal(draftState.currentTab, "technical");
  assert.equal(draftState.isTechnicalSaved, false);

  const completed = parseEvaluationMetadataStrict(pkg.danhGiaHsdtMetadata);
  completed.technical.saved = true;
  pkg.danhGiaHsdtMetadata = JSON.stringify(completed);
  const completedState = buildBidEvaluationPanelState({ pkg, requestedTab: "financial" });
  assert.equal(completedState.currentTab, "financial");
  assert.equal(completedState.isTechnicalSaved, true);
});

test("financial draft remains non-final and does not alter package result status", () => {
  const pkg = {
    id: "pkg-fin",
    phanLo: "Không",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  pkg.danhGiaHsdtMetadata = buildBidEvaluationDraftMetadata({
    existing: JSON.stringify({
      schemaVersion: 1,
      is1G2T: true,
      technical: { saved: true },
      financial: { saved: false },
    }),
    round: "financial",
    report: { soBaoCao: "TC-DRAFT" },
  });
  const metadata = parseEvaluationMetadataStrict(pkg.danhGiaHsdtMetadata);
  assert.equal(metadata.technical.saved, true);
  assert.equal(metadata.financial.saved, false);
  assert.equal(metadata.financial.trangThai, "draft");
  assert.equal(resolvePackageResultStatus(pkg), "Đang chấm thầu");
});
