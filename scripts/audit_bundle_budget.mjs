import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "dist", ".vite", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entryKey = "frontend/app/app.js";
// Account for every independently lazy workflow scope while preserving the
// ability to load only the scope required by the active tab or command.
const authenticatedWorkspaceRootSources = [
  "frontend/app/workspaceBootstrap.js",
  "frontend/plans/KeHoachWorkflow.js",
  "frontend/shared/BiddingCalculations.js",
  "frontend/packages/GoiThauWorkflow.js",
  "frontend/packages/BidProcessWorkflow.js",
  "frontend/packages/BidEvaluationWorkflow.js",
  "frontend/shared/FormSubTables.js",
  "frontend/partners/PartnerWorkflows.js"
];
const limits = {
  initialRawBytes: 400 * 1024,
  initialGzipBytes: 110 * 1024,
  authenticatedWorkspaceRawBytes: 780 * 1024,
  authenticatedWorkspaceGzipBytes: 185 * 1024,
  // Secure production chunks include identifier obfuscation. Keep the lazy
  // ceiling explicit; transfer size remains visible in the audit output.
  largestLazyRawBytes: 300 * 1024
};

if (!manifest[entryKey]?.isEntry) throw new Error(`Missing production entry in ${manifestPath}`);
function manifestKeyForSource(source) {
  if (manifest[source]) return source;
  const expectedName = path.basename(source, path.extname(source));
  return Object.entries(manifest).find(([, item]) => item.name === expectedName)?.[0] || null;
}
const authenticatedWorkspaceRoots = authenticatedWorkspaceRootSources.map((source) => {
  const key = manifestKeyForSource(source);
  if (!key) throw new Error(`Missing authenticated workspace chunk in ${manifestPath}: ${source}`);
  return key;
});
for (const source of authenticatedWorkspaceRootSources.filter((item) => item !== "frontend/shared/BiddingCalculations.js")) {
  const key = manifestKeyForSource(source);
  if (!manifest[key]?.isDynamicEntry) {
    throw new Error(`Workflow scope must remain a dynamic entry: ${source}`);
  }
}

function staticGraph(start) {
  const visited = new Set();
  const pending = [start];
  while (pending.length) {
    const key = pending.pop();
    if (!key || visited.has(key)) continue;
    const item = manifest[key];
    if (!item) throw new Error(`Manifest references missing chunk: ${key}`);
    visited.add(key);
    pending.push(...(item.imports || []));
  }
  return visited;
}

function chunkSize(key) {
  const file = path.join(root, "dist", manifest[key].file);
  const content = fs.readFileSync(file);
  return { raw: content.length, gzip: gzipSync(content, { level: 9 }).length };
}

const initialKeys = staticGraph(entryKey);
const initial = [...initialKeys].reduce((total, key) => {
  const size = chunkSize(key);
  total.raw += size.raw;
  total.gzip += size.gzip;
  return total;
}, { raw: 0, gzip: 0 });
const authenticatedWorkspaceKeys = new Set();
for (const rootKey of authenticatedWorkspaceRoots) {
  staticGraph(rootKey).forEach((key) => authenticatedWorkspaceKeys.add(key));
}
const authenticatedWorkspace = [...authenticatedWorkspaceKeys].reduce((total, key) => {
  const size = chunkSize(key);
  total.raw += size.raw;
  total.gzip += size.gzip;
  return total;
}, { raw: 0, gzip: 0 });
const dynamicEntries = Object.entries(manifest).filter(([, item]) => item.isDynamicEntry);
const largestLazy = dynamicEntries
  .map(([key]) => ({ key, ...chunkSize(key) }))
  .sort((left, right) => right.raw - left.raw)[0];

const requiredLazyEntries = [
  "frontend/admin/AdminUserController.js",
  "frontend/documents/ExcelIntegration.js",
  "frontend/documents/WordIntegration.js"
];
for (const key of requiredLazyEntries) {
  if (!manifest[key]?.isDynamicEntry || initialKeys.has(key)) {
    throw new Error(`${key} must remain outside the initial JavaScript graph`);
  }
}

const failures = [];
if (initial.raw > limits.initialRawBytes) failures.push(`initial raw ${initial.raw} > ${limits.initialRawBytes}`);
if (initial.gzip > limits.initialGzipBytes) failures.push(`initial gzip ${initial.gzip} > ${limits.initialGzipBytes}`);
if (authenticatedWorkspace.raw > limits.authenticatedWorkspaceRawBytes) {
  failures.push(`workflow-ready authenticated workspace raw ${authenticatedWorkspace.raw} > ${limits.authenticatedWorkspaceRawBytes}`);
}
if (authenticatedWorkspace.gzip > limits.authenticatedWorkspaceGzipBytes) {
  failures.push(`workflow-ready authenticated workspace gzip ${authenticatedWorkspace.gzip} > ${limits.authenticatedWorkspaceGzipBytes}`);
}
if (largestLazy?.raw > limits.largestLazyRawBytes) {
  failures.push(`largest lazy chunk ${largestLazy.key} ${largestLazy.raw} > ${limits.largestLazyRawBytes}`);
}

console.log(
  `Bundle budget: initial ${(initial.raw / 1024).toFixed(1)} KiB raw / `
  + `${(initial.gzip / 1024).toFixed(1)} KiB gzip across ${initialKeys.size} chunks; `
  + `workflow-ready authenticated workspace ${(authenticatedWorkspace.raw / 1024).toFixed(1)} KiB raw / `
  + `${(authenticatedWorkspace.gzip / 1024).toFixed(1)} KiB gzip across ${authenticatedWorkspaceKeys.size} chunks; `
  + `largest lazy ${largestLazy ? `${largestLazy.key} ${(largestLazy.raw / 1024).toFixed(1)} KiB` : "none"}.`
);
if (failures.length) throw new Error(`Bundle budget exceeded: ${failures.join("; ")}`);
