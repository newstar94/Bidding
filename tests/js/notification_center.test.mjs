import assert from "node:assert/strict";
import test from "node:test";

import { formatMoment } from "../../frontend/app/NotificationCenter.js";

test("notification timestamps use the app date separator", () => {
  assert.equal(formatMoment("2026-07-24T13:58:00Z"), "20:58 24/07");
});
