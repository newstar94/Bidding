import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const frontendRoot = path.join(root, "frontend");
const defaultLimit = 64 * 1024;
const temporaryLimits = new Map(Object.entries({
  "frontend/packages/detail/AwardResultDetailsPanel.js": 96 * 1024,
  "frontend/packages/BidProcessWorkflow.js": 88 * 1024,
  "frontend/packages/BidEvaluationWorkflow.js": 80 * 1024,
  "frontend/documents/wordVariableManifest.js": 68 * 1024
}));
const ignoredGeneratedOrDataModules = new Set([
  "frontend/documents/wordVariableManifest.js"
]);
const failures = [];
const warnings = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.name.endsWith(".js")) inspect(absolute);
  }
}

function inspect(absolute) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const bytes = fs.statSync(absolute).size;
  const limit = temporaryLimits.get(relative) || defaultLimit;
  if (bytes > limit) failures.push(`${relative}: ${bytes} bytes > ${limit} bytes`);
  if (bytes > defaultLimit && !ignoredGeneratedOrDataModules.has(relative)) {
    warnings.push(`${relative}: ${(bytes / 1024).toFixed(1)} KiB (temporary ceiling ${(limit / 1024).toFixed(0)} KiB)`);
  }
}

walk(frontendRoot);
if (warnings.length) console.log(`Oversized modules scheduled for splitting:\n${warnings.join("\n")}`);
if (failures.length) throw new Error(`Source module size budget exceeded:\n${failures.join("\n")}`);
console.log("Source module size budget passed.");
