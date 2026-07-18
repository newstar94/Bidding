import assert from "node:assert/strict";
import test from "node:test";

import { focusInvalidControl, getVisibleInvalidControl } from "../../frontend/app/formStateUtils.js";

test("targets the visible searchable input instead of its hidden select", () => {
  const searchInput = { tagName: "INPUT" };
  const wrapper = { querySelector: (selector) => selector === ".custom-select-search" ? searchInput : null };
  const input = {
    id: "gt-kehoachid",
    parentNode: {
      querySelector: (selector) => selector.includes("custom-select-wrapper") ? wrapper : null
    }
  };
  assert.equal(getVisibleInvalidControl(input), searchInput);
});

test("targets the Flatpickr alternate input for date validation", () => {
  const altInput = { tagName: "INPUT" };
  assert.equal(getVisibleInvalidControl({ _flatpickr: { altInput } }), altInput);
});

test("scrolls and focuses the resolved visible invalid control", async () => {
  let scrolled = false;
  let focused = false;
  const visibleControl = {
    tagName: "INPUT",
    scrollIntoView: () => { scrolled = true; },
    focus: () => { focused = true; }
  };
  focusInvalidControl({ _flatpickr: { altInput: visibleControl } }, { delay: 0 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(scrolled, true);
  assert.equal(focused, true);
});
