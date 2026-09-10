import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_ROUTES, getAdminRoute, normalizeAdminPath } from "../../frontend/admin-platform/AdminRouter.js";

test("admin router recognizes every required deep link", () => {
  const required = [
    "/admin", "/admin/analytics", "/admin/organizations", "/admin/users",
    "/admin/plans", "/admin/subscriptions", "/admin/invoices", "/admin/payments",
    "/admin/settings", "/admin/environment", "/admin/audit", "/admin/health",
    "/admin/security", "/admin/system/jobs", "/admin/system/sync", "/admin/system/version",
  ];
  assert.deepEqual(ADMIN_ROUTES.map(([path]) => path), required);
  for (const path of required) assert.equal(getAdminRoute(path)?.path, path);
});

test("admin router normalizes trailing slash and rejects unknown routes", () => {
  assert.equal(normalizeAdminPath("/admin/users/"), "/admin/users");
  assert.equal(normalizeAdminPath("/admin/not-real"), null);
  assert.equal(normalizeAdminPath("/tong-quan-admin"), null);
});
