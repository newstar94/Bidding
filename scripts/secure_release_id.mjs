import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_RELEASE_INPUTS = Object.freeze([
  "frontend",
  "views",
  "shared",
  "public",
  "package-lock.json",
  "scripts/secure_release_id.mjs",
  "vite.config.js",
]);

function collectReleaseInputFiles(projectRoot, relativePath, collected = []) {
  const absolutePath = path.resolve(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return collected;
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    collected.push(relativePath.replaceAll("\\", "/"));
    return collected;
  }
  if (!stat.isDirectory()) return collected;
  for (const entry of fs.readdirSync(absolutePath).sort()) {
    collectReleaseInputFiles(projectRoot, path.join(relativePath, entry), collected);
  }
  return collected;
}

export function localSecureReleaseId(projectRoot = PROJECT_ROOT) {
  const hash = createHash("sha256");
  const files = LOCAL_RELEASE_INPUTS
    .flatMap((entry) => collectReleaseInputFiles(projectRoot, entry))
    .sort();
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.resolve(projectRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
