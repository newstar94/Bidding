import assert from "node:assert/strict";
import test from "node:test";

import { runModalFormSubmission } from "../../frontend/shared/ModalFormSubmission.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const formAttributes = new Map();
  const buttonAttributes = new Map();
  const button = {
    disabled: false,
    setAttribute(name, value) { buttonAttributes.set(name, String(value)); },
    removeAttribute(name) { buttonAttributes.delete(name); },
  };
  const form = {
    dataset: {},
    querySelector(selector) { return selector === 'button[type="submit"]' ? button : null; },
    setAttribute(name, value) { formAttributes.set(name, String(value)); },
    removeAttribute(name) { formAttributes.delete(name); },
  };
  return { button, buttonAttributes, form, formAttributes };
}

test("modal form submission exposes saving state and blocks a duplicate submit", async () => {
  const saving = deferred();
  const subject = fixture();
  let calls = 0;
  const submit = () => {
    calls += 1;
    return saving.promise;
  };

  const first = runModalFormSubmission({ currentTarget: subject.form, preventDefault() {} }, submit);
  assert.equal(subject.form.dataset.submitState, "saving");
  assert.equal(subject.formAttributes.get("aria-busy"), "true");
  assert.equal(subject.button.disabled, true);
  assert.equal(subject.buttonAttributes.get("aria-busy"), "true");

  assert.equal(
    await runModalFormSubmission({ currentTarget: subject.form, preventDefault() {} }, submit),
    false,
  );
  assert.equal(calls, 1);

  saving.resolve();
  assert.equal(await first, true);
  assert.equal(subject.form.dataset.submitState, "ready");
  assert.equal(subject.formAttributes.has("aria-busy"), false);
  assert.equal(subject.button.disabled, false);
  assert.equal(subject.buttonAttributes.has("aria-busy"), false);
});

test("primary CRUD forms use the shared saving-state lifecycle", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => (
    readFile(new URL("../../frontend/app/BiddingControllerForms.js", import.meta.url), "utf8")
  ));
  for (const formId of ["form-chudautu", "form-nhathau", "form-chuyengia", "form-hopdong"]) {
    assert.match(
      source,
      new RegExp(`${formId}[\\s\\S]{0,320}runModalFormSubmission`),
      `${formId} must expose the shared busy and duplicate-submit guard`,
    );
  }
});
