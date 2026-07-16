import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleIdentityOptions,
  resetSetUsernameButton
} from "../../frontend/auth/GoogleAuthController.js";

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

test("Google username modal resets a stale submit button before reuse", () => {
  const label = { textContent: "Đang khởi tạo thiết lập..." };
  const button = {
    disabled: true,
    querySelector(selector) {
      return selector === "span" ? label : null;
    }
  };

  const returnedLabel = resetSetUsernameButton(button);

  assert.equal(button.disabled, false);
  assert.equal(label.textContent, "Xác nhận tên đăng nhập");
  assert.equal(returnedLabel, label);
});
