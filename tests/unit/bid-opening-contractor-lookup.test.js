import assert from "node:assert/strict";
import test from "node:test";

import { mapPartnerLookupToContractor } from "../../frontend/packages/BidProcessWorkflow.js";

test("maps a remotely looked-up contractor for a newly added opening row", async () => {
  const result = await mapPartnerLookupToContractor("vn0318500205", {
    name: "Công ty TNHH Kim Long Châu",
    org_code: "vn0318500205",
    tax_code: "0318500205",
    representative_name: "Nguyễn Văn A"
  });

  assert.equal(result.tenNhaThau, "Công ty TNHH Kim Long Châu");
  assert.equal(result.maNhaThau, "vn0318500205");
  assert.equal(result.maSoThue, "0318500205");
  assert.equal(result.nguoiDaiDien, "Nguyễn Văn A");
});
