import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import {
  overviewMarkup,
  renderAdminOverview,
} from "../../frontend/admin-platform/AdminOverview.js";

DOMPurify.isSupported = true;
DOMPurify.sanitize = (value) => String(value);

function number(value) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function overviewPayload({ metrics = {}, charts = [] } = {}) {
  return {
    generatedAt: "2026-09-23T02:42:00Z",
    metrics,
    charts,
    recentOrganizations: [],
    activityFeed: [],
    alerts: [],
  };
}

function chartPayload() {
  return [
    {
      key: "revenue",
      label: "Doanh thu theo thời gian",
      series: [{
        key: "revenue",
        label: "Doanh thu đã xác minh",
        points: [
          { date: "2026-09-06", value: 7_500_000 },
          { date: "2026-09-23", value: 5_000_000 },
        ],
      }],
    },
    {
      key: "newOrganizations",
      label: "Tổ chức mới",
      series: [{
        key: "newOrganizations",
        label: "Tổ chức mới",
        points: [
          { date: "2026-09-06", value: 3 },
          { date: "2026-09-23", value: 4 },
        ],
      }],
    },
    {
      key: "newUsers",
      label: "Người dùng mới",
      series: [{
        key: "newUsers",
        label: "Người dùng mới",
        points: [
          { date: "2026-09-06", value: 24 },
          { date: "2026-09-23", value: 45 },
        ],
      }],
    },
    {
      key: "subscriptionDistribution",
      label: "Phân bố đăng ký",
      series: [{
        key: "subscriptionDistribution",
        label: "Đăng ký theo trạng thái",
        points: [
          { label: "active", value: 96 },
          { label: "expired", value: 8 },
        ],
      }],
    },
    {
      key: "invoiceStatus",
      label: "Trạng thái hóa đơn",
      series: [{
        key: "invoiceStatus",
        label: "Hóa đơn theo trạng thái",
        points: [
          { label: "requested", value: 2 },
          { label: "issued", value: 6 },
        ],
      }],
    },
  ];
}

