import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("legacy renewal UI delegates term length to the backend compatibility seam", async () => {
  const source = await readFile(joinPath("frontend/admin/AdminUserController.js"), "utf8");

  assert.doesNotMatch(source, /duration_days:\s*365/u);
  assert.doesNotMatch(source, /thêm 365 ngày/u);
  assert.match(source, /theo chính sách tương thích hiện hành/u);
});

function joinPath(relativePath) {
  return fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
}
