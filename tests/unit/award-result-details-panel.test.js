import test from "node:test";
import assert from "node:assert/strict";

import * as awardResultDetails from "../../frontend/packages/detail/AwardResultDetailsPanel.js";
import { buildAwardResultApprovalMarkup } from "../../frontend/packages/detail/AwardResultApprovalMarkup.js";

const { renderAwardResultDetailsPanel } = awardResultDetails;

function approvalView(bids = []) {
  return {
    model: {
      state: { thongtinmothau: bids, nhathau: [], chudautu: [] },
      getLatestPlan: () => null,
      formatCurrency: (value) => String(value ?? ""),
      formatDate: (value) => String(value ?? ""),
      formatForDateInput: (value) => String(value ?? ""),
      formatDateWithTime: (value) => String(value ?? ""),
      formatVND: (value) => String(value ?? "")
    },
    showPackageDetails: () => {},
    customAlert: async () => {}
  };
}

test("award result details keeps its original public API after markup extraction", () => {
  assert.deepEqual(Object.keys(awardResultDetails).sort(), [
    "buildAwardJointVentureViewData",
    "renderAwardResultDetailsPanel"
  ]);
});

test("approval markup builder returns the render state needed by event binding", () => {
  const pkg = {
    id: "gt-draft",
    trangThai: "draft",
    phanLo: "none",
    hinhThucLuaChon: "open",
    tenGoiThau: "Draft package",
    giaGoiThau: 1000
  };

  const result = buildAwardResultApprovalMarkup(approvalView(), {
    gt: pkg,
    metadata: { result: {} },
    soBctdResult: "",
    ngayBctdResult: "",
    is1G2T2: false
  });

  assert.deepEqual(result.allBids, []);
  assert.equal(result.isDirectOrSpecial, false);
  assert.match(result.html, /id="btn-approve-award"/);
  assert.match(result.html, /id="approve-bidders-tbody"/);
});

test("award result coordinator uses extracted approval markup for a draft package", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { escapeHTML: value => String(value ?? "") };
  globalThis.document = { getElementById: () => null };
  try {
    const container = {
      innerHTML: "",
      querySelector: () => null,
      querySelectorAll: () => []
    };
    const pkg = {
      id: "gt-draft",
      trangThai: "draft",
      phanLo: "none",
      hinhThucLuaChon: "open",
      tenGoiThau: "Draft package",
      giaGoiThau: 1000
    };

    renderAwardResultDetailsPanel(approvalView(), {
      contentWrapper: container,
      gt: pkg,
      id: pkg.id,
      isEditable: true,
      appController: null
    });

    assert.match(container.innerHTML, /id="btn-approve-award"/);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("award result details panel renders an awarded package through the shared result panel", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { escapeHTML: value => String(value ?? "") };
  globalThis.document = { getElementById: () => null };
  try {
    const pkg = {
      id: "gt-1", trangThai: "Đã có kết quả", phanLo: "Không",
      tenGoiThau: "Gói A", maGoiThau: "IB01", giaTrungThau: 1000,
      ngayQuyetDinhKetQua: "2026-07-13"
    };
    const container = { innerHTML: "", querySelector: () => null };
    const view = {
      model: {
        state: { thongtinmothau: [], nhathau: [], chudautu: [] },
        formatCurrency: () => "1.000 đ",
        formatDate: () => "13/07/2026"
      },
      showPackageDetails: () => {},
      customAlert: async () => {}
    };
    renderAwardResultDetailsPanel(view, {
      contentWrapper: container, gt: pkg, id: pkg.id, isEditable: false, appController: null
    });
    assert.match(container.innerHTML, /Gói thầu đã hoàn thành LCNT/);
    assert.match(container.innerHTML, /1\.000 đ/);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
