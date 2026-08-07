import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  applyViolationNameClass,
  refreshSavedOpeningViolationChecks,
  shouldRefreshSavedOpeningViolationCheck,
  updateOpeningViolationPresentation,
} from "../../frontend/packages/openingContractorLookup.js";


function fakeClassList() {
  const values = new Set();
  return {
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    },
    contains(name) { return values.has(name); },
  };
}


test("only VIOLATION_CONFIRMED adds the violator name class", () => {
  const element = { classList: fakeClassList() };
  for (const status of [
    "NO_ACTIVE_VIOLATION",
    "REVIEW_REQUIRED",
    "LOOKUP_FAILED",
    "NOT_CHECKED",
    "IDENTITY_CONFLICT",
  ]) {
    applyViolationNameClass(element, status);
    assert.equal(element.classList.contains("bidder-name--violator"), false);
  }
  applyViolationNameClass(element, "VIOLATION_CONFIRMED");
  assert.equal(element.classList.contains("bidder-name--violator"), true);
});


test("legacy saved opening rows without a violation status are refreshed", () => {
  assert.equal(
    shouldRefreshSavedOpeningViolationCheck(
      { id: "bid-1", maDinhDanh: "vn0101905830" },
      "vn0101905830",
    ),
    true,
  );
});

test("a failed lookup is retried while human verdicts are preserved", () => {
  const row = (violationStatus) => ({ id: "bid-1", maDinhDanh: "vn0101905830", violationStatus });

  assert.equal(shouldRefreshSavedOpeningViolationCheck(row("LOOKUP_FAILED")), true);
  assert.equal(shouldRefreshSavedOpeningViolationCheck(row("NOT_CHECKED")), true);
  assert.equal(shouldRefreshSavedOpeningViolationCheck(row("REVIEW_REQUIRED")), false);
  assert.equal(shouldRefreshSavedOpeningViolationCheck(row("IDENTITY_CONFLICT")), false);
  assert.equal(shouldRefreshSavedOpeningViolationCheck(row("VIOLATION_CONFIRMED")), false);
});

test("a stored confirmed violation is never downgraded by unchecked members", () => {
  const ventureName = { classList: fakeClassList() };
  const type = { value: "Liên danh" };
  const row = {
    // The saved bid is a known violator, but the member rows were rehydrated
    // from contractor master data and carry no verdict.
    _violationStatus: "VIOLATION_CONFIRMED",
    _leadMemberViolationStatus: "NOT_CHECKED",
    _thanhVienLienDanh: [{ violationStatus: "NOT_CHECKED" }],
    querySelector(selector) {
      if (selector === ".mt-loai-nha-thau") return type;
      if (selector === ".mt-ten-nha-thau") return ventureName;
      return null;
    },
  };

  assert.equal(updateOpeningViolationPresentation(row), "VIOLATION_CONFIRMED");
  assert.equal(ventureName.classList.contains("bidder-name--violator"), true);
});

test("a joint venture without loaded members is still checked as a whole", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ violationStatus: "VIOLATION_CONFIRMED", bidClosingAt: "2026-08-01" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const bid = {
    id: "bid-1",
    loaiNhaThau: "Liên danh",
    maDinhDanh: "vn0101905830",
    thanhVienLienDanh: [],
  };

  try {
    await refreshSavedOpeningViolationChecks("pkg-1", [bid]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }

  assert.equal(requests.length, 1, "the bid itself must be resolved");
  assert.equal(bid.violationStatus, "VIOLATION_CONFIRMED");
});


test("joint venture and only confirmed members are marked", () => {
  const ventureName = { classList: fakeClassList() };
  const type = { value: "Liên danh" };
  const row = {
    _leadMemberViolationStatus: "NO_ACTIVE_VIOLATION",
    _thanhVienLienDanh: [
      { violationStatus: "VIOLATION_CONFIRMED" },
      { violationStatus: "NO_ACTIVE_VIOLATION" },
      { violationStatus: "REVIEW_REQUIRED" },
    ],
    querySelector(selector) {
      if (selector === ".mt-loai-nha-thau") return type;
      if (selector === ".mt-ten-nha-thau") return ventureName;
      return null;
    },
  };
  assert.equal(updateOpeningViolationPresentation(row), "VIOLATION_CONFIRMED");
  assert.equal(ventureName.classList.contains("bidder-name--violator"), true);
  assert.equal(
    row._thanhVienLienDanh.filter(
      (member) => member.violationStatus === "VIOLATION_CONFIRMED"
    ).length,
    1,
  );
});


test("violation UI adds one color-only class and no warning presentation", () => {
  const css = fs.readFileSync("views/css/views.css", "utf8");
  const lookupSource = fs.readFileSync(
    "frontend/packages/openingContractorLookup.js",
    "utf8",
  );
  assert.match(
    css,
    /\.bidder-name--violator\s*\{\s*color:\s*var\(--color-danger\);\s*\}/,
  );
  assert.doesNotMatch(lookupSource, /badge|tooltip|toast|modal|popup/i);
  assert.doesNotMatch(lookupSource, /Có vi phạm|Xem chi tiết|decisionNumber/i);
});
