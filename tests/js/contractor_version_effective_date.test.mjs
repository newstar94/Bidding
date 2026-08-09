import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePartnerVersionForDate,
  selectPartnerVersionForDate,
} from "../../frontend/partners/contractorVersionBinding.js";


test("a date before the first partner version has an explicit no-match result", () => {
  const records = [{
    id: "contractor-v1",
    rootId: "contractor-v1",
    phienBan: "01",
    ngayApDung: "2026-01-01",
  }, {
    id: "contractor-v2",
    rootId: "contractor-v1",
    phienBan: "02",
    ngayApDung: "2026-06-01",
  }];

  const result = resolvePartnerVersionForDate(
    records,
    "contractor-v2",
    "2025-12-31",
  );

  assert.equal(result.status, "no_effective_version");
  assert.equal(result.record, null);
  assert.equal(result.firstEffectiveDate, "2026-01-01");
  assert.equal(
    selectPartnerVersionForDate(records, "contractor-v2", "2025-12-31"),
    null,
  );
});
