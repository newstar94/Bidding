import test from "node:test";
import assert from "node:assert/strict";

import {
  getContractorViewOnly,
  getHolidays,
  getLotWinnersStore,
  hasHolidays,
  setContractorViewOnly,
  setHolidays,
} from "../../frontend/shared/runtimeState.js";

test("named runtime state replaces implicit window caches", () => {
  setHolidays({ "2026": { holidays: ["2026-01-01"] } });
  setContractorViewOnly(true);
  getLotWinnersStore()["gt-1"] = [{ maPhanLo: "L01" }];

  assert.equal(hasHolidays(), true);
  assert.equal(getHolidays()["2026"].holidays[0], "2026-01-01");
  assert.equal(getContractorViewOnly(), true);
  assert.equal(getLotWinnersStore()["gt-1"][0].maPhanLo, "L01");

  setContractorViewOnly(false);
});

