import evaluationExcelManifest from "../../shared/bid_evaluation_excel_columns.json" with { type: "json" };

export const BID_EVALUATION_EXCEL_COLUMNS = Object.freeze(
  evaluationExcelManifest.columns,
);

/** @internal Test helper for constructing canonical workbook fixtures. */
export function evaluationExcelColumnLabel(columnKey) {
  const column = BID_EVALUATION_EXCEL_COLUMNS[columnKey];
  if (!column?.canonical) throw new Error(`Unknown evaluation Excel column: ${columnKey}`);
  return column.canonical;
}

export function readEvaluationExcelValue(row, columnKey, fallback = "") {
  const column = BID_EVALUATION_EXCEL_COLUMNS[columnKey];
  if (!column) throw new Error(`Unknown evaluation Excel column: ${columnKey}`);
  for (const header of [column.canonical, ...(column.aliases || [])]) {
    if (Object.hasOwn(row || {}, header)) return row[header];
  }
  return fallback;
}
