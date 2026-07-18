import test from "node:test";
import assert from "node:assert/strict";

import { renderInvitationPanel } from "../../frontend/packages/detail/InvitationPanel.js";

test("invitation panel reuses list cards and switches edit actions", () => {
  const container = { innerHTML: "" };
  renderInvitationPanel(container, { id: 'gt-1" bad="x' }, { summaryHtml: "<div>summary</div>" });
  assert.match(container.innerHTML, /gt-giahan-tbody/);
  assert.match(container.innerHTML, /gt-yeucaulamro-tbody/);
  assert.match(container.innerHTML, /gt-traloilamro-tbody/);
  assert.match(container.innerHTML, /Chỉnh sửa/);
  assert.doesNotMatch(container.innerHTML, / bad="x/);
  renderInvitationPanel(container, { id: "gt-1" }, { editMode: true });
  assert.match(container.innerHTML, /Lưu thông tin mời thầu/);
  assert.match(container.innerHTML, /btn-them-giahan[^>]+compact-action/);
  assert.doesNotMatch(container.innerHTML, /btn-them-giahan[^>]+is-hidden/);
});
