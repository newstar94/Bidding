import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "dist", "node_modules", "vendor", "__pycache__"]);

function walk(directory, predicate) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excludedDirectories.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath, predicate);
    return entry.isFile() && predicate(fullPath) ? [fullPath] : [];
  });
}

const searchableFiles = walk(root, (filePath) => /\.(?:js|html|py)$/.test(filePath));
const searchableText = searchableFiles.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
const appJsFiles = searchableFiles.filter((filePath) => filePath.endsWith(".js"));

const unusedExports = [];
for (const filePath of appJsFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  const exportPattern = /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(exportPattern)) {
    const identifier = match[1];
    const references = searchableText.match(new RegExp(`\\b${identifier.replaceAll("$", "\\$")}\\b`, "g"))?.length || 0;
    if (references === 1) {
      unusedExports.push(`${path.relative(root, filePath).replaceAll("\\", "/")}: ${identifier}`);
    }
  }
}

const cssFiles = walk(path.join(root, "views", "css"), (filePath) => filePath.endsWith(".css"));
const deadIdSelectors = new Set();
for (const filePath of cssFiles) {
  const css = fs.readFileSync(filePath, "utf8");
  for (const selectorBlock of css.matchAll(/([^{}]+)\{/g)) {
    for (const match of selectorBlock[1].matchAll(/#([A-Za-z_][\w-]*)/g)) {
      const id = match[1];
      if (!searchableText.includes(id)) deadIdSelectors.add(id);
    }
  }
}

if (unusedExports.length || deadIdSelectors.size) {
  if (unusedExports.length) {
    console.log("Exported identifiers with no application reference:");
    unusedExports.sort().forEach((item) => console.log(`- ${item}`));
  }
  if (deadIdSelectors.size) {
    console.log("CSS ID selectors with no application reference:");
    [...deadIdSelectors].sort().forEach((item) => console.log(`- #${item}`));
  }
  process.exitCode = 1;
} else {
  console.log("Conservative dead-code audit passed (exports and CSS ID selectors). ");
}
