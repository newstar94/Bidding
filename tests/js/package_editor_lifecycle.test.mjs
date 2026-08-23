import assert from "node:assert/strict";
import test from "node:test";

import {
  runPackageFormSubmission,
  setPackageEditorState,
} from "../../frontend/packages/packageFormState.js";

function lifecycleFixture() {
  let modalActive = true;
  const attributes = new Map();
  const buttonAttributes = new Map();
  const button = {
    disabled: false,
    setAttribute(name, value) {
      buttonAttributes.set(name, String(value));
    },
    removeAttribute(name) {
      buttonAttributes.delete(name);
    },
  };
  const modal = {
    dataset: {},
    classList: {
      contains(name) {
        return name === "active" && modalActive;
      },
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
  const form = {
    dataset: {},
    querySelector(selector) {
      return selector === 'button[type="submit"]' ? button : null;
    },
    closest() {
      return modal;
    },
    setAttribute(name, value) {
      attributes.set(`form:${name}`, String(value));
    },
    removeAttribute(name) {
      attributes.delete(`form:${name}`);
    },
  };
  const event = {
    currentTarget: form,
    preventDefaultCalls: 0,
    preventDefault() {
      this.preventDefaultCalls += 1;
    },
  };
  return {
    attributes,
    button,
    buttonAttributes,
    event,
    form,
    modal,
    closeModal() {
      modalActive = false;
    },
  };
}

test("package submit lifecycle blocks duplicate saves and restores an active editor", async () => {
  const fixture = lifecycleFixture();
  let resolveSave;
  let saveCalls = 0;
  const controller = {
    async handleGoiThauSubmit() {
      saveCalls += 1;
      await new Promise((resolve) => {
        resolveSave = resolve;
      });
    },
  };

  const first = runPackageFormSubmission(controller, fixture.event);
  assert.equal(fixture.form.dataset.submitState, "saving");
  assert.equal(fixture.button.disabled, true);
  assert.equal(fixture.buttonAttributes.get("aria-busy"), "true");

  const duplicate = await runPackageFormSubmission(controller, fixture.event);
  assert.equal(duplicate, false);
  assert.equal(saveCalls, 1);

  resolveSave();
  assert.equal(await first, true);
  assert.equal(fixture.form.dataset.submitState, "ready");
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.buttonAttributes.has("aria-busy"), false);
});

test("package submit lifecycle records a closed editor after a successful save", async () => {
  const fixture = lifecycleFixture();
  const controller = {
    async handleGoiThauSubmit() {
      fixture.closeModal();
    },
  };

  assert.equal(await runPackageFormSubmission(controller, fixture.event), true);
  assert.equal(fixture.form.dataset.submitState, "saved");
  assert.equal(fixture.button.disabled, true);
});

test("package editor state exposes deterministic loading and ready signals", () => {
  const fixture = lifecycleFixture();

  setPackageEditorState(fixture.modal, "loading");
  assert.equal(fixture.modal.dataset.editorState, "loading");
  assert.equal(fixture.attributes.get("aria-busy"), "true");

  setPackageEditorState(fixture.modal, "ready");
  assert.equal(fixture.modal.dataset.editorState, "ready");
  assert.equal(fixture.attributes.has("aria-busy"), false);
});
