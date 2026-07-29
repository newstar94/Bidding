import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { buildOpeningActionState } from "../../frontend/packages/BidProcessWorkflow.js";
import { buildBidEvaluationPanelState } from "../../frontend/packages/BidEvaluationPanelState.js";
import { buildFinancialOpeningState } from "../../frontend/packages/detail/FinancialOpeningPanel.js";
import { buildQualifiedApprovalState } from "../../frontend/packages/detail/QualifiedApprovalPanel.js";
import {
  resolveWorkflowActionMode,
  setWorkflowActionVisibility,
} from "../../frontend/packages/workflowActionState.js";

const ONE_ENVELOPE = "Một giai đoạn một túi hồ sơ";
const TWO_ENVELOPE = "Một giai đoạn hai túi hồ sơ";

const qualifiedBid = {
  id: "bid-1",
  goiThauId: "package-1",
  maNhaThau: "NT-1",
  danhGiaKetLuan: "Đạt",
  giaDuThau: 0,
};

function viewWithBids(bids, editingState = {}) {
  return {
    _editingState: editingState,
    model: { state: { thongtinmothau: bids } },
  };
}

test("shared action rule prioritizes the saved next step over stale edit state", () => {
  assert.equal(resolveWorkflowActionMode(), "save");
  assert.equal(resolveWorkflowActionMode({ isCompleted: true }), "edit");
  assert.equal(resolveWorkflowActionMode({ isCompleted: true, isEditing: true }), "save");
  assert.equal(resolveWorkflowActionMode({ isEditing: true, isNextStepSaved: true }), "hidden");
  assert.equal(resolveWorkflowActionMode({ isFinal: true }), "hidden");

  const button = { hidden: false, disabled: false };
  setWorkflowActionVisibility(button, false);
  assert.deepEqual(button, { hidden: true, disabled: true });
  setWorkflowActionVisibility(button, true);
  assert.deepEqual(button, { hidden: false, disabled: false });
});

test("opening actions use edit until the next step is saved for both 1G1T and 1G2T", () => {
  for (const phuongThucLuaChon of [ONE_ENVELOPE, TWO_ENVELOPE]) {
    const pkg = {
      id: "package-1",
      phuongThucLuaChon,
      trangThai: "Đang chấm thầu",
      danhGiaHsdtMetadata: "",
    };
    assert.equal(buildOpeningActionState({
      pkg,
      hasSavedOpeningData: true,
    }).actionMode, "edit");
    assert.equal(buildOpeningActionState({
      pkg,
      hasSavedOpeningData: true,
      isEditing: true,
    }).actionMode, "save");

    const nextStepMetadata = phuongThucLuaChon === TWO_ENVELOPE
      ? { is1G2T: true, technical: { saved: true } }
      : { saved: true };
    assert.equal(buildOpeningActionState({
      pkg: { ...pkg, danhGiaHsdtMetadata: JSON.stringify(nextStepMetadata) },
      hasSavedOpeningData: true,
      isEditing: true,
    }).actionMode, "hidden");
  }
});

test("1G1T evaluation changes from edit to hidden after the result step is saved", () => {
  const base = {
    id: "package-1",
    phuongThucLuaChon: ONE_ENVELOPE,
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({ saved: true }),
  };

  assert.equal(buildBidEvaluationPanelState({ pkg: base }).actionMode, "edit");
  assert.equal(buildBidEvaluationPanelState({
    pkg: { ...base, trangThai: "Đã có kết quả" },
  }).actionMode, "hidden");
});

test("1G2T technical and financial evaluations hide actions after their next step is saved", () => {
  const technical = {
    id: "package-1",
    phuongThucLuaChon: TWO_ENVELOPE,
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: false },
      financial: { saved: false },
    }),
  };
  assert.equal(buildBidEvaluationPanelState({ pkg: technical }).actionMode, "edit");

  const qualifiedSaved = {
    ...technical,
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: true },
      financial: { saved: true },
    }),
  };
  assert.equal(buildBidEvaluationPanelState({ pkg: qualifiedSaved }).actionMode, "hidden");
  assert.equal(buildBidEvaluationPanelState({
    pkg: qualifiedSaved,
    requestedTab: "financial",
  }).actionMode, "edit");
  assert.equal(buildBidEvaluationPanelState({
    pkg: { ...qualifiedSaved, trangThai: "Đã có kết quả" },
    requestedTab: "financial",
  }).actionMode, "hidden");
});

test("1G2T qualified approval hides edit after financial opening is saved", () => {
  const pkg = {
    id: "package-1",
    phuongThucLuaChon: TWO_ENVELOPE,
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: true },
      financial: { saved: false },
    }),
  };
  assert.equal(buildQualifiedApprovalState({
    view: viewWithBids([qualifiedBid]),
    pkg,
    isTechEvalSaved: true,
  }).actionMode, "edit");
  assert.equal(buildQualifiedApprovalState({
    view: viewWithBids([{ ...qualifiedBid, giaDuThau: 500_000 }]),
    pkg,
    isTechEvalSaved: true,
  }).actionMode, "hidden");
});

test("1G2T financial opening hides edit after financial evaluation is saved", () => {
  const metadata = {
    is1G2T: true,
    technical: { saved: true, qualifiedSaved: true },
    financial: { saved: false },
  };
  const pkg = {
    id: "package-1",
    phuongThucLuaChon: TWO_ENVELOPE,
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify(metadata),
  };
  const bids = [{ ...qualifiedBid, giaDuThau: 500_000 }];
  assert.equal(buildFinancialOpeningState({ view: viewWithBids(bids), pkg }).actionMode, "edit");
  assert.equal(buildFinancialOpeningState({
    view: viewWithBids(bids),
    pkg: {
      ...pkg,
      danhGiaHsdtMetadata: JSON.stringify({
        ...metadata,
        financial: { saved: true },
      }),
    },
  }).actionMode, "hidden");
});

test("opening workflow uses semantic hidden visibility for mutation actions", () => {
  const source = fs.readFileSync("frontend/packages/BidProcessWorkflow.js", "utf8");
  assert.match(source, /setWorkflowActionVisibility\(addBidBtn2,/);
  assert.match(source, /setWorkflowActionVisibility\(saveBtn2,/);
});

test("semantic hidden actions stay invisible despite opening button id styles", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <button id="btn-mothau-add-bid" hidden>Thêm Nhà thầu nộp hồ sơ</button>
      <button id="btn-mothau-save" hidden>Lưu thông tin mở thầu</button>`);
    for (const path of ["../../views/css/base.css", "../../views/css/views.css"]) {
      await page.addStyleTag({ path: fileURLToPath(new URL(path, import.meta.url)) });
    }
    const displays = await page.locator("button").evaluateAll(
      (buttons) => buttons.map((button) => getComputedStyle(button).display),
    );
    assert.deepEqual(displays, ["none", "none"]);
  } finally {
    await browser.close();
  }
});
