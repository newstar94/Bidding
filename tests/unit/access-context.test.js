import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAccessContext,
  organizationDisplayName,
  selectActiveOrganization
} from "../../frontend/auth/accessContext.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

const payload = {
  platform_role: "user",
  active_org_id: "org-a",
  organizations: [
    { id: "org-a", name: "Công ty A, Miền Nam", role: "manager", status: "active" },
    { id: "org-b", name: "B", role: "employee", status: "active" }
  ]
};

test("active workspace is persisted by organization id", () => {
  const storage = memoryStorage();
  const { selected } = selectActiveOrganization(payload, storage);
  assert.equal(selected.id, "org-a");
  assert.equal(storage.getItem("bf_active_org"), "org-a");
});

test("switching organizations recomputes membership capabilities", () => {
  const storage = memoryStorage({ bf_active_org: "org-b" });
  const user = {};
  applyAccessContext(user, { ...payload, active_org_id: "org-b" }, storage);
  assert.equal(user.membershipRole, "employee");
  assert.deepEqual(user.dbRoles, ["employee"]);
  assert.equal(user.dbRoles.includes("manager"), false);
});

test("platform administrator remains platform-scoped", () => {
  const storage = memoryStorage();
  const user = {};
  applyAccessContext(user, { ...payload, platform_role: "super_admin" }, storage);
  assert.equal(user.dbRole, "super_admin");
  assert.equal(user.dbRoles.includes("super_admin"), true);
});

test("organization names with commas remain one ID-backed DTO", () => {
  const user = {};
  applyAccessContext(user, payload, memoryStorage());

  assert.equal(user.organizations.length, 2);
  assert.equal(user.organizations[0].id, "org-a");
  assert.equal(user.organizations[0].name, "Công ty A, Miền Nam");
  assert.equal(organizationDisplayName(user), "Công ty A, Miền Nam, B");
  assert.equal(Object.hasOwn(user, "organization_name"), false);
});

test("a user without an organization remains employee-only", () => {
  const storage = memoryStorage({ bf_active_org: "stale-org" });
  const user = {};
  const selected = applyAccessContext(user, {
    platform_role: "user",
    membership_role: null,
    effective_roles: ["employee"],
    organizations: []
  }, storage);

  assert.equal(selected, null);
  assert.equal(user.membershipRole, null);
  assert.equal(user.dbRole, "employee");
  assert.deepEqual(user.dbRoles, ["employee"]);
  assert.equal(storage.getItem("bf_active_org"), null);
});
