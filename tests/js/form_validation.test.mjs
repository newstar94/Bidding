import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  constraintValidationMessage,
  validateNativeForm,
} from "../../frontend/shared/FormValidation.js";

function createClassList() {
  const values = new Set();
  return {
    contains: (value) => values.has(value),
    remove: (...items) => items.forEach((item) => values.delete(item)),
    toggle(value, force) {
      if (force) values.add(value);
      else values.delete(value);
    },
  };
}

function createFixtureControl({ id, label, validity }) {
  const errors = new Map();
  const group = {
    children: [],
    classList: createClassList(),
    offsetWidth: 320,
    offsetHeight: 72,
    appendChild(element) {
      element.parentElement = this;
      this.children.push(element);
      errors.set(element.id, element);
    },
    insertBefore(element) {
      this.appendChild(element);
    },
    querySelector(selector) {
      if (selector.includes("data-bf-validation-for") || selector.includes(".error-text")) {
        return this.children.find((element) => element.className?.includes("field-validation-error")) || null;
      }
      return null;
    },
  };
  const attributes = new Map();
  const listeners = new Map();
  const ownerDocument = {
    createElement() {
      const elementAttributes = new Map();
      return {
        className: "",
        classList: { contains: (value) => String(this.className || "").split(/\s+/).includes(value) },
        dataset: {},
        hidden: false,
        id: "",
        textContent: "",
        setAttribute(name, value) {
          elementAttributes.set(name, value);
        },
        getAttribute(name) {
          return elementAttributes.get(name) || null;
        },
      };
    },
    getElementById(errorId) {
      return errors.get(errorId) || null;
    },
    querySelector(selector) {
      return selector === `label[for="${id}"]` ? { textContent: label } : null;
    },
  };
  const control = {
    attributes,
    dataset: {},
    disabled: false,
    focused: false,
    id,
    ownerDocument,
    parentElement: group,
    parentNode: group,
    required: true,
    scrolled: false,
    tagName: "INPUT",
    type: "text",
    validity,
    value: "",
    willValidate: true,
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    closest(selector) {
      if (selector === ".form-group") return group;
      return null;
    },
    focus() {
      this.focused = true;
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    matches(selector) {
      return selector === "input, select, textarea";
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    scrollIntoView() {
      this.scrolled = true;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  return { control, group };
}

test("constraint validation messages are localized by error type", () => {
  const missing = createFixtureControl({
    id: "full-name",
    label: "Họ và tên *",
    validity: { valid: false, valueMissing: true },
  }).control;
  assert.equal(constraintValidationMessage(missing), "Vui lòng nhập họ và tên.");

  const email = createFixtureControl({
    id: "email",
    label: "Địa chỉ Email *",
    validity: { valid: false, typeMismatch: true },
  }).control;
  email.type = "email";
  assert.equal(constraintValidationMessage(email), "Địa chỉ email chưa đúng định dạng.");
});

test("native form validation renders below every invalid field and focuses the first", async () => {
  const first = createFixtureControl({
    id: "first-name",
    label: "Họ và tên *",
    validity: { valid: false, valueMissing: true },
  });
  const second = createFixtureControl({
    id: "email",
    label: "Email *",
    validity: { valid: false, typeMismatch: true },
  });
  second.control.type = "email";
  const form = { elements: [first.control, second.control] };

  const result = validateNativeForm(form);

  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidControls, [first.control, second.control]);
  assert.equal(first.group.classList.contains("invalid"), true);
  assert.equal(first.control.getAttribute("aria-invalid"), "true");
  assert.equal(first.group.children[0].textContent, "Vui lòng nhập họ và tên.");
  assert.equal(first.group.children[0].getAttribute("role"), "alert");
  assert.match(first.control.getAttribute("aria-describedby"), /first-name-error/u);
  assert.equal(first.control.scrolled, true);
  assert.equal(second.control.scrolled, false);
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(first.control.focused, true);
});

test("application forms opt out of browser tooltips and use the shared submit guard", () => {
  const accessibility = fs.readFileSync("frontend/shared/semanticAccessibility.js", "utf8");
  const authMarkup = fs.readFileSync("views/components/auth_overlay.html", "utf8");
  const componentsCss = fs.readFileSync("views/css/components.css", "utf8");
  const shell = fs.readFileSync("views/index.html", "utf8");
  assert.match(accessibility, /form\.noValidate = true/u);
  assert.match(accessibility, /addEventListener\?\.\("submit"[\s\S]*validateNativeForm\(form\)/u);
  assert.match(accessibility, /event\.stopImmediatePropagation\?\.\(\)/u);
  assert.equal((authMarkup.match(/<form id="form-auth-[^"]+"[^>]*novalidate/g) || []).length, 5);
  assert.match(componentsCss, /\.form-group\.invalid textarea[\s\S]*\.field-validation-error/u);
  assert.match(shell, /components\.css[^"\n]*inline-form-validation-v1-20260802/u);
});
