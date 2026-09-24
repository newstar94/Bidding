import assert from "node:assert/strict";
import test from "node:test";

import { shouldCommitWardResponse } from "../../frontend/shared/PartnerHelpers.js";

function decision(overrides = {}) {
  const province = overrides.province || {};
  const ward = overrides.ward || {};
  return shouldCommitWardResponse({
    loadGeneration: 2,
    currentGeneration: 2,
    selectedProvince: "B",
    requestedProvince: "B",
    provinceSelect: province,
    wardSelect: ward,
    currentProvinceSelect: province,
    currentWardSelect: ward,
    initGeneration: 4,
    currentInitGeneration: 4,
    ...overrides,
  });
}

test("latest province response wins over an older A response", () => {
  const province = {};
  const ward = {};
  assert.equal(decision({ province, ward }), true);
  assert.equal(decision({
    province,
    ward,
    loadGeneration: 1,
    requestedProvince: "A",
    selectedProvince: "B",
  }), false);
});

test("rerendered selects reject a response owned by the old DOM", () => {
  const oldProvince = {};
  const oldWard = {};
  assert.equal(decision({
    province: oldProvince,
    ward: oldWard,
    currentProvinceSelect: {},
    currentWardSelect: {},
  }), false);
  assert.equal(decision({
    province: oldProvince,
    ward: oldWard,
    currentInitGeneration: 5,
  }), false);
});

test("an abort/error path cannot commit after a newer generation", () => {
  assert.equal(decision({ currentGeneration: 3 }), false);
  assert.equal(decision({ currentWardSelect: {} }), false);
});
