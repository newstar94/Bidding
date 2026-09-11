import assert from "node:assert/strict";
import test from "node:test";

import { overviewMarkup } from "../../frontend/admin-platform/AdminOverview.js";
import { adminLoadingMarkup, adminStateMarkup } from "../../frontend/admin-platform/AdminStateView.js";

test("overview renders only real allowlisted values and marks missing metrics unavailable", () => {
  const markup = overviewMarkup({
    generatedAt: "2026-09-10T00:00:00Z",
    metrics: {
      organizations: { total: 17 },
      users: { total: 42 },
      subscriptions: { active: 8 },
      billing: { verifiedRevenue: 1_250_000 },
      secretValue: "do-not-render",
    },
    recentOrganizations: [{ name: "Công ty Minh An", status: "active", secret: "hidden" }],
  });
  assert.match(markup, />17</u);
  assert.match(markup, />42</u);
  assert.match(markup, /data-admin-metric="activeSubscriptions">8</u);
  assert.match(markup, /data-admin-metric="verifiedRevenue">1[.]250[.]000 ₫</u);
  assert.match(markup, /Công ty Minh An/u);
  assert.doesNotMatch(markup, /do-not-render|hidden/u);
});

test("overview renders at least ten authoritative metric slots and marks missing values unavailable", () => {
  const markup = overviewMarkup({ metrics: {}, recentOrganizations: [] });
  assert.equal((markup.match(/data-admin-metric=/gu) || []).length, 14);
  assert.equal((markup.match(/>N\/A(?:<| ₫<)/gu) || []).length, 14);
  assert.match(markup, /Chưa có tổ chức gần đây/u);
  assert.match(markup, /Chưa có dữ liệu có thẩm quyền để lập biểu đồ/u);
});

test("overview consumes the current authoritative backend metric contract", () => {
  const markup = overviewMarkup({
    metrics: {
      organizations: 17,
      users: 42,
      activeSubscriptions: 8,
      currentPeriodRevenue: { value: 1_250_000, currency: "VND", period: "current_month" },
    },
    recentOrganizations: [],
  });
  assert.match(markup, /data-admin-metric="organizations">17/u);
  assert.match(markup, /data-admin-metric="users">42/u);
  assert.match(markup, /data-admin-metric="activeSubscriptions">8/u);
  assert.match(markup, /data-admin-metric="verifiedRevenue">1[.]250[.]000 ₫/u);
});

test("overview includes accessible charts, activity feed and actionable alerts", () => {
  const markup = overviewMarkup({
    generatedAt: "2026-09-11T00:00:00Z",
    metrics: { organizations: 10, activeOrganizations: 8, users: 20, activeAccounts: 17 },
    activityFeed: [{
      id: "invoice-1:payment", kind: "invoice.payment_verified",
      title: "INV-001", occurredAt: "2026-09-10T08:00:00Z",
      status: "settled", detail: "ORDER-001",
    }],
    alerts: [{
      title: "Tổ chức cần rà soát", message: "Tổ chức không hoạt động.", count: 2,
      href: "/admin/organizations?status=suspended",
    }],
    recentOrganizations: [],
  });
  assert.equal((markup.match(/role="img"/gu) || []).length, 2);
  assert.equal((markup.match(/<caption class="visually-hidden">/gu) || []).length, 2);
  assert.match(markup, /INV-001/u);
  assert.match(markup, /Thanh toán gắn yêu cầu hóa đơn đã xác minh/u);
  assert.match(markup, /ORDER-001/u);
  assert.match(markup, /href="\/admin\/organizations[?]status=suspended"/u);
  assert.match(markup, /Cảnh báo cần xử lý/u);
});

test("shared states provide accessible loading, empty, retry and permission variants", () => {
  assert.match(adminLoadingMarkup(), /role="status"/u);
  assert.match(adminStateMarkup("empty"), /data-admin-state="empty"/u);
  assert.match(adminStateMarkup("error", { retry: true }), /data-admin-retry/u);
  assert.doesNotMatch(adminStateMarkup("permission", { retry: false }), /data-admin-retry/u);
});
