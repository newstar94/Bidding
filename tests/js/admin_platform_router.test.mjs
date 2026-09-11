import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_NAV_GROUPS,
  ADMIN_ROUTES,
  getAdminRoute,
  normalizeAdminPath,
} from "../../frontend/admin-platform/AdminRouter.js";

test("admin router recognizes every required deep link", () => {
  const required = [
    "/admin", "/admin/analytics", "/admin/organizations", "/admin/users",
    "/admin/plans", "/admin/subscriptions", "/admin/invoices", "/admin/payments",
    "/admin/settings", "/admin/environment", "/admin/legal", "/admin/audit", "/admin/health",
    "/admin/security", "/admin/system/jobs", "/admin/system/sync", "/admin/system/version",
  ];
  assert.deepEqual(ADMIN_ROUTES.map(([path]) => path), required);
  for (const path of required) assert.equal(getAdminRoute(path)?.path, path);
});

test("admin router normalizes trailing slash and rejects unknown routes", () => {
  assert.equal(normalizeAdminPath("/admin/users/"), "/admin/users");
  assert.equal(normalizeAdminPath("/admin/invoices/invoice-request-1/"), "/admin/invoices/invoice-request-1");
  assert.deepEqual(getAdminRoute("/admin/invoices/invoice-request-1"), {
    path: "/admin/invoices",
    href: "/admin/invoices/invoice-request-1",
    title: "Hóa đơn",
    detailId: "invoice-request-1",
  });
  assert.equal(getAdminRoute("/admin/invoices/a%2Fb"), null);
  assert.equal(normalizeAdminPath("/admin/not-real"), null);
  assert.equal(normalizeAdminPath("/tong-quan-admin"), null);
});

test("admin information architecture groups every route exactly once", () => {
  assert.deepEqual(ADMIN_NAV_GROUPS.map((group) => group.label), [
    "Tổng quan", "Phân tích", "Khách hàng", "Thương mại",
    "Hệ thống", "Bảo mật", "DevOps",
  ]);
  const groupedPaths = ADMIN_NAV_GROUPS.flatMap((group) => group.paths);
  assert.deepEqual(groupedPaths, [
    "/admin",
    "/admin/analytics",
    "/admin/organizations", "/admin/users",
    "/admin/plans", "/admin/subscriptions", "/admin/invoices", "/admin/payments",
    "/admin/settings", "/admin/legal", "/admin/system/jobs", "/admin/system/sync",
    "/admin/audit", "/admin/security",
    "/admin/environment", "/admin/health", "/admin/system/version",
  ]);
  assert.equal(new Set(groupedPaths).size, ADMIN_ROUTES.length);
  assert.deepEqual(new Set(groupedPaths), new Set(ADMIN_ROUTES.map(([path]) => path)));
});
