import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const JS_CRITICAL_COVERAGE_THRESHOLDS = Object.freeze({
  "frontend/app/BiddingModel.js": { line: 65, branch: 65, functions: 70 },
  "frontend/app/BrowserDB.js": { line: 70, branch: 55, functions: 75 },
  "frontend/app/SyncPullService.js": { line: 58, branch: 50, functions: 60 },
  "frontend/app/WebSocketSyncClient.js": { line: 70, branch: 50, functions: 80 },
  "frontend/app/WorkspaceDataStore.js": { line: 90, branch: 75, functions: 90 },
  "frontend/app/WorkspaceMutationOutbox.js": { line: 55, branch: 60, functions: 65 },
  "frontend/app/WorkspaceMutationOutboxStore.js": { line: 90, branch: 75, functions: 90 },
  "frontend/packages/packageAggregateSnapshot.js": { line: 95, branch: 60, functions: 95 },
  "frontend/packages/lotJsonParser.js": { line: 100, branch: 80, functions: 100 },
  "frontend/partners/contractorVersionBinding.js": { line: 75, branch: 40, functions: 70 },
  "frontend/shared/MutationService.js": { line: 90, branch: 80, functions: 95 },
  "frontend/shared/apiClient.js": { line: 78, branch: 70, functions: 80 },
  "frontend/shared/trustedTypes.js": { line: 65, branch: 55, functions: 55 },
  "frontend/shared/versionResolver.js": { line: 85, branch: 60, functions: 85 },
});

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

export function parseJsCoverageTable(reportText) {
  const files = {};
  const stack = [];
  for (const rawLine of String(reportText || "").split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_ESCAPE, "");
    const cells = line.split("|");
    if (cells.length < 4) continue;
    const labelCell = cells[0].replace(/^ℹ /, "");
    const depth = labelCell.length - labelCell.trimStart().length;
    const name = labelCell.trim();
    if (!name || name === "file" || name === "all files") continue;
    stack[depth] = name;
    stack.length = depth + 1;
    const metricCells = cells.slice(1, 4).map((cell) => cell.trim());
    if (metricCells.some((cell) => cell === "")) continue;
    const [lineCoverage, branchCoverage, functionCoverage] = metricCells.map(Number);
    if (![lineCoverage, branchCoverage, functionCoverage].every(Number.isFinite)) continue;
    files[stack.join("/")] = {
      line: lineCoverage,
      branch: branchCoverage,
      functions: functionCoverage,
    };
  }
  return files;
}

export function checkJsCriticalCoverage(
  reportText,
  thresholds = JS_CRITICAL_COVERAGE_THRESHOLDS,
) {
  const files = parseJsCoverageTable(reportText);
  const errors = [];
  for (const [filename, minimums] of Object.entries(thresholds)) {
    const actual = files[filename];
    if (!actual) {
      errors.push(`${filename}: missing from coverage report`);
      continue;
    }
    for (const metric of ["line", "branch", "functions"]) {
      if (actual[metric] + 1e-9 < minimums[metric]) {
        errors.push(
          `${filename}: ${metric} ${actual[metric].toFixed(2)}% < ${minimums[metric].toFixed(2)}%`,
        );
      }
    }
  }
  return errors;
}

const isCli = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("Coverage report text path is required.");
  const errors = checkJsCriticalCoverage(fs.readFileSync(reportPath, "utf8"));
  if (errors.length) {
    process.stderr.write(`Critical JS coverage ratchet failed:\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Critical JS coverage ratchet passed (${Object.keys(JS_CRITICAL_COVERAGE_THRESHOLDS).length} modules).\n`,
    );
  }
}
