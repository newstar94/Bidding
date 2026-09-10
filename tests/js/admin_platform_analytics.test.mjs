import assert from "node:assert/strict";
import test from "node:test";

import { analyticsResultsMarkup, buildAnalyticsQueries, normalizeAnalyticsFilters } from "../../frontend/admin-platform/AdminAnalytics.js";

test("analytics filters accept valid ordered ISO dates and only supported buckets", () => {
  assert.deepEqual(normalizeAnalyticsFilters({ from: "2026-08-01", to: "2026-08-30", bucket: "hour" }), {
    from: "2026-08-01", to: "2026-08-30", bucket: "hour",
  });
  assert.throws(() => normalizeAnalyticsFilters({ from: "2026-02-30" }), /không hợp lệ/u);
  assert.throws(() => normalizeAnalyticsFilters({ from: "2026-09-01", to: "2026-08-01" }), /Ngày bắt đầu/u);
  assert.equal(normalizeAnalyticsFilters({ bucket: "minute" }).bucket, "day");
});

test("analytics builds bounded queries for both real aggregate endpoints", () => {
  assert.deepEqual(buildAnalyticsQueries({ from: "2026-08-01", to: "2026-08-30", bucket: "day", secret: "no" }), {
    usage: { from: "2026-08-01", to: "2026-08-30", bucket: "day" },
    product: { from: "2026-08-01", to: "2026-08-30", view: "overview" },
  });
});

test("analytics renders real zeroes, missing values as N/A and no unknown payload fields", () => {
  const markup = analyticsResultsMarkup({
    coverage: { hasData: true }, onlineNow: 0, activeUsers: 7,
    topFeatures: [{ feature: "packages", label: "Gói thầu", count: 19, uniqueUsers: null }],
    secret: "do-not-render",
  }, { dashboard: {
    hasData: true,
    kpis: [{ key: "active", label: "Không gian hoạt động", value: 12, change: null }],
    internal: "hidden-value",
  } });
  assert.match(markup, /Đang trực tuyến[\s\S]*>0</u);
  assert.match(markup, /Người dùng hoạt động[\s\S]*>7</u);
  assert.match(markup, /Lượt xuất Word[\s\S]*>N\/A</u);
  assert.match(markup, /Gói thầu/u);
  assert.doesNotMatch(markup, /do-not-render|hidden-value/u);
});

test("analytics renders an explicit empty state when both sources have no data", () => {
  const markup = analyticsResultsMarkup(
    { coverage: { hasData: false } },
    { dashboard: { hasData: false, message: "Chưa đủ mẫu." } },
  );
  assert.match(markup, /data-admin-state="empty"/u);
  assert.match(markup, /Chưa đủ mẫu/u);
});
