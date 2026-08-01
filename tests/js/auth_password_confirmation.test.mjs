import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { updatePasswordConfirmationState } from "../../frontend/auth/AuthFlowController.js";

function createFixture(password, confirmation) {
  const classes = new Set();
  const attributes = new Map();
  const group = {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  const confirmationInput = {
    value: confirmation,
    validationMessage: "",
    setCustomValidity(message) {
      this.validationMessage = message;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    closest(selector) {
      return selector === ".form-group" ? group : null;
    },
  };
  return {
    passwordInput: { value: password },
    confirmationInput,
    errorElement: { hidden: true, textContent: "" },
    classes,
    attributes,
  };
}

test("password confirmation waits while the user is still typing", () => {
  const fixture = createFixture("12345678", "1234");

  assert.equal(updatePasswordConfirmationState(
    fixture.passwordInput,
    fixture.confirmationInput,
    fixture.errorElement,
  ), true);
  assert.equal(fixture.errorElement.hidden, true);
  assert.equal(fixture.attributes.has("aria-invalid"), false);
});

test("password confirmation reports a mismatch as soon as input is complete", () => {
  const fixture = createFixture("12345678", "123456789");

  assert.equal(updatePasswordConfirmationState(
    fixture.passwordInput,
    fixture.confirmationInput,
    fixture.errorElement,
  ), false);
  assert.equal(fixture.errorElement.hidden, false);
  assert.equal(fixture.errorElement.textContent, "Mật khẩu nhập lại không khớp.");
  assert.equal(fixture.confirmationInput.validationMessage, "Mật khẩu nhập lại không khớp.");
  assert.equal(fixture.attributes.get("aria-invalid"), "true");
  assert.equal(fixture.classes.has("invalid"), true);
});

test("password confirmation clears the error immediately after the values match", () => {
  const fixture = createFixture("12345678", "123456789");
  updatePasswordConfirmationState(
    fixture.passwordInput,
    fixture.confirmationInput,
    fixture.errorElement,
  );
  fixture.confirmationInput.value = "12345678";

  assert.equal(updatePasswordConfirmationState(
    fixture.passwordInput,
    fixture.confirmationInput,
    fixture.errorElement,
  ), true);
  assert.equal(fixture.errorElement.hidden, true);
  assert.equal(fixture.errorElement.textContent, "");
  assert.equal(fixture.confirmationInput.validationMessage, "");
  assert.equal(fixture.attributes.has("aria-invalid"), false);
  assert.equal(fixture.classes.has("invalid"), false);
});

test("password confirmation validates shorter input when the user leaves the field", () => {
  const fixture = createFixture("12345678", "1234");

  assert.equal(updatePasswordConfirmationState(
    fixture.passwordInput,
    fixture.confirmationInput,
    fixture.errorElement,
    { force: true },
  ), false);
  assert.equal(fixture.errorElement.hidden, false);
});

test("registration markup connects the confirmation input to its live error", () => {
  const markup = fs.readFileSync(
    new URL("../../views/components/auth_overlay.html", import.meta.url),
    "utf8",
  );
  const styles = fs.readFileSync(
    new URL("../../views/css/views.css", import.meta.url),
    "utf8",
  );

  assert.match(markup, /id="register-confirm-password"[\s\S]*?aria-describedby="register-confirm-password-error register-error"/u);
  assert.match(markup, /id="register-confirm-password-error"[\s\S]*?aria-live="polite"/u);
  assert.match(styles, /\.auth-field-error\[hidden\]\s*\{\s*display:\s*none;/u);
});
