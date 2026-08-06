import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  applyViolationNameClass,
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
