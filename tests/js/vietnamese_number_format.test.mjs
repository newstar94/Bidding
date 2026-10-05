import assert from "node:assert/strict";
import test from "node:test";

import {
  formatVietnameseNumber,
  parseVietnameseNumber,
} from "../../frontend/shared/formatters.js";

test("formats decimal and grouped values with Vietnamese separators", () => {
  assert.equal(formatVietnameseNumber(97.05), "97,05");
  assert.equal(formatVietnameseNumber(1234.56), "1.234,56");
  assert.equal(formatVietnameseNumber(1234.5), "1.234,5");
});

test("parses canonical and Vietnamese number input without changing the numeric value", () => {
  assert.equal(parseVietnameseNumber("97,05"), 97.05);
  assert.equal(parseVietnameseNumber("97.05"), 97.05);
  assert.equal(parseVietnameseNumber("1.234,56"), 1234.56);
  assert.equal(parseVietnameseNumber("1,234.56"), 1234.56);
  assert.equal(parseVietnameseNumber("Đạt"), null);
});
