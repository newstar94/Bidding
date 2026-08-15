import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isSessionAuthenticationFailure,
} from "../../frontend/auth/AuthSessionController.js";

test("revoked-session AUTH_REQUIRED response is not classified as a permission error", () => {
  assert.equal(isSessionAuthenticationFailure(403, { code: "AUTH_REQUIRED" }), true);
  assert.equal(isSessionAuthenticationFailure(403, { code: "SESSION_REQUIRED" }), true);

  const controller = fs.readFileSync("frontend/app/BiddingController.js", "utf8");
  const sessionBranch = controller.indexOf(
    "isSessionAuthenticationFailure(response.status, data)",
  );
  const genericPermissionBranch = controller.indexOf(
    '} else if (response.status === 403) {',
    sessionBranch,
  );
  assert.notEqual(sessionBranch, -1);
  assert.ok(genericPermissionBranch > sessionBranch);
  assert.match(controller.slice(sessionBranch, genericPermissionBranch), /_checkSessionNow/u);
});

test("a genuine forbidden response remains a permission error", () => {
  assert.equal(
    isSessionAuthenticationFailure(403, {
      code: "DOCUMENT_EXPORT_DENIED",
      error: "Không có quyền xuất tài liệu.",
    }),
    false,
  );
});
