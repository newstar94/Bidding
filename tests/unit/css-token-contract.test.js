import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("avatar gradients have a declared accent token and resilient fallbacks", async () => {
  const [variables, components, views] = await Promise.all([
    readFile(new URL("../../views/css/variables.css", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/components.css", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/views.css", import.meta.url), "utf8")
  ]);

  assert.match(variables, /--accent:\s*#[0-9a-f]{6}/i);
  assert.match(components, /var\(--accent,\s*#[0-9a-f]{6}\)/i);
  assert.match(views, /var\(--accent,\s*#[0-9a-f]{6}\)/i);
});
