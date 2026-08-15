import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("manager employee form uses the exact membership candidate endpoint", () => {
  const controller = fs.readFileSync("frontend/admin/AdminUserController.js", "utf8");
  const app = fs.readFileSync("backend/app.py", "utf8");

  assert.match(
    controller,
    /api\/organizations\/membership-candidate\?email=\$\{encodeURIComponent\(emailInput\)\}/u,
  );
  assert.match(controller, /foundUser\s*=\s*lookupResult\.candidate/u);
  assert.match(
    app,
    /Route\("\/api\/organizations\/membership-candidate",\s*lookup_membership_candidate_api,\s*methods=\["GET"\]\)/su,
  );
});
