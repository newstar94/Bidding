import assert from "node:assert/strict";
import test from "node:test";
import { updateActiveUserProfileDisplay } from "../../frontend/admin/SystemUserView.js";

function menuItem({ word = false } = {}) {
  return { hidden: true, inert: false, hasAttribute: (name) => word && name === "data-word-navigation" };
}

function installDocument(groups) {
  const previous = {
    document: globalThis.document,
    Element: globalThis.Element,
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
  };
  const storage = { getItem: () => "org-1", setItem() {}, removeItem() {} };
  globalThis.Element = class {};
  globalThis.sessionStorage = storage;
  globalThis.localStorage = storage;
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (selector) => groups[selector] || [],
  };
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
}

function switchTo(role, groups, subscription = { package_id: "gold" }) {
  const restore = installDocument(groups);
  try {
    updateActiveUserProfileDisplay.call({
      model: {
        state: {
          activerole: role,
          employees: [],
          activeuser: {
            activeOrganizationId: "org-1",
            organizations: [{ id: "org-1", name: "HCP", scope_type: "organization", role: "manager", subscription }],
          },
        },
      },
      applySecurityLockOverlay() {},
      populateNhanVienPhuTrachDropdowns() {},
    });
  } finally {
    restore();
  }
}

test("switching from super admin to manager without reload restores the workspace menu", () => {
  // initial-route.js hid every client and manager item because the page
  // loaded in super_admin mode.
  const client = [menuItem(), menuItem()];
  const word = menuItem({ word: true });
  const manager = [menuItem()];
  const superAdmin = [{ ...menuItem(), hidden: false }];
  const groups = {
    ".role-menu-superadmin": superAdmin,
    ".role-menu-manager": manager,
    ".role-menu-client": [...client, word],
    "[data-word-navigation]": [word],
  };

  switchTo("manager", groups);
  assert.ok(client.every((item) => item.hidden === false));
  assert.equal(word.hidden, false);
  assert.ok(manager.every((item) => item.hidden === false));
  assert.ok(superAdmin.every((item) => item.hidden === true));

  switchTo("super_admin", groups);
  assert.ok([...client, word, ...manager].every((item) => item.hidden === true));
  assert.ok(superAdmin.every((item) => item.hidden === false));
});

test("free workspaces keep the Word menu hidden after a role switch", () => {
  const client = [menuItem()];
  const word = menuItem({ word: true });
  switchTo("employee", {
    ".role-menu-client": [...client, word],
    "[data-word-navigation]": [word],
  }, { package_id: "free" });
  assert.equal(client[0].hidden, false);
  assert.equal(word.hidden, true);
});
