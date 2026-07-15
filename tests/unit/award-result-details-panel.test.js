import test from "node:test";
import assert from "node:assert/strict";

import { renderAwardResultDetailsPanel } from "../../frontend/packages/detail/AwardResultDetailsPanel.js";

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
