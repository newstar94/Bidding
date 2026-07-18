import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProfileUpdatePayload,
  deriveEmailChangeUiState,
  emailChangeErrorMessage,
  isValidEmailChangeOtp
} from "../../frontend/admin/profileEmailChange.js";

test("profile update requests a password only when the normalized email changes", () => {
  const unchanged = buildProfileUpdatePayload({
    name: " Nguyễn Văn A ",
    email: " USER@example.com ",
    avatar: "avatar",
    currentEmail: "user@example.com",
    password: "must-not-be-sent"
  });
  assert.deepEqual(unchanged, {
    emailChanged: false,
    payload: { name: "Nguyễn Văn A", email: "USER@example.com", avatar: "avatar" }
  });

  const changed = buildProfileUpdatePayload({
    name: "Nguyễn Văn A",
    email: "new@example.com",
    avatar: "",
    currentEmail: "old@example.com",
    password: "current-secret"
  });
  assert.equal(changed.emailChanged, true);
  assert.equal(changed.payload.password, "current-secret");
});

test("pending verification replaces the password prompt with the OTP step", () => {
  assert.deepEqual(deriveEmailChangeUiState({
    currentEmail: "old@example.com",
    desiredEmail: "new@example.com",
    pendingEmail: ""
  }), {
    emailChanged: true,
    verificationPending: false,
    passwordRequired: true
  });
  assert.deepEqual(deriveEmailChangeUiState({
    currentEmail: "old@example.com",
    desiredEmail: "new@example.com",
    pendingEmail: "NEW@example.com"
  }), {
    emailChanged: true,
    verificationPending: true,
    passwordRequired: false
  });
});

test("email verification accepts exactly six ASCII digits", () => {
  assert.equal(isValidEmailChangeOtp(" 123456 "), true);
  assert.equal(isValidEmailChangeOtp("12345"), false);
  assert.equal(isValidEmailChangeOtp("12345a"), false);
});

test("stable email-change codes have friendly messages and retain server fallback", () => {
  assert.match(emailChangeErrorMessage("EMAIL_CHANGE_REAUTH_FAILED"), /Mật khẩu hiện tại/);
  assert.match(emailChangeErrorMessage("EMAIL_CHANGE_OTP_EXPIRED"), /hết hạn/);
  assert.equal(emailChangeErrorMessage("UNKNOWN", "Thông báo từ máy chủ"), "Thông báo từ máy chủ");
});
