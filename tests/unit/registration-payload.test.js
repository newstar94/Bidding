import assert from "node:assert/strict";
import test from "node:test";

import { createRegistrationPayload } from "../../frontend/auth/AuthFlowController.js";

test("self-registration never sends a client-controlled role", () => {
  const payload = createRegistrationPayload({
    username: "new_user",
    password: "valid-password-2026",
    name: "New User",
    email: "new-user@example.com",
    role: "manager"
  });

  assert.deepEqual(payload, {
    username: "new_user",
    password: "valid-password-2026",
    name: "New User",
    email: "new-user@example.com"
  });
  assert.equal(Object.hasOwn(payload, "role"), false);
});
