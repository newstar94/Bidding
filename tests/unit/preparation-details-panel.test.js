import test from "node:test";
import assert from "node:assert/strict";

import { renderPreparationDetailsPanel } from "../../frontend/packages/detail/PreparationDetailsPanel.js";

test("preparation details panel renders package information without mutating data", () => {
  const previousDocument = globalThis.document;
  const previousLucide = globalThis.lucide;
  globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
  globalThis.lucide = { createIcons: () => {} };
  try {
    const pkg = {
      id: "gt-1", keHoachId: "kh-1", maGoiThau: "IB01", tenGoiThau: "Gói thầu A",
      trangThai: "Chuẩn bị", hinhThucLuaChon: "Đấu thầu rộng rãi", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ"
    };
    const container = { innerHTML: "" };
    const view = {
      model: {
        state: { chudautu: [{ id: "cdt-1", tenChuDauTu: "Chủ đầu tư A" }] },
        getLatestPlan: () => ({ id: "kh-1", chuDauTuId: "cdt-1", tenKeHoach: "Kế hoạch A" }),
        formatCurrency: () => "1.000 đ",
        formatDate: value => value || "--",
        formatDateWithTime: value => value || "--",
        formatForDateInput: value => value || "",
        formatForDatetimeLocal: value => value || ""
      }
    };
    renderPreparationDetailsPanel(view, { contentWrapper: container, gt: pkg, id: pkg.id, isEditable: false, appController: null });
    assert.match(container.innerHTML, /Thông tin chung/);
    assert.match(container.innerHTML, /IB01/);
    assert.match(container.innerHTML, /Chủ đầu tư A/);
    assert.equal(pkg.trangThai, "Chuẩn bị");
  } finally {
    globalThis.document = previousDocument;
    globalThis.lucide = previousLucide;
  }
});
