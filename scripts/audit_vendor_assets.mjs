import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_ROOT = path.join(ROOT, "views", "vendor");
const MANIFEST_PATH = path.join(VENDOR_ROOT, "vendor-manifest.json");
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const failures = [];
const tracked = new Set();

for (const asset of manifest.assets || []) {
  if (!asset.name || !asset.version || !asset.license || !asset.source) {
    failures.push("Every vendored asset needs name, version, license and source.");
  }
  for (const [relativePath, expectedHash] of Object.entries(asset.files || {})) {
    const normalized = relativePath.replaceAll("\\", "/");
    if (normalized.startsWith("../") || path.isAbsolute(normalized)) {
      failures.push(`Unsafe vendor manifest path: ${relativePath}`);
      continue;
    }
    const absolutePath = path.resolve(VENDOR_ROOT, normalized);
    if (!absolutePath.startsWith(`${VENDOR_ROOT}${path.sep}`)) {
      failures.push(`Vendor path escapes its root: ${relativePath}`);
      continue;
    }
    tracked.add(normalized);
    if (!fs.existsSync(absolutePath)) {
      failures.push(`Missing vendored asset: ${normalized}`);
      continue;
    }
    const actualHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(absolutePath))
      .digest("hex");
    if (actualHash !== String(expectedHash).toLowerCase()) {
      failures.push(`SHA-256 mismatch: ${normalized}`);
    }
  }
}

const ignoredFirstPartyFiles = new Set([
  "initial-route.js",
  "lucide/lucide-shim.js",
  "vendor-manifest.json",
]);
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolutePath = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
});
for (const absolutePath of walk(VENDOR_ROOT)) {
  const relativePath = path.relative(VENDOR_ROOT, absolutePath).replaceAll("\\", "/");
  if (!tracked.has(relativePath) && !ignoredFirstPartyFiles.has(relativePath)) {
    failures.push(`Untracked file under views/vendor: ${relativePath}`);
  }
}

if (failures.length) {
  throw new Error(failures.join("\n"));
}
console.log(`Vendor manifest verified (${tracked.size} files, SHA-256 intact).`);
