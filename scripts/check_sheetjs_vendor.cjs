"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(projectRoot, "views", "vendor", "xlsx", "xlsx.full.min.js"),
  "utf8"
);
const moduleContainer = { exports: {} };
const XLSX = new Function(
  "module",
  "exports",
  `${source}\n;return module.exports;`
)(moduleContainer, moduleContainer.exports);

if (XLSX.version !== "0.20.3") {
  throw new Error(`Unexpected SheetJS runtime version: ${XLSX.version}`);
}

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.aoa_to_sheet([
    ["Mã", "Tên"],
    ["01", "Kiểm thử tiếng Việt"],
  ]),
  "Dữ liệu"
);
const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
const roundTrip = XLSX.read(bytes, { type: "buffer" });
if (roundTrip.SheetNames[0] !== "Dữ liệu") {
  throw new Error("SheetJS XLSX round-trip failed.");
}

const pollutionProbe = XLSX.utils.aoa_to_sheet([
  ["__proto__", "constructor", "prototype"],
  ["blocked", "blocked", "blocked"],
]);
XLSX.utils.sheet_to_json(pollutionProbe);
if (Object.prototype.polluted !== undefined) {
  throw new Error("SheetJS prototype pollution guard failed.");
}

const malformedStartedAt = Date.now();
try {
  XLSX.read(Uint8Array.from([80, 75, 3, 4, 0, 0, 0]), { type: "array" });
} catch (_error) {
  // Rejection is expected. The bounded runtime check below guards regressions
  // that turn malformed data into excessive synchronous work.
}
if (Date.now() - malformedStartedAt > 2_000) {
  throw new Error("SheetJS malformed workbook check exceeded 2 seconds.");
}

console.log("SheetJS 0.20.3 runtime security smoke check passed.");
