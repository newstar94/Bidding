import assert from "node:assert/strict";
import test from "node:test";

import { applyWordVariableFormAccess } from "../../frontend/documents/WordIntegration.js";

function createControl() {
  const attributes = new Map();
  return {
    disabled: false,
    attributes,
    removeAttribute(name) {
      attributes.delete(name);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

function createForm() {
  const attributes = new Map();
  const classes = new Set();
  const card = { hidden: true };
  const browseSelect = createControl();
  const mutableInputs = [createControl(), createControl()];
  const actionGroup = createControl();
  actionGroup.hidden = false;
  return {
    actionGroup,
    attributes,
    browseSelect,
    card,
    classes,
    hidden: true,
    mutableInputs,
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    closest(selector) {
      return selector === ".dashboard-card" ? card : null;
    },
    querySelectorAll(selector) {
      if (selector === 'input:not([type="hidden"]), textarea') return mutableInputs;
      if (selector === ".word-config-actions") return [actionGroup];
      assert.fail(`Unexpected selector: ${selector}`);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

test("read-only Word dictionary keeps manager layout while locking mutations", () => {
  const form = createForm();

  applyWordVariableFormAccess([form], false);

  assert.equal(form.hidden, false);
  assert.equal(form.card.hidden, false);
  assert.equal(form.attributes.get("aria-hidden"), "false");
  assert.equal(form.attributes.get("aria-readonly"), "true");
  assert.equal(form.classes.has("is-readonly"), true);
  assert.equal(form.browseSelect.disabled, false);
  assert.equal(form.actionGroup.hidden, true);
  assert.equal(form.actionGroup.attributes.get("aria-hidden"), "true");
  form.mutableInputs.forEach((control) => {
    assert.equal(control.disabled, true);
    assert.equal(control.attributes.get("aria-disabled"), "true");
  });
});

test("manager Word dictionary restores mutation controls", () => {
  const form = createForm();
  applyWordVariableFormAccess([form], false);

  applyWordVariableFormAccess([form], true);

  assert.equal(form.classes.has("is-readonly"), false);
  assert.equal(form.attributes.get("aria-readonly"), "false");
  assert.equal(form.actionGroup.hidden, false);
  assert.equal(form.actionGroup.attributes.get("aria-hidden"), "false");
  form.mutableInputs.forEach((control) => {
    assert.equal(control.disabled, false);
    assert.equal(control.attributes.has("aria-disabled"), false);
  });
});
