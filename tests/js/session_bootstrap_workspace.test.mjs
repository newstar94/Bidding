import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { embeddedSessionNeedsWorkspaceRefresh } from "../../frontend/auth/sessionBootstrapPolicy.js";

test("session hydration restores the authoritative user ID before access context", () => {
  const source = readFileSync(new URL("../../frontend/auth/AuthFlowController.js", import.meta.url), "utf8");
  assert.match(source, /this\.model\.state\.activeuser\.id = user\.id \|\| "";\s+applyAccessContext\(this\.model\.state\.activeuser, user\)/);
});

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
