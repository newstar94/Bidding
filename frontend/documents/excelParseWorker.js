/* global importScripts, self */

importScripts("/vendor/xlsx/xlsx.full.min.js?v=0.20.3");

function parseRows(data) {
  const workbook = self.XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return self.XLSX.utils.sheet_to_json(sheet);
}

function parseSheets(data) {
  const workbook = self.XLSX.read(data, { type: "array", cellDates: true });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return {
      name,
      merges: (sheet["!merges"] || []).map((range) => ({
        s: { r: range.s.r, c: range.s.c },
        e: { r: range.e.r, c: range.e.c },
      })),
      rows: self.XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: true,
      }),
    };
  });
}

self.onmessage = (event) => {
  try {
    const result = event.data?.mode === "sheets"
      ? parseSheets(event.data.data)
      : parseRows(event.data.data);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Không thể đọc nội dung tệp Excel.",
    });
  }
};
