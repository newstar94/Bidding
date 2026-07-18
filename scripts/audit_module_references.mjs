import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["frontend", "views"];
const ignoredSegments = new Set(["vendor"]);
const entries = [
  path.join(root, "frontend", "app", "app.js"),
  // Registered by URL at runtime, so it is an independent browser entry.
  path.join(root, "views", "service-worker.js")
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entryInfo) => {
    const fullPath = path.join(directory, entryInfo.name);
    if (entryInfo.isDirectory()) {
      if (ignoredSegments.has(entryInfo.name)) return [];
      return walk(fullPath);
    }
    return entryInfo.isFile() && entryInfo.name.endsWith(".js") ? [fullPath] : [];
  });
}

function resolveSpecifier(importer, specifier) {
  let candidate;
  if (specifier.startsWith("/")) candidate = path.join(root, specifier.slice(1));
  else if (specifier.startsWith(".")) candidate = path.resolve(path.dirname(importer), specifier);
  else return null;
  if (!path.extname(candidate)) candidate += ".js";
  return fs.existsSync(candidate) ? candidate : null;
}

function collectImports(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const imports = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const resolved = resolveSpecifier(filePath, match[1]);
      if (resolved) imports.push(resolved);
    }
  }
  return imports;
}

const allModules = sourceRoots
  .map((directory) => path.join(root, directory))
  .filter((directory) => fs.existsSync(directory))
  .flatMap((directory) => walk(directory));
const reachable = new Set();
const queue = [...entries];
while (queue.length) {
  const current = queue.pop();
  if (!current || reachable.has(current)) continue;
  reachable.add(current);
  for (const dependency of collectImports(current)) queue.push(dependency);
}

const unreachable = allModules
  .filter((filePath) => !reachable.has(filePath))
  .map((filePath) => path.relative(root, filePath).replaceAll("\\", "/"))
  .sort();

if (unreachable.length) {
  console.log("Modules not reachable from a production entry:");
  unreachable.forEach((filePath) => console.log(`- ${filePath}`));
  process.exitCode = 1;
} else {
  console.log(`Module reference audit passed (${reachable.size} reachable application modules).`);
}
