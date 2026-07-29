import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { ensureXlsxLoaded } from "../shared/externalAssets.js";
import { readAndValidateExcelFile } from "./excelArchiveGuard.js";
export async function readExcelRows(file) {
  const data = await readAndValidateExcelFile(file);
  const XLSX = await ensureXlsxLoaded();
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet);
}
export async function readExcelWorkbookSheets(file) {
  const data = await readAndValidateExcelFile(file);
  const XLSX = await ensureXlsxLoaded();
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return {
    name,
    merges: (sheet["!merges"] || []).map((range) => ({
      s: { r: range.s.r, c: range.s.c },
      e: { r: range.e.r, c: range.e.c },
    })),
    rows: XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      // Preserve physical row numbers for import previews and validation.
      blankrows: true,
    }),
  };
  });
}
export function showExcelImportSaveButton() {
  const saveBtn = document.getElementById("btn-save-excel-import");
  if (!saveBtn) return;
  saveBtn.disabled = false;
  setRuntimeStyle(saveBtn, "display", "inline-flex");
}
