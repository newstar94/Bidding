import assert from "node:assert/strict";
import test from "node:test";

import { shouldUseServerDashboardSummary } from "../../frontend/app/DashboardView.js";

test("dashboard rejects an empty server summary when scoped package data is already available", () => {
  const emptySummary = {
    counts: { goithau: 0 },
    statusCounts: {},
    recentPackages: [],
  };

  assert.equal(
    shouldUseServerDashboardSummary(emptySummary, [{ id: "pkg-1" }, { id: "pkg-2" }]),
    false,
  );
  assert.equal(
    shouldUseServerDashboardSummary(emptySummary, []),
    true,
  );
  assert.equal(
    shouldUseServerDashboardSummary({
      counts: { goithau: 2 },
      statusCounts: { completed: 2 },
      recentPackages: [{ id: "pkg-1" }, { id: "pkg-2" }],
    }, [{ id: "pkg-1" }, { id: "pkg-2" }]),
    true,
  );
});
