import test from "node:test";
import assert from "node:assert/strict";

import { renderVersionSelector } from "../../frontend/shared/VersionSelector.js";
import { getVersionLabel } from "../../frontend/shared/formatters.js";

test("version labels use at least two digits", () => {
  assert.equal(getVersionLabel("1"), "01");
  assert.equal(getVersionLabel(2), "02");
  assert.equal(getVersionLabel("10"), "10");
  assert.equal(getVersionLabel("123"), "123");
});

test("version selector always has an accessible name", () => {
  const markup = renderVersionSelector({
    versions: [{ id: "version-1", phienBan: "1" }],
    selectedId: "version-1",
    rootId: "root-1",
    changeAction: "change-version",
    ariaLabel: "Chọn phiên bản gói thầu GT-01",
  });

  assert.match(markup, /aria-label="Chọn phiên bản gói thầu GT-01"/u);
  assert.match(markup, />01<\/option>/u);
});
