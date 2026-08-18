import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACT_STATUS_COLORS,
  PACKAGE_STATUS_PRESENTATION,
  PLAN_STATUS_COLORS,
  resolveContractStatusColor,
} from "../../frontend/shared/statusPresentation.js";
import {
  renderCustomStatusBadge,
  renderPackageStatusBadge,
} from "../../frontend/shared/statusBadges.js";

test("package status badges use the shared bright semantic palette", () => {
  const reviewing = PACKAGE_STATUS_PRESENTATION["Đang chấm thầu"];
  assert.equal(reviewing.color, "#A855F7");
  assert.match(renderPackageStatusBadge("Đang chấm thầu"), /badge-status-review.*--status-color: #A855F7;/);
  assert.match(renderPackageStatusBadge("Đã có kết quả"), /badge-status-complete/);
});

test("plans, contracts, and packages retain shared status hues", () => {
  assert.equal(PLAN_STATUS_COLORS["Đang thực hiện"], CONTRACT_STATUS_COLORS["Đang thực hiện"]);
  assert.equal(PLAN_STATUS_COLORS["Hoàn thành"], CONTRACT_STATUS_COLORS["Đã hoàn thành"]);
  assert.equal(resolveContractStatusColor("Đang thực hiện", [
    { name: "Đang thực hiện", color: "#2563EB" },
  ]), "#3B82F6");
  assert.equal(resolveContractStatusColor("Chờ nghiệm thu", [
    { name: "Chờ nghiệm thu", color: "#7C3AED" },
  ]), "#7C3AED");
  assert.match(
    renderCustomStatusBadge("Đang thực hiện", [
      { name: "Đang thực hiện", color: "#2563EB" },
    ]),
    /class="badge status-pill" style="--status-color: #3B82F6;"/,
  );
});
