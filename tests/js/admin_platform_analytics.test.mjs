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
  unsupportedAnalyticsMarkup,
} from "../../frontend/admin-platform/AdminAnalytics.js";

test("analytics publishes explicit unsupported metric and chart extension seams", () => {
  const markup = unsupportedAnalyticsMarkup();
  for (const key of [
    "mrr", "arr", "arpu", "upgrade", "downgrade", "cancellation", "churn",
    "trial-conversion", "dau", "wau", "mau", "plans-created", "packages-created",
    "contracts-created", "contractors-created", "sync-mutations", "row-version-conflicts",
    "sync-failures", "storage-usage",
  ]) {
    assert.match(markup, new RegExp(`data-admin-unsupported-metric="${key}"`, "u"));
  }
  for (const key of [
    "revenue-over-time", "mrr-growth", "product-activity",
    "document-generation", "sync-activity",
  ]) {
    assert.match(markup, new RegExp(`data-admin-unsupported-chart="${key}"`, "u"));
  }
  assert.match(markup, /Chưa có nguồn dữ liệu tổng hợp có thẩm quyền/u);
  assert.doesNotMatch(markup, /data-admin-unsupported-(?:metric|chart)="[^"]+"[^>]*data-value=/u);
});

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

test("analytics preserves every supported commercial filter and excludes unknown values", () => {
  const filters = normalizeAnalyticsFilters({
    from: "2026-08-01", to: "2026-08-30", bucket: "day", view: "retention", preset: "custom",
    ownerKind: "organization", variant: "connected", releaseId: "release-2026-09",
    releaseMode: "live", plan: "business", sizeBucket: "6_15", paidState: "paid",
    cohortKind: "first_value", procurementIntensity: "high",
    collaborationIntensity: "active", aiAdoption: "adopted", secret: "no",
  });
  assert.deepEqual(buildAnalyticsQueries(filters), {
    usage: { from: "2026-08-01", to: "2026-08-30", bucket: "day" },
    product: {
      from: "2026-08-01", to: "2026-08-30", view: "retention",
      ownerKind: "organization", variant: "connected", releaseId: "release-2026-09",
      releaseMode: "live", plan: "business", sizeBucket: "6_15", paidState: "paid",
      cohortKind: "first_value", procurementIntensity: "high",
      collaborationIntensity: "active", aiAdoption: "adopted",
    },
  });
  const invalid = buildAnalyticsQueries({
    from: "2026-08-01", to: "2026-08-30", preset: "custom",
    ownerKind: "workspace", variant: "all", releaseMode: "production",
    sizeBucket: "huge", paidState: "trial", cohortKind: "raw",
    procurementIntensity: "medium", collaborationIntensity: "busy", aiAdoption: "maybe",
  });
  for (const key of ["ownerKind", "variant", "releaseMode", "sizeBucket", "paidState", "cohortKind", "procurementIntensity", "collaborationIntensity", "aiAdoption"]) {
    assert.equal(Object.hasOwn(invalid.product, key), false);
  }
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

test("analytics filter exposes the complete legacy commercial segmentation contract", () => {
  const markup = analyticsFilterMarkup(normalizeAnalyticsFilters({
    from: "2026-08-01", to: "2026-08-30", preset: "custom",
    ownerKind: "organization", variant: "connected", releaseId: "release-1",
    releaseMode: "live", plan: "gold", sizeBucket: "6_15", paidState: "paid",
    cohortKind: "first_value", procurementIntensity: "high",
    collaborationIntensity: "active", aiAdoption: "adopted",
  }));
  for (const name of ["ownerKind", "variant", "releaseId", "releaseMode", "plan", "sizeBucket", "paidState", "cohortKind", "procurementIntensity", "collaborationIntensity", "aiAdoption"]) {
    assert.match(markup, new RegExp(`name="${name}"`, "u"));
  }
  assert.match(markup, /name="ownerKind"[\s\S]*value="organization" selected/u);
  assert.match(markup, /name="releaseId"[^>]*maxlength="128"[^>]*value="release-1"/u);
  assert.match(markup, /name="aiAdoption"[\s\S]*value="adopted" selected/u);
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

test("analytics restores authoritative usage peak averages event total and concurrency series", () => {
  const markup = analyticsResultsMarkup({
    coverage: { hasData: true }, onlineNow: 4, activeUsers: 12,
    workActivityCount: 30, wordExportCount: 9, eventCount: 58,
    peakConcurrency: { count: 7, start: "2026-08-02T08:00:00Z", end: "2026-08-02T09:00:00Z" },
    averages: { jobsPerActiveUser: 2.5, wordExportsPerActiveUser: 0.75 },
    concurrencySeries: [
      { timestamp: "2026-08-02T08:00:00Z", count: 7 },
      { timestamp: "2026-08-02T09:00:00Z", count: 4 },
    ],
    secretUsageField: "do-not-render",
  }, { dashboard: { hasData: false } });
  assert.match(markup, /Cao điểm[\s\S]*>7</u);
  assert.match(markup, /Hoạt động công việc \/ người[\s\S]*>2,5</u);
  assert.match(markup, /Lượt xuất Word \/ người[\s\S]*>0,75</u);
  assert.match(markup, /Tổng hoạt động được đo[\s\S]*>58</u);
  assert.match(markup, /Người hoạt động theo thời gian/u);
  assert.match(markup, /2026-08-02T08:00:00Z[\s\S]*>7</u);
  assert.match(markup, /<svg[^>]*role="img"/u);
  assert.doesNotMatch(markup, /do-not-render|secretUsageField/u);
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

test("analytics overview renders every authoritative overview chart returned by the backend", () => {
  const markup = analyticsResultsMarkup(
    { coverage: { hasData: false } },
    { dashboard: {
      hasData: true,
      series: [],
      overviewCharts: [
        {
          key: "revenue_cost",
          label: "Doanh thu và chi phí",
          series: [{ key: "revenue", label: "Doanh thu", points: [{ date: "2026-09-01", value: 1_250_000 }] }],
        },
        {
          key: "plan_distribution",
          label: "Phân phối gói",
          series: [{ key: "connected", label: "Kết nối", points: [{ label: "Kết nối", value: 8 }] }],
        },
      ],
      viewCharts: [],
    } },
  );
  assert.match(markup, /Doanh thu và chi phí/u);
  assert.match(markup, /Phân phối gói/u);
  assert.match(markup, /1[.]250[.]000/u);
  assert.match(markup, /<svg[^>]*role="img"/u);
});
