import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["frontend", "views"];
const ALLOWED_GLOBAL_ASSIGNMENTS = new Set(["lucide", "fetch"]);
const errors = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["vendor", "dist", "node_modules"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (/\.(js|html)$/.test(entry.name)) inspect(fullPath);
  }
}

function inspect(filePath) {
  const relative = path.relative(ROOT, filePath).replaceAll("\\", "/");
  const source = fs.readFileSync(filePath, "utf8");
  source.split(/\r?\n/).forEach((line, index) => {
    if (/Object\.assign\([^\n]*(?:\.prototype|prototype\s*,)/.test(line)) {
      errors.push(`${relative}:${index + 1}: không dùng Object.assign lên prototype`);
    }
    if (/\son(?:click|change|input|submit)\s*=/.test(line)) {
      errors.push(`${relative}:${index + 1}: dùng data-bf-action thay inline event handler`);
    }
    for (const match of line.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) {
      if (!ALLOWED_GLOBAL_ASSIGNMENTS.has(match[1])) {
        errors.push(`${relative}:${index + 1}: global window.${match[1]} chưa được phê duyệt`);
      }
    }
  });
}

SCAN_DIRS
  .map((directory) => path.join(ROOT, directory))
  .filter((directory) => fs.existsSync(directory))
  .forEach(walk);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("JavaScript static checks passed.");
