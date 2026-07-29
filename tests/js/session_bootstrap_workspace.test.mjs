import assert from "node:assert/strict";
import test from "node:test";

import { embeddedSessionNeedsWorkspaceRefresh } from "../../frontend/auth/sessionBootstrapPolicy.js";

test("refreshes a valid embedded session when it disagrees with the saved workspace", () => {
  assert.equal(embeddedSessionNeedsWorkspaceRefresh({
    valid: true,
    user: { active_org_id: "org-default" },
  }, "org-selected"), true);
});

test("reuses embedded session when no saved preference exists or it already matches", () => {
  const embedded = { valid: true, user: { active_org_id: "org-selected" } };
  assert.equal(embeddedSessionNeedsWorkspaceRefresh(embedded, "org-selected"), false);
  assert.equal(embeddedSessionNeedsWorkspaceRefresh(embedded, ""), false);
});
