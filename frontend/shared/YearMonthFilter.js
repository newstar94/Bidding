import { collectYearMonthOptions, matchesYearMonth } from "./tableDataUtils.js";

function replaceOptions(select, placeholder, values, label) {
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>`
    + values.map((value) => `<option value="${value}">${label(value)}</option>`).join("");
  select.value = values.includes(selected) ? selected : "";
}

export function populateYearMonthFilters({ records, getDate, yearSelect, monthSelect }) {
  const { years, months } = collectYearMonthOptions(records, getDate);
  replaceOptions(yearSelect, "Năm", years, (year) => year);
  replaceOptions(monthSelect, "Tháng", months, (month) => `Tháng ${month}`);
  return { years, months };
}

export { matchesYearMonth };
