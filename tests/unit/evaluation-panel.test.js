import test from "node:test";
import assert from "node:assert/strict";

import { renderEvaluationPanel } from "../../frontend/packages/detail/EvaluationPanel.js";

test("evaluation panel reuses one shell for technical and financial modes", () => {
  const container = { innerHTML: "" };
  renderEvaluationPanel(container, { id: "gt-1", tenGoiThau: "Gói <1>" }, { mode: "technical" });
  assert.match(container.innerHTML, /quytrinh2-warning-msg/);
  assert.match(container.innerHTML, /tab-btn-hsdxt-kt" class="active/);
  assert.match(container.innerHTML, /Gói &lt;1&gt;/);
  renderEvaluationPanel(container, { id: "gt-1", tenGoiThau: "Gói 1" }, { mode: "financial" });
  assert.doesNotMatch(container.innerHTML, /quytrinh2-warning-msg/);
  assert.match(container.innerHTML, /tab-btn-hsdxt-tc" class="active/);
});
