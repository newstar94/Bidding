import assert from "node:assert/strict";
import test from "node:test";

import { sessionHasActiveWorkspace } from "../../frontend/app/workspaceBootstrap.js";

test("a malformed session without a server-owned data scope does not bootstrap", () => {
  assert.equal(sessionHasActiveWorkspace({
    valid: true,
    user: { active_org_id: null, organizations: [], effective_roles: ["employee"] }
  }), false);
});

test("personal data scope works without a business organization or package", () => {
  assert.equal(sessionHasActiveWorkspace({
    valid: true,
    user: {
      active_org_id: "personal-user-1",
      organizations: [{
        id: "personal-user-1",
        scope_type: "personal",
        status: "active"
      }]
    }
  }), true);
});

test("workspace bootstrap requires the active organization to be accessible", () => {
  assert.equal(sessionHasActiveWorkspace({
    valid: true,
    user: {
      active_org_id: "org-a",
      organizations: [{ id: "org-a", status: "active" }]
    }
  }), true);
  assert.equal(sessionHasActiveWorkspace({
    valid: true,
    user: {
      active_org_id: "org-missing",
      organizations: [{ id: "org-a", status: "active" }]
    }
  }), false);
});
