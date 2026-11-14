import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildWelcomeSummary,
  dashboardGreeting,
  dashboardShortName,
  renderUpcomingMilestones,
  selectUpcomingMilestones,
} from "../../frontend/app/DashboardHero.js";

const NOW = new Date(2026, 10, 13, 8, 30);

function item(id, deadline, overrides = {}) {
  return { id, alertKey: "closingSoon", targetType: "package", maGoiThau: id, tenGoiThau: `Gói ${id}`, deadline, ...overrides };
}

test("greeting follows the local time of day", () => {
  assert.equal(dashboardGreeting(new Date(2026, 0, 1, 8)), "Chào buổi sáng");
  assert.equal(dashboardGreeting(new Date(2026, 0, 1, 12)), "Chào buổi trưa");
  assert.equal(dashboardGreeting(new Date(2026, 0, 1, 15)), "Chào buổi chiều");
  assert.equal(dashboardGreeting(new Date(2026, 0, 1, 20)), "Chào buổi tối");
});

test("Vietnamese names are shortened to their last two parts", () => {
  assert.equal(dashboardShortName("Nguyễn Minh Anh"), "Minh Anh");
  assert.equal(dashboardShortName("Administrator"), "Administrator");
  assert.equal(dashboardShortName("  "), "");
});

test("welcome summary only restates the alert counts", () => {
  assert.match(buildWelcomeSummary({ items: [] }), /không có việc khẩn cấp/u);
  const summary = buildWelcomeSummary({
    items: [{}, {}, {}],
    counts: { closingToday: 1, delayedEvaluation: 2 },
  });
  assert.match(summary, /<strong>3 việc<\/strong>/u);
  assert.match(summary, /<strong>1 gói thầu<\/strong> đóng thầu trong ngày/u);
  assert.match(summary, /<strong>2 báo cáo đánh giá<\/strong> đã chậm/u);
  assert.equal(buildWelcomeSummary({ items: [{}], counts: {} }), "Hôm nay có <strong>1 việc</strong> cần bạn xử lý.");
});

test("upcoming card keeps today through the next seven days, soonest first", () => {
  const selected = selectUpcomingMilestones({
    items: [
      item("late", "2026-11-25T09:00"),
      item("past", "2026-11-12T17:00"),
      item("day7", "2026-11-20T23:00"),
      item("today", "2026-11-13T14:00"),
      item("soon", "2026-11-16T09:00"),
      item("undated", ""),
    ],
  }, NOW);
  assert.deepEqual(selected.map(({ item: entry }) => entry.id), ["today", "soon", "day7"]);
  assert.equal(selectUpcomingMilestones({ items: Array.from({ length: 6 }, (_, index) => item(`i${index}`, "2026-11-14T09:00")) }, NOW).length, 4);
});

test("upcoming rows escape names and open the same records as the task table", () => {
  const html = renderUpcomingMilestones(selectUpcomingMilestones({
    items: [
      item("p1", "2026-11-13T14:00", { tenGoiThau: "<script>x</script>" }),
      item("k1", "2026-11-15T00:00", { targetType: "plan", maKeHoach: "KH-01", tenKeHoach: "Kế hoạch", alertKey: "planPublishingWarning" }),
    ],
  }, NOW), NOW);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /dashboard-upcoming-date is-today/u);
  assert.match(html, /data-bf-action="show-package" data-id="p1"/u);
  assert.match(html, /data-bf-action="show-plan" data-id="k1"/u);
  assert.match(html, /Hôm nay · 14:00/u);
  assert.match(renderUpcomingMilestones([], NOW), /Không có mốc nào trong 7 ngày tới/u);
});

test("dashboard template keeps existing hooks next to the new hero blocks", async () => {
  const template = await readFile(new URL("../../views/tabs/tab_dashboard.html", import.meta.url), "utf8");
  for (const id of [
    "dashboard-welcome-title", "dashboard-welcome-summary", "btn-dashboard-welcome-action",
    "dashboard-upcoming-list", "dashboard-action-items", "recent-packages-table",
    "plan-status-breakdown", "contract-summary-breakdown", "status-legend-list",
    "dashboard-staff-card", "stat-count-chudautu", "btn-view-all-packages",
  ]) {
    assert.match(template, new RegExp(`id="${id}"`, "u"), id);
  }
  const workGrid = template.slice(template.indexOf('class="dashboard-work-grid"'), template.indexOf('id="dashboard-staff-card"'));
  assert.match(workGrid, /dashboard-status-card/u);
  const metricGrid = template.slice(template.indexOf('class="dashboard-metric-grid"'), template.indexOf("dashboard-partner-strip"));
  assert.match(metricGrid, /id="recent-packages-table"/u);
});
