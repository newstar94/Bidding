import test from "node:test";
import assert from "node:assert/strict";

import { buildStaffWorkloadRows } from "../../frontend/app/DashboardView.js";
import { resolveCommandArgs } from "../../frontend/shared/commandArgs.js";

// ADR 0104 — manager-only staff coordination board.
const workload = {
  rows: [
    {
      userId: "emp-1",
      name: "Nguyễn <An>",
      role: "employee",
      activePackages: 2,
      preparing: 0,
      inviting: 1,
      evaluating: 1,
      activeContracts: 3,
      alerts: 2,
      earliestDeadline: "2026-10-21",
    },
    { userId: "owner-1", name: "", role: "owner", activePackages: 0, alerts: 0, earliestDeadline: "" },
  ],
  unassigned: { activePackages: 1, preparing: 1, alerts: 1, earliestDeadline: "2026-11-01" },
};

test("member rows open the existing employee detail with the member id", () => {
  const html = buildStaffWorkloadRows(workload);
  const argKey = html.match(/data-fn="viewEmployee" data-arg-key="([^"]+)"/)[1];
  assert.deepEqual(resolveCommandArgs(argKey), ["emp-1"]);
  assert.match(html, /Nguyễn &lt;An&gt;/);
  assert.match(html, /<small>Chuyên viên<\/small>/);
  assert.match(html, /<small>Quản lý cao nhất<\/small>/);
  assert.match(html, /Chưa có tên/);
});

test("counts, alert emphasis and earliest deadline are rendered", () => {
  const html = buildStaffWorkloadRows(workload);
  assert.match(html, /dashboard-staff-number dashboard-staff-alerts">2</);
  assert.match(html, /21\/10\/2026/);
  assert.match(html, /<td>—<\/td>/);
});

test("unassigned packages get their own row without a contract count or action", () => {
  const html = buildStaffWorkloadRows(workload);
  const unassignedRow = html.split('class="dashboard-staff-unassigned"')[1];
  assert.match(unassignedRow, /Chưa phân công/);
  assert.doesNotMatch(unassignedRow, /data-bf-action/);
  assert.equal(buildStaffWorkloadRows({ rows: [], unassigned: { activePackages: 0 } }), "");
});
