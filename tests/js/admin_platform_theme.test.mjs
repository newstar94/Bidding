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
  assert.match(admin, /\.form-check-input:checked\s*\{[^}]*var\(--bf-admin-brand\)/su);
  assert.match(admin, /\.table\s*\{[^}]*--tblr-table-hover-bg:\s*var\(--bf-admin-brand-soft\)/su);
  assert.doesNotMatch(admin, /gradient\s*\(/iu);
  assert.doesNotMatch(admin, /#(?:6d28d9|5b21b6|ae3ec9)\b/iu);
});

test("admin action buttons keep status colors reserved for status feedback", async () => {
  const plans = await readFile(
    new URL("../../frontend/admin-platform/AdminPlans.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(plans, /data-admin-plan-action="publish"[^>]*btn-success/u);
  assert.match(plans, /class="btn btn-primary"[^>]*data-admin-plan-action="publish"/u);
});

test("admin entry ships Tabler styles without the unused demo JavaScript bundle", async () => {
  const entry = await readFile(
    new URL("../../frontend/admin-platform/AdminEntry.js", import.meta.url),
    "utf8",
  );
  const app = await readFile(
    new URL("../../frontend/admin-platform/AdminApp.js", import.meta.url),
    "utf8",
  );

  assert.match(entry, /@tabler\/core\/dist\/css\/tabler\.min\.css/u);
  assert.doesNotMatch(entry, /@tabler\/core\/dist\/js/u);
  assert.match(app, /data-admin-nav-toggle/u);
  assert.match(app, /navigation\.classList\.toggle\("show", !expanded\)/u);
});
