import assert from "node:assert/strict";
import test from "node:test";

import { inferIconButtonName } from "../../frontend/shared/semanticAccessibility.js";

function button({ id = "", classes = [], icon = "", title = "", tooltip = "" } = {}) {
  const attributes = new Map([
    ["title", title],
    ["data-tooltip", tooltip]
  ]);
  return {
    id,
    classList: { contains: (name) => classes.includes(name) },
    getAttribute: (name) => attributes.get(name) || null,
    querySelector: () => icon ? { getAttribute: () => icon } : null
  };
}

test("icon-only controls receive action-specific accessible names", () => {
  assert.equal(inferIconButtonName(button({ classes: ["btn-delete"] })), "Xóa");
  assert.equal(inferIconButtonName(button({ icon: "eye" })), "Xem chi tiết");
  assert.equal(inferIconButtonName(button({ tooltip: "Mở lịch" })), "Mở lịch");
});

test("an element id remains a readable last-resort name", () => {
  assert.equal(inferIconButtonName(button({ id: "btn-export-word" })), "export word");
});
