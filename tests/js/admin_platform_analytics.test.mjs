import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYTICS_VIEWS,
  analyticsFilterMarkup,
  analyticsPresetRange,
  analyticsResultsMarkup,
  operationalAnalyticsMarkup,
  buildAnalyticsQueries,
  normalizeAnalyticsFilters,
} from "../../frontend/admin-platform/AdminAnalytics.js";

test("operational analytics renders authoritative process metrics and explicit unavailable coverage", () => {
  const markup = operationalAnalyticsMarkup({ operations: {
    analytics: {
      http: { scope: "current_process", requests: 120, clientErrors: 4, serverErrors: 2, averageLatencyMs: 12.5 },
      database: { scope: "current_process", averageLatencyMs: 8.2 },
    },
    documentWorker: { failed: 3, rejected: 1, averageQueueWaitMs: 7.5 },
    backgroundJobs: [{ status: "pending", count: 5 }, { status: "retry", count: 2 }],
  } });
  for (const value of ["120", "4", "2", "12,5 ms", "7", "8,2 ms"]) assert.match(markup, new RegExp(value, "u"));
  assert.match(markup, /Lỗi worker/u);
  assert.match(markup, /Lỗi đồng bộ theo thời gian/u);
  assert.match(markup, /N\/A/u);
  assert.doesNotMatch(markup, /private-route|DATABASE_URL/u);
});

test("analytics filters accept valid ordered ISO dates and only supported buckets", () => {
  assert.deepEqual(normalizeAnalyticsFilters({ from: "2026-08-01", to: "2026-08-30", bucket: "hour" }), {
    from: "2026-08-01", to: "2026-08-30", bucket: "hour", view: "overview", preset: "custom",
  });
  assert.throws(() => normalizeAnalyticsFilters({ from: "2026-02-30" }), /không hợp lệ/u);
  assert.throws(() => normalizeAnalyticsFilters({ from: "2026-09-01", to: "2026-08-01" }), /Ngày bắt đầu/u);
  assert.equal(normalizeAnalyticsFilters({ bucket: "minute" }).bucket, "day");
});

test("analytics builds bounded queries for both real aggregate endpoints", () => {
  assert.deepEqual(buildAnalyticsQueries({
    from: "2026-08-01", to: "2026-08-30", bucket: "day", view: "retention", preset: "custom", secret: "no",
  }), {
    usage: { from: "2026-08-01", to: "2026-08-30", bucket: "day" },
    product: { from: "2026-08-01", to: "2026-08-30", view: "retention" },
  });
});

test("analytics presets calculate inclusive local calendar ranges", () => {
  const today = "2026-09-11";
  assert.deepEqual(analyticsPresetRange("7d", today), { from: "2026-09-05", to: today });
  assert.deepEqual(analyticsPresetRange("30d", today), { from: "2026-08-13", to: today });
  assert.deepEqual(analyticsPresetRange("90d", today), { from: "2026-06-14", to: today });
  assert.deepEqual(analyticsPresetRange("year", today), { from: "2026-01-01", to: today });
  assert.equal(analyticsPresetRange("invalid", today), null);
});

test("analytics safely normalizes invalid preset and view", () => {
  assert.deepEqual(normalizeAnalyticsFilters({
    preset: "invalid", view: "raw-secrets", bucket: "minute",
  }, { referenceDate: "2026-09-11" }), {
    from: "2026-08-13", to: "2026-09-11", bucket: "day", view: "overview", preset: "30d",
  });
});

test("analytics forwards every supported product view unchanged", () => {
  for (const [view] of ANALYTICS_VIEWS) {
    const queries = buildAnalyticsQueries({
      from: "2026-08-01", to: "2026-08-30", preset: "custom", bucket: "hour", view, unknown: "no",
    });
    assert.equal(queries.product.view, view);
    assert.deepEqual(queries.usage, { from: "2026-08-01", to: "2026-08-30", bucket: "hour" });
    assert.equal(Object.hasOwn(queries.product, "bucket"), false);
    assert.equal(Object.hasOwn(queries.product, "unknown"), false);
    assert.equal(Object.hasOwn(queries.usage, "view"), false);
  }
});

test("analytics filter renders all supported views and date presets", () => {
  const markup = analyticsFilterMarkup(normalizeAnalyticsFilters({
    from: "2026-08-01", to: "2026-08-30", preset: "custom", view: "features",
  }));
  for (const [view, label] of ANALYTICS_VIEWS) {
    assert.ok(markup.includes(`value="${view}"`));
    assert.ok(markup.includes(`>${label}</option>`));
  }
  for (const preset of ["7d", "30d", "90d", "year", "custom"]) {
    assert.ok(markup.includes(`data-analytics-preset="${preset}"`));
  }
  assert.match(markup, /data-analytics-preset="custom"[^>]*aria-pressed="true"/u);
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

test("analytics renders responsive accessible charts with tabular fallbacks and suppressed values", () => {
  const markup = analyticsResultsMarkup(
    { coverage: { hasData: true }, topFeatures: [] },
    { dashboard: {
      hasData: true,
      kpis: [],
      series: [{ key: "activity", label: "Hoạt động", points: [
        { date: "2026-08-01", value: 12 },
        { date: "2026-08-02", value: null, status: "insufficient_sample", raw: "hidden" },
      ] }],
      viewCharts: [{ key: "empty", label: "Chuỗi trống", series: [{ label: "Không có điểm", points: [] }] }],
      segments: [{ segment: "Nhóm A", workspaceCount: 8, secret: "segment-secret" }],
      table: [{ metric: "P50", value: 4, internal: "table-secret" }],
      rawPayload: "dashboard-secret",
    } },
  );
  assert.match(markup, /aria-labelledby="admin-chart-0"/u);
  assert.match(markup, /<svg[^>]*role="img"[^>]*aria-label="Hoạt động: 1 điểm có dữ liệu/u);
  assert.match(markup, /<polyline|<circle/u);
  assert.match(markup, /<caption class="visually-hidden">Dữ liệu dạng bảng cho Hoạt động/u);
  assert.match(markup, /<table[\s\S]*2026-08-01[\s\S]*12/u);
  assert.match(markup, /2026-08-02[\s\S]*N\/A[\s\S]*Không đủ mẫu/u);
  assert.match(markup, /Chuỗi trống[\s\S]*Chưa có điểm dữ liệu/u);
  assert.match(markup, /Phân khúc[\s\S]*Nhóm A[\s\S]*8/u);
  assert.match(markup, /Chi tiết[\s\S]*P50[\s\S]*4/u);
  assert.doesNotMatch(markup, /rawPayload|segment-secret|table-secret|hidden-value|dashboard-secret/u);
});

test("analytics renders an explicit empty state when both sources have no data", () => {
  const markup = analyticsResultsMarkup(
    { coverage: { hasData: false } },
    { dashboard: { hasData: false, message: "Chưa đủ mẫu." } },
  );
  assert.match(markup, /data-admin-state="empty"/u);
  assert.match(markup, /Chưa đủ mẫu/u);
});
