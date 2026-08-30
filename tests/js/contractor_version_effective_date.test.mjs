import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePartnerVersionForDate,
  selectPartnerVersionForDate,
} from "../../frontend/partners/contractorVersionBinding.js";
import {
  resolveDatedContractPartnerBindings,
} from "../../frontend/contracts/HopDongWorkflow.js";


test("a date before the first partner version uses the first version as baseline", () => {
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

  assert.equal(result.status, "matched");
  assert.equal(result.record.id, "contractor-v1");
  assert.equal(result.firstEffectiveDate, "2026-01-01");
  assert.equal(
    selectPartnerVersionForDate(records, "contractor-v2", "2025-12-31"),
    records[0],
  );
});

test("contract bindings use the first investor and contractor versions before their dates", () => {
  const investors = [{
    id: "investor-v0",
    rootId: "investor-v0",
    phienBan: "00",
    ngayApDung: "2026-02-01",
  }, {
    id: "investor-v1",
    rootId: "investor-v0",
    phienBan: "01",
    ngayApDung: "2026-07-01",
  }];
  const contractors = [{
    id: "contractor-v0",
    rootId: "contractor-v0",
    phienBan: "00",
    ngayApDung: "2026-03-01",
  }, {
    id: "contractor-v1",
    rootId: "contractor-v0",
    phienBan: "01",
    ngayApDung: "2026-08-01",
  }];

  const result = resolveDatedContractPartnerBindings({
    investors,
    contractors,
    selectedInvestorId: "investor-v1",
    selectedContractorId: "contractor-v1",
    businessDate: "2025-12-01",
  });

  assert.deepEqual(result, {
    investorId: "investor-v0",
    contractorId: "contractor-v0",
  });
});

test("partner version selection remains date-effective between and after versions", () => {
  const records = [{
    id: "partner-v0",
    rootId: "partner-v0",
    phienBan: "00",
    ngayApDung: "2026-01-01",
  }, {
    id: "partner-v1",
    rootId: "partner-v0",
    phienBan: "01",
    ngayApDung: "2026-06-01",
  }];

  assert.equal(
    selectPartnerVersionForDate(records, "partner-v1", "2026-04-01").id,
    "partner-v0",
  );
  assert.equal(
    selectPartnerVersionForDate(records, "partner-v0", "2026-09-01").id,
    "partner-v1",
  );
});
