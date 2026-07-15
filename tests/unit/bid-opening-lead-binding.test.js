import assert from "node:assert/strict";
import test from "node:test";

import { resolveOpeningLeadContractor } from "../../frontend/packages/BidProcessWorkflow.js";

test("a changed lead code ignores the previously bound joint-venture contractor", () => {
  const oldContractor = {
    id: "contractor-old",
    maNhaThau: "vn4300853422",
    tenNhaThau: "Nhà thầu cũ"
  };
  const currentContractor = {
    id: "contractor-current",
    maNhaThau: "vn5801569485",
    tenNhaThau: "Nhà thầu mới"
  };
  const model = { state: { nhathau: [oldContractor, currentContractor] } };

  const result = resolveOpeningLeadContractor(
    model,
    [oldContractor, currentContractor],
    "vn5801569485",
    "contractor-old"
  );

  assert.equal(result?.id, "contractor-current");
  assert.equal(result?.tenNhaThau, "Nhà thầu mới");
});
