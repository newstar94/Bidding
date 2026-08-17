import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACT_STATUS_COLORS,
  DASHBOARD_STATUS_COLORS,
  PACKAGE_STATUS_COLORS,
  PLAN_STATUS_COLORS,
  getContractStatusCatalog,
} from "../../frontend/app/DashboardView.js";

test("contract status colors survive an empty catalog after workspace reset", () => {
  const catalog = getContractStatusCatalog({
    state: { customcontractstatuses: [] },
  });

  assert.deepEqual(
    Object.fromEntries(catalog.map((status) => [status.name, status.color])),
    {
      "Chưa hiệu lực": "#64748B",
      "Đang thực hiện": "#3B82F6",
      "Tạm dừng": "#F59E0B",
      "Đã hoàn thành": "#22C55E",
      "Đã thanh lý": "#14B8A6",
      "Đã hủy": "#F43F5E",
    },
  );
});

test("default contract status names recover their colors when reset rows omit color", () => {
  const catalog = getContractStatusCatalog({
    state: {
      customcontractstatuses: [
        { id: "status-running", name: "Đang thực hiện", color: "" },
        { id: "status-complete", name: "Đã hoàn thành" },
        { id: "status-custom", name: "Chờ nghiệm thu", color: "" },
      ],
    },
  });

  assert.deepEqual(catalog, [
    { id: "status-running", name: "Đang thực hiện", color: "#3B82F6" },
    { id: "status-complete", name: "Đã hoàn thành", color: "#22C55E" },
    { id: "status-custom", name: "Chờ nghiệm thu", color: "#64748B" },
  ]);
});

test("default statuses use the same dashboard colors across plans, contracts, and packages", () => {
  assert.equal(PLAN_STATUS_COLORS["Chưa triển khai"], DASHBOARD_STATUS_COLORS.neutral);
  assert.equal(CONTRACT_STATUS_COLORS["Chưa hiệu lực"], DASHBOARD_STATUS_COLORS.neutral);
  assert.equal(PLAN_STATUS_COLORS["Đang thực hiện"], PACKAGE_STATUS_COLORS["Đang mời thầu"]);
  assert.equal(CONTRACT_STATUS_COLORS["Đang thực hiện"], PACKAGE_STATUS_COLORS["Đang mời thầu"]);
  assert.equal(PLAN_STATUS_COLORS["Hoàn thành"], PACKAGE_STATUS_COLORS["Đã có kết quả"]);
  assert.equal(CONTRACT_STATUS_COLORS["Đã hoàn thành"], PACKAGE_STATUS_COLORS["Đã có kết quả"]);
  assert.equal(CONTRACT_STATUS_COLORS["Đã hủy"], PACKAGE_STATUS_COLORS["Hủy thầu"]);
});

test("legacy default contract colors render with the shared dashboard palette", () => {
  const catalog = getContractStatusCatalog({
    state: {
      customcontractstatuses: [
        { id: "active", name: "Đang thực hiện", color: "#2563EB" },
        { id: "custom", name: "Chờ nghiệm thu", color: "#7C3AED" },
      ],
    },
  });

  assert.deepEqual(catalog, [
    { id: "active", name: "Đang thực hiện", color: "#3B82F6" },
    { id: "custom", name: "Chờ nghiệm thu", color: "#7C3AED" },
  ]);
});
