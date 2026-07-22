import { parseVND, sumVND } from "../shared/formatters.js";

function normalizeLots(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function derivePackagePrice({ phanLo, giaGoiThau = 0, phanLoList = [] } = {}) {
  if (phanLo !== "Có") return parseVND(giaGoiThau) ?? 0;
  return sumVND(normalizeLots(phanLoList).map((lot) => lot?.giaTriPhanLo ?? 0));
}
