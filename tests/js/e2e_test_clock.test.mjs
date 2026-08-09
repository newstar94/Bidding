import assert from "node:assert/strict";
import test from "node:test";

import { createE2ETestClock } from "../../scripts/e2e_test_clock.mjs";


test("E2E test clock derives ordered Vietnamese business dates", () => {
  const clock = createE2ETestClock({
    now: "2026-08-09T00:00:00+07:00",
    timeZone: "Asia/Ho_Chi_Minh",
  });

  assert.equal(clock.date(-1), "08/08/2026");
  assert.equal(clock.date(0), "09/08/2026");
  assert.equal(clock.dateTime(2, "08:30"), "11/08/2026 08:30");
  assert.equal(clock.isoDate(3), "2026-08-12");
  assert.equal(clock.isoDateTime(2, "08:30"), "2026-08-11 08:30:00");
  assert.equal(clock.quarter(0), "Quý III/2026");
});


test("E2E test clock rejects invalid anchors, offsets, and times", () => {
  assert.throws(() => createE2ETestClock({ now: "not-a-date" }), /valid instant/);
  const clock = createE2ETestClock({ now: 0 });
  assert.throws(() => clock.date(0.5), /integer day offset/);
  assert.throws(() => clock.dateTime(0, "8:30"), /HH:MM/);
});
