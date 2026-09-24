import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("discovery explicitly overrides file-producing reporters", async () => {
  const source = await readFile(new URL("../../scripts/check_playwright_discovery.mjs", import.meta.url), "utf8");
  assert.match(source, /["']--reporter=list["']/u);
});
