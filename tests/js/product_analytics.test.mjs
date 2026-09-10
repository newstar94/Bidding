import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  analyticsResultsMarkup,
  buildAnalyticsQueries,
  normalizeAnalyticsFilters,
} from "../../frontend/admin-platform/AdminAnalytics.js";

const root = new URL("../../", import.meta.url);

test("Tabler analytics replaces retired product analytics UI with bounded aggregate queries", async () => {
  await assert.rejects(() => access(new URL("frontend/admin/ProductAnalyticsView.js", root)));
  await assert.rejects(() => access(new URL("views/tabs/tab_usage_analytics.html", root)));
  const filters = normalizeAnalyticsFilters({ from: "2026-08-01", to: "2026-08-30", bucket: "day" });
  assert.deepEqual(buildAnalyticsQueries(filters), {
    usage: { from: "2026-08-01", to: "2026-08-30", bucket: "day" },
    product: { from: "2026-08-01", to: "2026-08-30", view: "overview" },
  });
});

test("replacement analytics renders only real aggregate fields", () => {
  const markup = analyticsResultsMarkup(
    { coverage: { hasData: true }, onlineNow: 2, activeUsers: 5, topFeatures: [] },
    { dashboard: { hasData: true, kpis: [{ key: "active", label: "Hoạt động", value: 7 }] } },
  );
  assert.match(markup, /Đang trực tuyến[\s\S]*>2</u);
  assert.match(markup, /Hoạt động/u);
});
