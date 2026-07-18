import test from "node:test";
import assert from "node:assert/strict";
import { populateYearMonthFilters } from "../../frontend/shared/YearMonthFilter.js";

function select(value = "") {
  return { value, innerHTML: "" };
}

test("year/month filters share option rendering and preserve valid selections", () => {
  const yearSelect = select("2026");
  const monthSelect = select("7");
  const result = populateYearMonthFilters({
    records: [{ date: "2026-07-13" }, { date: "2025-02-01" }],
    getDate: (record) => record.date,
    yearSelect,
    monthSelect
  });
  assert.deepEqual(result, { years: ["2026", "2025"], months: ["7", "2"] });
  assert.equal(yearSelect.value, "2026");
  assert.equal(monthSelect.value, "7");
  assert.match(monthSelect.innerHTML, /Tháng 7/);
});
