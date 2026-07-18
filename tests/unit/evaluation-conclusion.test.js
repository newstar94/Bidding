import test from "node:test";
import assert from "node:assert/strict";

import { renderEvaluationLockNotice } from "../../frontend/packages/detail/EvaluationConclusion.js";

test("evaluation conclusion labels lock state for every evaluation mode", () => {
  assert.match(renderEvaluationLockNotice(), /E-HSDT đã được khóa/);
  assert.match(renderEvaluationLockNotice({ isTwoEnvelope: true, stage: "technical" }), /kỹ thuật đã được khóa/);
  assert.match(renderEvaluationLockNotice({ isTwoEnvelope: true, stage: "financial" }), /tài chính đã được khóa/);
});
