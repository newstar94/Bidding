import assert from "node:assert/strict";
import test from "node:test";

import { adminNavigationMarkup } from "../../frontend/admin-platform/AdminNavigation.js";

test("admin sidebar renders grouped IA with every destination once", () => {
  const markup = adminNavigationMarkup();
  for (const label of [
    "Tổng quan", "Phân tích", "Khách hàng", "Thương mại",
    "Hệ thống", "Bảo mật", "DevOps",
  ]) assert.match(markup, new RegExp(`>${label}<`, "u"));

  const destinations = [...markup.matchAll(/data-admin-link="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(destinations.length, 17);
  assert.equal(new Set(destinations).size, destinations.length);
  assert.doesNotMatch(markup, /role="presentation"/u);
  assert.ok(markup.indexOf("Khách hàng") < markup.indexOf('data-admin-link="/admin/organizations"'));
  assert.ok(markup.indexOf("DevOps") < markup.indexOf('data-admin-link="/admin/health"'));
});

test("admin sidebar group labels and routes are escaped at the markup seam", () => {
  const markup = adminNavigationMarkup({
    groups: [{ label: '<img src=x onerror="boom">', paths: ["/admin/users"] }],
    routes: [["/admin/users", '<script>alert("x")</script>']],
  });
  assert.doesNotMatch(markup, /<img|<script/u);
  assert.match(markup, /&lt;img/u);
  assert.match(markup, /&lt;script/u);
});
