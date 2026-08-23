import assert from "node:assert/strict";
import test from "node:test";

import { bindImageUploadPreview } from "../../frontend/app/fileUploadUtils.js";

class FakeElement {
  constructor({ id = "", textContent = "" } = {}) {
    this.id = id;
    this.textContent = textContent;
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = { add() {}, remove() {} };
    this.disabled = false;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  dispatch(type, event = {}) {
    this.listeners.get(type)?.({
      preventDefault() {},
      stopPropagation() {},
      ...event,
    });
  }
}

function harness() {
  const uploadZone = new FakeElement({ textContent: "Chọn ảnh con dấu" });
  const fileInput = new FakeElement({ id: "stamp-file" });
  let clicks = 0;
  fileInput.click = () => {
    clicks += 1;
  };
  bindImageUploadPreview({
    uploadZone,
    fileInput,
    previewContainer: new FakeElement(),
    previewImg: new FakeElement(),
  });
  return { uploadZone, fileInput, get clicks() { return clicks; } };
}

test("image upload zone exposes button semantics and keyboard activation", () => {
  const target = harness();

  assert.equal(target.uploadZone.getAttribute("role"), "button");
  assert.equal(target.uploadZone.getAttribute("tabindex"), "0");
  assert.equal(target.uploadZone.getAttribute("aria-controls"), "stamp-file");
  assert.equal(target.uploadZone.getAttribute("aria-label"), "Chọn ảnh con dấu");

  let enterPrevented = 0;
  target.uploadZone.dispatch("keydown", {
    key: "Enter",
    preventDefault: () => { enterPrevented += 1; },
  });
  target.uploadZone.dispatch("keydown", { key: " " });

  assert.equal(target.clicks, 2);
  assert.equal(enterPrevented, 1);
});

test("disabled image input cannot be activated with pointer or keyboard", () => {
  const target = harness();
  target.fileInput.disabled = true;

  target.uploadZone.dispatch("click");
  target.uploadZone.dispatch("keydown", { key: "Enter" });

  assert.equal(target.clicks, 0);
  assert.equal(target.uploadZone.getAttribute("aria-disabled"), "true");
});
