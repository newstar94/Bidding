import test from "node:test";
import assert from "node:assert/strict";

import { renderVersionSelector } from "../../frontend/shared/VersionSelector.js";

test("version selector always has an accessible name", () => {
  const markup = renderVersionSelector({
    versions: [{ id: "version-1", phienBan: "1" }],
    selectedId: "version-1",
    rootId: "root-1",
    changeAction: "change-version",
    ariaLabel: "Chọn phiên bản gói thầu GT-01",
  });

  assert.match(markup, /aria-label="Chọn phiên bản gói thầu GT-01"/u);
});
