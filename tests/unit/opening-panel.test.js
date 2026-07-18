import test from "node:test";
import assert from "node:assert/strict";

import { renderOpeningPanel } from "../../frontend/packages/detail/OpeningPanel.js";

test("opening panel renders the correct labels and escapes package data", () => {
  const container = { innerHTML: "" };
  renderOpeningPanel(container, { id: 'gt-1" bad="1', tenGoiThau: "A < B" });
  assert.match(container.innerHTML, /Thêm Nhà thầu nộp hồ sơ/);
  assert.match(container.innerHTML, /A &lt; B/);
  assert.doesNotMatch(container.innerHTML, / bad="1/);
  renderOpeningPanel(container, { id: "gt-1", tenGoiThau: "A" }, { isDirectOrSpecial: true });
  assert.match(container.innerHTML, /Thêm nhà thầu/);
  assert.match(container.innerHTML, /Lưu thông tin/);
});
