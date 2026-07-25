import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BiddingView } from "../../frontend/app/BiddingView.js";

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

function modalElement(id, active = false) {
  return {
    id,
    classList: new FakeClassList(active ? ["modal-overlay", "active"] : ["modal-overlay"]),
  };
}

test("package modal opens above an active plan breakdown modal", () => {
  const planModal = modalElement("modal-plan-breakdown", true);
  const packageModal = modalElement("modal-goithau");
  const elements = new Map([
    [planModal.id, planModal],
    [packageModal.id, packageModal],
  ]);
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (selector) => {
      if (selector !== ".modal-overlay.active") return [];
      return [...elements.values()].filter((element) => element.classList.contains("active"));
    },
  };

  try {
    const view = new BiddingView({});
    view.enhanceVisibleContent = () => {};
    view.createIconsScoped = () => {};

    view.openModal("modal-goithau");

    assert.equal(packageModal.classList.contains("active"), true);
    assert.equal(packageModal.classList.contains("modal-stack-level-1"), true);
    const modalCss = readFileSync(
      new URL("../../views/css/components.css", import.meta.url),
      "utf8",
    );
    assert.match(
      modalCss,
      /\.modal-overlay\.modal-stack-level-1\s*\{[^}]*z-index:\s*110;/s,
    );

    view.closeModal("modal-goithau");
    assert.equal(packageModal.classList.contains("modal-stack-level-1"), false);
  } finally {
    globalThis.document = previousDocument;
  }
});