function metricCardMarkup(markup, key) {
  const marker = `data-admin-metric="${key}"`;
  const markerIndex = markup.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing metric ${key}`);
  const start = markup.lastIndexOf("<article", markerIndex);
  const end = markup.indexOf("</article>", markerIndex);
  assert.notEqual(start, -1, `missing card for ${key}`);
  assert.notEqual(end, -1, `unterminated card for ${key}`);
  return markup.slice(start, end + "</article>".length);
}

function chartCardMarkup(markup, title) {
  const titleIndex = markup.indexOf(`>${title}</h3>`);
  assert.notEqual(titleIndex, -1, `missing chart ${title}`);
  const start = markup.lastIndexOf("<article", titleIndex);
  const end = markup.indexOf("</article>", titleIndex);
  assert.notEqual(start, -1, `missing chart card for ${title}`);
  assert.notEqual(end, -1, `unterminated chart card for ${title}`);
  return markup.slice(start, end + "</article>".length);
}

function fixtureContainer() {
  const state = {
    attributes: {},
    html: "",
    healthMarkup: "",
    healthAttributes: {},
  };
  const healthHost = {
    setAttribute(name, value) {
      state.healthAttributes[name] = String(value);
    },
    get innerHTML() {
      return state.healthMarkup;
    },
    set innerHTML(value) {
      state.healthMarkup = String(value);
    },
    querySelector() {
      return null;
    },
  };
  return {
    state,
    setAttribute(name, value) {
      state.attributes[name] = String(value);
    },
    get innerHTML() {
      return state.html;
    },
    set innerHTML(value) {
      state.html = String(value);
    },
    querySelector(selector) {
      if (selector === "[data-admin-health-summary]") return healthHost;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

const fullMetrics = {
  organizations: 128,
  activeOrganizations: 119,
  newOrganizations30Days: 12,
  users: 3_482,
  activeAccounts: 3_320,
  activeUsers: 2_400,
  newUsers30Days: 246,
  activeSubscriptions: 96,
  currentPeriodRevenue: { value: 12_500_000, currency: "VND", period: "current_month" },
  mrr: 5_000_000,
  arr: 60_000_000,
  unpaidInvoices: 4,
  overdueInvoices: 2,
  pendingJobs: 3,
};

test("overview preserves all fourteen metrics and every authoritative chart series", () => {
  const markup = overviewMarkup(overviewPayload({
    metrics: fullMetrics,
    charts: chartPayload(),
  }));

  assert.equal((markup.match(/data-admin-metric=/gu) || []).length, 14);
  const expectedMetrics = [
    ["organizations", number(128)],
    ["activeOrganizations", number(119)],
    ["newOrganizations30Days", number(12)],
    ["users", number(3_482)],
    ["activeAccounts", number(3_320)],
    ["activeUsers", number(2_400)],
    ["newUsers30Days", number(246)],
    ["activeSubscriptions", number(96)],
    ["verifiedRevenue", `${number(12_500_000)} ₫`],
    ["mrr", `${number(5_000_000)} ₫`],
    ["arr", `${number(60_000_000)} ₫`],
    ["unpaidInvoices", number(4)],
    ["overdueInvoices", number(2)],
    ["pendingJobs", number(3)],
  ];
  for (const [key, value] of expectedMetrics) {
    assert.match(markup, new RegExp(`data-admin-metric="${key}">${value.replaceAll(".", "\\.")}(?:<|\\s)`), key);
  }

  const expectedCharts = [
    ["Doanh thu theo thời gian", ["Doanh thu đã xác minh", "2026-09-06", "2026-09-23", "7.500.000", "5.000.000"]],
    ["Tổ chức mới", ["Tổ chức mới", "2026-09-06", "2026-09-23", "3", "4"]],
    ["Người dùng mới", ["Người dùng mới", "2026-09-06", "2026-09-23", "24", "45"]],
    ["Phân bố đăng ký", ["Đăng ký theo trạng thái", "active", "expired", "96", "8"]],
    ["Trạng thái hóa đơn", ["Hóa đơn theo trạng thái", "requested", "issued", "2", "6"]],
  ];
  for (const [title, expected] of expectedCharts) {
    const chart = chartCardMarkup(markup, title);
    for (const text of expected) {
      assert.match(chart, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `${title}: ${text}`);
    }
  }
});

test("missing metrics stay neutral: no payment claim or upward trend is invented", () => {
  const markup = overviewMarkup(overviewPayload({
    metrics: { organizations: 128, users: 3_482 },
  }));

  assert.doesNotMatch(markup, /Chưa cấu hình thanh toán|Cấu hình thanh toán/iu);
  assert.doesNotMatch(markup, /[↗↑]|arrow-up|trending-up/iu);
  for (const key of ["organizations", "users", "activeSubscriptions", "verifiedRevenue"]) {
    const card = metricCardMarkup(markup, key);
    assert.doesNotMatch(card, /is-new-count/iu, `unavailable ${key} has a trend marker`);
    assert.doesNotMatch(card, /(?:^|[>\s])\+[0-9]|trong 30 ngày|so với tháng trước|tăng trưởng/iu, `unavailable ${key} has positive trend copy`);
  }
});

test("overview renders health resource states without changing their meaning", () => {
  const payload = overviewPayload({ metrics: fullMetrics });
  const markup = overviewMarkup(payload, {
    healthPayload: {
      generatedAt: "2026-09-23T02:42:00Z",
      resources: {
        application: { status: "healthy" },
        postgresql: { status: "degraded" },
        backgroundJobs: { status: "unavailable" },
      },
    },
  });

  assert.match(markup, /Hoạt động/u);
  assert.match(markup, /Cần kiểm tra/u);
  assert.match(markup, /Không khả dụng/u);
  assert.match(markup, /2026-09-23T02:42:00Z/u);

  const unknownMarkup = overviewMarkup(payload, {
    healthPayload: {
      generatedAt: "2026-09-23T02:42:00Z",
      resources: {
        application: { status: "unknown" },
        postgresql: { status: "unknown" },
        backgroundJobs: { status: "unknown" },
      },
    },
  });
  assert.match(unknownMarkup, /Chưa xác định/u);
});

test("aborting overview consumes both pending requests without an unhandled rejection", async () => {
  const requests = [];
  const settled = [];
  const controller = new AbortController();
  const fetchImpl = (url, { signal }) => new Promise((_resolve, reject) => {
    const abort = () => {
      settled.push(url);
      reject(signal.reason || new DOMException("Request cancelled", "AbortError"));
    };
    requests.push(url);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  const container = fixtureContainer();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const rendering = renderAdminOverview(container, {
      fetchImpl,
      signal: controller.signal,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(new Set(requests), new Set(["/api/admin/health", "/api/admin/overview"]));
    controller.abort();
    await rendering;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled.length, 2);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("health failure is explicit while the loaded overview remains visible", async () => {
  const payload = overviewPayload({ metrics: fullMetrics });
  const container = fixtureContainer();
  const fetchImpl = async (url) => {
    if (url === "/api/admin/health") return jsonResponse({ error: "health unavailable" }, 500);
    assert.equal(url, "/api/admin/overview");
    return jsonResponse(payload);
  };

  await renderAdminOverview(container, { fetchImpl });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(container.state.html, /data-admin-metric="organizations">128/u);
  assert.match(container.state.healthMarkup, /data-admin-state="error"/u);
  assert.match(container.state.healthMarkup, /Không thể|lỗi|Lỗi|không tải/iu);
  assert.doesNotMatch(container.state.healthMarkup, /Đang kiểm tra trạng thái/iu);
});
