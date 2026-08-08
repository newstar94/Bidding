import assert from "node:assert/strict";
import test from "node:test";

import { validationSummaryLabel } from "../../frontend/shared/FormValidation.js";


test("validation summary uses the existing error count", () => {
  assert.equal(validationSummaryLabel(3), "3 lỗi cần xử lý");
  assert.equal(validationSummaryLabel(-1), "0 lỗi cần xử lý");
});
