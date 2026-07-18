import test from "node:test";
import assert from "node:assert/strict";
import { setValidationError, validateForm } from "../../frontend/shared/FormValidation.js";
import { normalizeFormValues } from "../../frontend/shared/FormBinder.js";

function control({ id, value = "", type = "text", required = true } = {}) {
  const classes = new Set();
  const attributes = new Map();
  const errorAttributes = new Map();
  const error = {
    textContent: "Lỗi mặc định",
    dataset: {},
    setAttribute(name, value) { errorAttributes.set(name, String(value)); },
    getAttribute(name) { return errorAttributes.get(name) ?? null; }
  };
  const group = { offsetWidth: 10, offsetHeight: 10, querySelector: () => error, classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name), remove: (name) => classes.delete(name) } };
  return {
    id, value, type, required, offsetWidth: 10, offsetHeight: 10,
    closest: () => group,
    addEventListener() {}, removeEventListener() {},
    setAttribute(name, attributeValue) { attributes.set(name, String(attributeValue)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    classes, error
  };
}

test("configured form validation returns every invalid control", () => {
  const name = control({ id: "name", value: "" });
  const email = control({ id: "email", value: "invalid", type: "email" });
  const form = { querySelectorAll: () => [name, email] };
  const result = validateForm(form, { focus: false });
  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidControls, [name, email]);
  assert.equal(name.classes.has("invalid"), true);
  assert.equal(name.getAttribute("aria-invalid"), "true");
  assert.equal(name.getAttribute("aria-describedby"), "name-error");
  assert.equal(name.error.getAttribute("role"), "alert");
});

test("form values normalize through one schema before persistence", () => {
  const normalized = normalizeFormValues({ code: "  VN01 ", amount: "1.000" }, {
    code: (value) => value.trim().toLowerCase(),
    amount: { normalize: (value) => Number(value.replaceAll(".", "")) }
  });
  assert.deepEqual(normalized, { code: "vn01", amount: 1000 });
});

test("configured validation manages one consistent error message", () => {
  const code = control({ id: "code", value: "bad", required: false });
  const form = { querySelector: () => code, querySelectorAll: () => [] };
  const result = validateForm(form, {
    focus: false,
    rules: [{ control: code, validate: value => value === "ok", message: "Mã không hợp lệ" }]
  });
  assert.equal(result.valid, false);
  assert.equal(code.closest().querySelector().textContent, "Mã không hợp lệ");
});

test("validation keeps messages inline without prepending an error summary", () => {
  const name = control({ id: "name", value: "" });
  let prependCount = 0;
  const form = {
    querySelectorAll: () => [name],
    prepend: () => { prependCount += 1; },
    ownerDocument: { createElement: () => ({}) }
  };
  const result = validateForm(form, { focus: false });

  assert.equal(result.valid, false);
  assert.equal(prependCount, 0);
  assert.equal(name.closest().querySelector().textContent, "Lỗi mặc định");
});

test("validation preserves help text when associating an inline error", () => {
  const field = control({ id: "email", value: "bad", type: "email" });
  field.setAttribute("aria-describedby", "email-help");

  setValidationError(field, "Email không hợp lệ");

  assert.equal(field.getAttribute("aria-describedby"), "email-help email-error");
  assert.equal(field.getAttribute("aria-invalid"), "true");
});
