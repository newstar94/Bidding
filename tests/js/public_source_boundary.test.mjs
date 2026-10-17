import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("browser-owned code and templates contain no upstream provider identifiers", () => {
  const leaks = [];
  for (const root of ["frontend", "views"]) {
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:js|html)$/.test(entry.name)) continue;
      const file = path.join(entry.parentPath, entry.name);
      if (/[/\\]vendor[/\\]/.test(file)) continue;
      if (/muasamcong|vneps|mua\s*sắm\s*công|\bMSC\b|MSC_/i.test(fs.readFileSync(file, "utf8"))) leaks.push(file);
    }
  }
  assert.deepEqual(leaks, []);
});
