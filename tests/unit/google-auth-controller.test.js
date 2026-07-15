import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleIdentityOptions } from "../../frontend/auth/GoogleAuthController.js";

test("Google Identity uses the popup flow when FedCM policy is unavailable", () => {
  const callback = () => {};
  const options = createGoogleIdentityOptions("google-client-id", callback);

  assert.deepEqual(options, {
    client_id: "google-client-id",
    callback,
    ux_mode: "popup",
    context: "signin",
    use_fedcm_for_button: false
  });
});
