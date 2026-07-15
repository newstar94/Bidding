import assert from "node:assert/strict";
import test from "node:test";

import { sessionHasActiveWorkspace } from "../../frontend/app/workspaceBootstrap.js";

test("new account without an organization does not bootstrap workspace state", () => {
  assert.equal(sessionHasActiveWorkspace({
    valid: true,
    user: { active_org_id: null, organizations: [], effective_roles: ["employee"] }
  }), false);
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
