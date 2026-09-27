import { trustedHTML } from "./trustedTypes.js";
import { collectYearMonthOptions, matchesYearMonth } from "./tableDataUtils.js";
import { escapeHtml } from "./view_helpers.js";

function replaceOptions(select, placeholder, values, label, retainSelected = false) {
  if (!select) return;
  const selected = select.value;
  const available = retainSelected && selected && !values.includes(selected)
    ? [...values, selected] : values;
  select.innerHTML = trustedHTML(`<option value="">${escapeHtml(placeholder)}</option>`
    + available.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(label(value))}</option>`).join(""));
  select.value = available.includes(selected) ? selected : "";
}

export function populateYearMonthFilters({ records, getDate, yearSelect, monthSelect, retainSelected = false }) {
  const { years, months } = collectYearMonthOptions(records, getDate);
  replaceOptions(yearSelect, "Năm", years, (year) => year, retainSelected);
  replaceOptions(monthSelect, "Tháng", months, (month) => `Tháng ${month}`, retainSelected);
  return { years, months };
}

export { matchesYearMonth };
