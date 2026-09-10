import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  createUsageAnalyticsTracker,
  featureCodeForTab,
} from "../../frontend/app/UsageAnalyticsTracker.js";
import { buildAnalyticsQueries, normalizeAnalyticsFilters } from "../../frontend/admin-platform/AdminAnalytics.js";

test("usage analytics replacement keeps bounded date and bucket queries", async () => {
  await assert.rejects(() => access(new URL("../../frontend/admin/UsageAnalyticsView.js", import.meta.url)));
  const filters = normalizeAnalyticsFilters({ from: "2026-08-01", to: "2026-08-30", bucket: "hour" });
  assert.deepEqual(buildAnalyticsQueries(filters).usage, {
    from: "2026-08-01", to: "2026-08-30", bucket: "hour",
  });
  assert.throws(() => normalizeAnalyticsFilters({ from: "2026-09-01", to: "2026-08-30" }), /Ngày bắt đầu/u);
});

test("workspace usage tracker still sends only allowlisted aggregate feature codes", async () => {
  const requests = [];
  const tracker = createUsageAnalyticsTracker({
    send: async (payload) => {
      requests.push(payload);
      return new Response(null, { status: 204 });
    },
    documentRef: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    windowRef: { addEventListener() {}, removeEventListener() {} },
    now: () => 1_000,
  });
  assert.equal(featureCodeForTab("goithau"), "packages");
  assert.equal(featureCodeForTab("untrusted-feature"), "");
  tracker.trackFeature("goithau");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, [{ eventType: "feature_used", feature: "packages" }]);
  tracker.stop();
});
