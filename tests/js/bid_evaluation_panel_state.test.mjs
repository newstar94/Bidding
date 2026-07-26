import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBidEvaluationPanelState,
  evaluationScopeKey,
} from "../../frontend/packages/BidEvaluationPanelState.js";

const TWO_ENVELOPE = "Một giai đoạn hai túi hồ sơ";

function pkg(overrides = {}) {
  return {
    id: "pkg-1",
    phanLo: "Không",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
    ...overrides,
  };
}

test("legacy two-envelope metadata is normalized before opening the financial tab", () => {
  const state = buildBidEvaluationPanelState({
    pkg: pkg({
      phuongThucLuaChon: TWO_ENVELOPE,
      danhGiaHsdtMetadata: JSON.stringify({
        soBaoCao: "01/BC",
        ngayBaoCao: "2026-07-26",
        saved: true,
      }),
    }),
    requestedTab: "financial",
  });

  assert.equal(state.metadata.is1G2T, true);
  assert.equal(state.metadata.technical.soBaoCao, "01/BC");
  assert.equal(state.metadata.technical.saved, true);
  assert.equal(state.currentTab, "financial");
  assert.equal(state.stepKey, "eval_fin");
  assert.equal(state.isReadOnly, false);
});

test("financial evaluation remains gated until technical evaluation is saved", () => {
  const state = buildBidEvaluationPanelState({
    pkg: pkg({
      phuongThucLuaChon: TWO_ENVELOPE,
      danhGiaHsdtMetadata: JSON.stringify({
        is1G2T: true,
        technical: { saved: false },
        financial: { saved: false },
      }),
    }),
    requestedTab: "financial",
  });

  assert.equal(state.currentTab, "technical");
  assert.equal(state.scopeKey, "pkg-1:technical");
  assert.equal(state.isTechnicalSaved, false);
});

test("a completed report is read-only until its own step enters edit mode", () => {
  const packageRecord = pkg({
    danhGiaHsdtMetadata: JSON.stringify({ saved: true, soBaoCao: "02/BC" }),
  });
  const readOnly = buildBidEvaluationPanelState({ pkg: packageRecord });
  const editing = buildBidEvaluationPanelState({
    pkg: packageRecord,
    editingState: { eval_tech: true },
  });

  assert.equal(readOnly.isCompleted, true);
  assert.equal(readOnly.isReadOnly, true);
  assert.equal(editing.isReadOnly, false);
});

test("a finalized or cancelled package stays locked even when edit state is stale", () => {
  ["Đã có kết quả", "Hủy thầu"].forEach((trangThai) => {
    const state = buildBidEvaluationPanelState({
      pkg: pkg({ trangThai, danhGiaHsdtMetadata: JSON.stringify({ saved: true }) }),
      editingState: { eval_tech: true },
    });
    assert.equal(state.isLocked, true, trangThai);
    assert.equal(state.isTabLocked, true, trangThai);
    assert.equal(state.isReadOnly, true, trangThai);
  });
});

test("qualified technical results lock only the technical tab", () => {
  const packageRecord = pkg({
    phuongThucLuaChon: TWO_ENVELOPE,
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: true },
      financial: { saved: false },
    }),
  });
  const technical = buildBidEvaluationPanelState({ pkg: packageRecord });
  const financial = buildBidEvaluationPanelState({
    pkg: packageRecord,
    requestedTab: "financial",
  });

  assert.equal(technical.isTabLocked, true);
  assert.equal(technical.isReadOnly, true);
  assert.equal(financial.isTabLocked, false);
  assert.equal(financial.isReadOnly, false);
});

test("malformed metadata falls back to an editable empty report", () => {
  const state = buildBidEvaluationPanelState({
    pkg: pkg({ danhGiaHsdtMetadata: "{not-json" }),
  });

  assert.equal(state.currentTab, "unified");
  assert.equal(state.activeMeta.soBaoCao, "");
  assert.deepEqual(state.activeMeta.cvLamRo, []);
  assert.equal(state.isReadOnly, false);
  assert.equal(evaluationScopeKey("pkg-1", "financial"), "pkg-1:financial");
});
