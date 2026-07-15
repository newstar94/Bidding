import test from "node:test";
import assert from "node:assert/strict";

import { renderPreparationActionPanel } from "../../frontend/packages/detail/PreparationPanel.js";

test("preparation panel exposes the invitation command only while preparing", () => {
  const container = { innerHTML: "" };
  renderPreparationActionPanel(container, { id: 'gt-1" onclick="bad', trangThai: "Chuẩn bị" });
  assert.match(container.innerHTML, /phatHanhHsmtGoiThau/);
  assert.doesNotMatch(container.innerHTML, /onclick="bad/);
  renderPreparationActionPanel(container, { id: "gt-1", trangThai: "Đang mời thầu" });
  assert.doesNotMatch(container.innerHTML, /phatHanhHsmtGoiThau/);
  assert.match(container.innerHTML, /Đang mời thầu/);
});
