import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { ensureXlsxLoaded } from "../shared/externalAssets.js";
import { readAndValidateExcelFile } from "./excelArchiveGuard.js";
import { excelParseWorkerClient } from "./ExcelParseWorkerClient.js";
import { reportExcelWorkerFallback } from "../shared/releaseDiagnostics.js";

async function parseWithoutWorker(data, mode) {
  const XLSX = await ensureXlsxLoaded();
  const workbook = XLSX.read(data, {
    type: "array",
    ...(mode === "sheets" ? { cellDates: true } : {}),
  });
  if (mode === "rows") {
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  }
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
        blankrows: true,
      }),
    };
  });
}

async function parseExcel(data, mode, options) {
  try {
    return await excelParseWorkerClient.parse(data, mode, options);
  } catch (error) {
    if (error?.code !== "WORKER_UNAVAILABLE") throw error;
    void reportExcelWorkerFallback();
    return parseWithoutWorker(data, mode);
  }
}

export async function readExcelRows(file, options = {}) {
  const data = await readAndValidateExcelFile(file);
  return parseExcel(data, "rows", options);
}
export async function readExcelWorkbookSheets(file, options = {}) {
  const data = await readAndValidateExcelFile(file);
  return parseExcel(data, "sheets", options);
}
export function showExcelImportSaveButton() {
  const saveBtn = document.getElementById("btn-save-excel-import");
  if (!saveBtn) return;
  saveBtn.disabled = false;
  setRuntimeStyle(saveBtn, "display", "inline-flex");
}
