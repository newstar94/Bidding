import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { adminNavigationMarkup } from "../../frontend/admin-platform/AdminNavigation.js";

test("admin sidebar renders grouped IA with every destination once", () => {
  const markup = adminNavigationMarkup();
  for (const label of [
    "Điều hành", "Tổng quan", "Phân tích", "Khách hàng", "Thương mại",
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

test("admin shell manages BiddingFlow only", () => {
  const source = fs.readFileSync(new URL("../../frontend/admin-platform/AdminApp.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /data-admin-application-filter|Chuẩn Hóa|AdminChuanHoa/u);
  assert.match(source, /BiddingFlow/u);
});
