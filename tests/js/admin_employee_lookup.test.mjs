import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("manager employee form invites by email and never looks accounts up (ADR 0093)", () => {
  const controller = fs.readFileSync("frontend/admin/AdminUserController.js", "utf8");
  const membershipCommand = fs.readFileSync(
    "frontend/admin/OrganizationMembershipCommand.js",
    "utf8",
  );
  const app = fs.readFileSync("backend/app.py", "utf8");

  assert.match(controller, /apiFetch\("\/api\/organizations\/invitations",\s*\{\s*method: "POST"/u);
  assert.doesNotMatch(controller, /lookupCandidate|prefetchCandidate|membership-candidate/u);
  assert.doesNotMatch(membershipCommand, /membership-candidate|lookupCandidate/u);
  assert.doesNotMatch(app, /membership-candidate|lookup_membership_candidate_api/u);
  assert.match(app, /organization_invitation_routes\(Route\)/u);
});
