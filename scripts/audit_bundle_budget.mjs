import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "dist", ".vite", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entryKey = "frontend/app/app.js";
const limits = {
  initialRawBytes: 400 * 1024,
  initialGzipBytes: 110 * 1024,
  // Secure production chunks include identifier obfuscation. Keep the lazy
  // ceiling explicit; transfer size remains visible in the audit output.
  largestLazyRawBytes: 320 * 1024
};

if (!manifest[entryKey]?.isEntry) throw new Error(`Missing production entry in ${manifestPath}`);

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
if (largestLazy?.raw > limits.largestLazyRawBytes) {
  failures.push(`largest lazy chunk ${largestLazy.key} ${largestLazy.raw} > ${limits.largestLazyRawBytes}`);
}

console.log(
  `Bundle budget: initial ${(initial.raw / 1024).toFixed(1)} KiB raw / `
  + `${(initial.gzip / 1024).toFixed(1)} KiB gzip across ${initialKeys.size} chunks; `
  + `largest lazy ${largestLazy ? `${largestLazy.key} ${(largestLazy.raw / 1024).toFixed(1)} KiB` : "none"}.`
);
if (failures.length) throw new Error(`Bundle budget exceeded: ${failures.join("; ")}`);
