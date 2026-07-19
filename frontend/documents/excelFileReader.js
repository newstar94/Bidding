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
export function showExcelImportSaveButton() {
  const saveBtn = document.getElementById("btn-save-excel-import");
  if (!saveBtn) return;
  saveBtn.disabled = false;
  setRuntimeStyle(saveBtn, "display", "inline-flex");
}
