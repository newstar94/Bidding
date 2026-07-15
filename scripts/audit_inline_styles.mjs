import fs from "node:fs";
import path from "node:path";

const limits = { attributes: 43, propertyWrites: 0, cssTextWrites: 0 };
const counts = { attributes: 0, propertyWrites: 0, cssTextWrites: 0 };

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["vendor", "dist"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (/\.(?:js|html)$/.test(entry.name)) {
      const source = fs.readFileSync(fullPath, "utf8");
      counts.attributes += source.match(/\sstyle\s*=/g)?.length || 0;
      counts.propertyWrites += source.match(/\.style\.[A-Za-z_$][\w$]*\s*=/g)?.length || 0;
      counts.cssTextWrites += source.match(/(?:\.style\.cssText|setAttribute\(["']style["'])/g)?.length || 0;
    }
  }
}

walk("frontend");
walk("views");
const violations = Object.keys(limits).filter(key => counts[key] > limits[key]);
if (violations.length) throw new Error(`Inline-style budget exceeded: ${violations.map(key => `${key}=${counts[key]}/${limits[key]}`).join(", ")}`);
console.log(`Inline-style migration budget passed (${counts.attributes} attrs, ${counts.propertyWrites} property writes, ${counts.cssTextWrites} cssText/setAttribute writes).`);
