import assert from "node:assert/strict";
import test from "node:test";

import { onById } from "../../frontend/app/domUtils.js";

test("reinitializing a package add action keeps a single click handler", () => {
  const handlers = [];
  const button = {
    addEventListener(eventName, handler) {
      if (eventName === "click") handlers.push(handler);
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return id === "btn-them-phanlo" ? button : null;
    },
  };

  let rowsAdded = 0;
  const bindAddLot = () => onById(
    "btn-them-phanlo",
    "click",
    () => { rowsAdded += 1; },
  );

  try {
    bindAddLot();
    bindAddLot();
    handlers.forEach((handler) => handler());
  } finally {
    globalThis.document = previousDocument;
  }

  assert.equal(handlers.length, 1);
  assert.equal(rowsAdded, 1);
});
