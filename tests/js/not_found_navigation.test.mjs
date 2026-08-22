import assert from "node:assert/strict";
import test from "node:test";

import {
  notFoundNavigationTarget,
} from "../../frontend/errors/NotFoundPage.js";

test("404 reference helper opens a real destination without promising query filtering", () => {
  assert.equal(notFoundNavigationTarget("PL2600000001"), "/ke-hoach");
  assert.equal(notFoundNavigationTarget("ib2600000001-02"), "/goi-thau");
  assert.equal(notFoundNavigationTarget("nội dung khác"), "/tong-quan");
  assert.equal(notFoundNavigationTarget("  "), "");
  assert.doesNotMatch(notFoundNavigationTarget("PL2600000001"), /[?&]q=/u);
});
