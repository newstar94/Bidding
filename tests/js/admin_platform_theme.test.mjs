import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function cssVariable(source, name) {
  return source.match(new RegExp(`${name}:\\s*([^;]+);`, "u"))?.[1].trim();
}

test("admin console mirrors the BiddingFlow product palette", async () => {
  const [product, admin] = await Promise.all([
    readFile(new URL("../../views/css/variables.css", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/admin-platform/admin.css", import.meta.url), "utf8"),
  ]);

  const sharedColors = [
    ["--brand", "--bf-admin-brand"],
    ["--brand-strong", "--bf-admin-brand-strong"],
    ["--brand-soft", "--bf-admin-brand-soft"],
    ["--canvas", "--bf-admin-canvas"],
    ["--surface", "--bf-admin-surface"],
    ["--surface-subtle", "--bf-admin-surface-subtle"],
    ["--ink", "--bf-admin-ink"],
    ["--ink-muted", "--bf-admin-muted"],
    ["--line", "--bf-admin-line"],
    ["--line-strong", "--bf-admin-line-strong"],
    ["--success", "--bf-admin-success"],
    ["--warning", "--bf-admin-warning"],
    ["--danger", "--bf-admin-danger"],
  ];

  for (const [productToken, adminToken] of sharedColors) {
    assert.equal(cssVariable(admin, adminToken), cssVariable(product, productToken), `${adminToken} must match ${productToken}`);
  }
});

test("admin console uses one primary accent and semantic status colors", async () => {
  const admin = await readFile(new URL("../../frontend/admin-platform/admin.css", import.meta.url), "utf8");

  assert.match(admin, /--tblr-primary:\s*var\(--bf-admin-brand\);/u);
  assert.match(admin, /\.navbar-vertical \.nav-link\.active\s*\{[^}]*background:\s*var\(--bf-admin-brand\)/su);
  assert.match(admin, /--tblr-success:\s*var\(--bf-admin-success\);/u);
  assert.match(admin, /--tblr-warning:\s*var\(--bf-admin-warning\);/u);
  assert.match(admin, /--tblr-danger:\s*var\(--bf-admin-danger\);/u);
  assert.doesNotMatch(admin, /gradient\s*\(/iu);
  assert.doesNotMatch(admin, /#(?:6d28d9|5b21b6|ae3ec9)\b/iu);
});
