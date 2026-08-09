import assert from "node:assert/strict";
import test from "node:test";

import {
  LotListParseError,
  parseLotListForDisplay,
  parseLotListStrict,
} from "../../frontend/packages/lotJsonParser.js";
import { applyAwardResultToPackage } from "../../frontend/packages/bidProcessAwardResult.js";
import { derivePackagePrice } from "../../frontend/packages/packagePricing.js";

test("strict lot parsing accepts arrays, blank storage values, and JSON arrays", () => {
  const lots = [{ id: "lot-1", maPhanLo: "PL-01" }];

  assert.equal(parseLotListStrict(lots), lots);
  assert.deepEqual(parseLotListStrict(null), []);
  assert.deepEqual(parseLotListStrict(undefined), []);
  assert.deepEqual(parseLotListStrict("  "), []);
  assert.deepEqual(parseLotListStrict(JSON.stringify(lots)), lots);
});

test("strict lot parsing throws typed actionable errors without retaining raw payloads", () => {
  const privatePayload = "{private-contractor-data";
  const cases = [
    [privatePayload, "MALFORMED_JSON"],
    ["{\"id\":\"lot-1\"}", "EXPECTED_ARRAY"],
    [{ id: "lot-1" }, "UNSUPPORTED_TYPE"],
  ];

  for (const [value, code] of cases) {
    assert.throws(
      () => parseLotListStrict(value, { context: "award_command" }),
      (error) => {
        assert.equal(error instanceof LotListParseError, true);
        assert.equal(error.name, "LotListParseError");
        assert.equal(error.code, code);
        assert.equal(error.context, "award_command");
        assert.doesNotMatch(error.message, /private-contractor-data/);
        assert.equal(Object.hasOwn(error, "raw"), false);
        return true;
      },
    );
  }
});

test("display parsing recovers once with bounded structured telemetry", () => {
  const events = [];
  const lots = parseLotListForDisplay("{private-contractor-data", {
    context: "award_history",
    onRecover: (event) => events.push(event),
  });

  assert.deepEqual(lots, []);
  assert.deepEqual(events, [{
    code: "MALFORMED_JSON",
    context: "award_history",
    inputKind: "string",
  }]);
  assert.equal(Object.isFrozen(events[0]), true);
  assert.doesNotMatch(JSON.stringify(events), /private-contractor-data/);
});

test("display parsing emits no telemetry for valid or blank values", () => {
  const events = [];
  const options = {
    context: "package_table",
    onRecover: (event) => events.push(event),
  };

  assert.deepEqual(parseLotListForDisplay("[]", options), []);
  assert.deepEqual(parseLotListForDisplay("", options), []);
  assert.deepEqual(parseLotListForDisplay([{ id: "lot-1" }], options), [{ id: "lot-1" }]);
  assert.deepEqual(events, []);
});

test("untrusted telemetry contexts are collapsed to a bounded value", () => {
  const events = [];

  parseLotListForDisplay("null", {
    context: "private/value/that/must/not/become-cardinality",
    onRecover: (event) => events.push(event),
  });

  assert.deepEqual(events, [{
    code: "EXPECTED_ARRAY",
    context: "unknown",
    inputKind: "string",
  }]);
});

test("command callers fail closed on corrupt lot JSON before mutating package results", () => {
  const pkg = {
    phanLo: "Có",
    phanLoList: "{broken",
    nhaThauTrungThauId: "existing-winner",
    giaTrungThau: 900,
  };

  assert.throws(
    () => applyAwardResultToPackage({
      gt: pkg,
      bids: [],
      winnerRows: [],
      tbodyResult: null,
      model: { state: { thongtinmothau: [] } },
    }),
    (error) => error instanceof LotListParseError && error.context === "legacy_award_command",
  );
  assert.equal(pkg.phanLoList, "{broken");
  assert.equal(pkg.nhaThauTrungThauId, "existing-winner");
  assert.equal(pkg.giaTrungThau, 900);

  assert.throws(
    () => derivePackagePrice({ phanLo: "Có", phanLoList: "{}" }),
    (error) => error instanceof LotListParseError && error.context === "package_pricing_command",
  );
});
