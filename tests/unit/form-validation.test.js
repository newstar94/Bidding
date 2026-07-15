import test from "node:test";
import assert from "node:assert/strict";
import { validateForm } from "../../frontend/shared/FormValidation.js";
import { normalizeFormValues } from "../../frontend/shared/FormBinder.js";

function control({ id, value = "", type = "text", required = true } = {}) {
  const classes = new Set();
  const error = { textContent: "Lỗi mặc định", dataset: {} };
  const group = { offsetWidth: 10, offsetHeight: 10, querySelector: () => error, classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name), remove: (name) => classes.delete(name) } };
  return { id, value, type, required, offsetWidth: 10, offsetHeight: 10, closest: () => group, addEventListener() {}, removeEventListener() {}, getAttribute: () => null, classes };
}

test("configured form validation returns every invalid control", () => {
  const name = control({ id: "name", value: "" });
  const email = control({ id: "email", value: "invalid", type: "email" });
  const form = { querySelectorAll: () => [name, email] };
  const result = validateForm(form, { focus: false });
  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidControls, [name, email]);
  assert.equal(name.classes.has("invalid"), true);
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
