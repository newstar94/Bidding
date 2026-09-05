import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEditableBidEvaluationConclusionSelect,
} from "../../frontend/packages/bidEvaluationActions.js";

test("editable conclusion offers only explicit pass and fail choices and defaults to pass", () => {
  const markup = buildEditableBidEvaluationConclusionSelect("");

  assert.doesNotMatch(markup, /Chọn/u);
  assert.match(markup, /<option value="Đạt" selected>Đạt<\/option>/u);
  assert.match(markup, /<option value="Không đạt">Không đạt<\/option>/u);
});

test("editable conclusion preserves an existing fail choice", () => {
  const markup = buildEditableBidEvaluationConclusionSelect("Không đạt");

  assert.match(markup, /<option value="Đạt">Đạt<\/option>/u);
  assert.match(markup, /<option value="Không đạt" selected>Không đạt<\/option>/u);
});
