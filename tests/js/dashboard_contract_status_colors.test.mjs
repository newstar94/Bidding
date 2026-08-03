import assert from "node:assert/strict";
import test from "node:test";

import { getContractStatusCatalog } from "../../frontend/app/DashboardView.js";

test("contract status colors survive an empty catalog after workspace reset", () => {
  const catalog = getContractStatusCatalog({
    state: { customcontractstatuses: [] },
  });

  assert.deepEqual(
    Object.fromEntries(catalog.map((status) => [status.name, status.color])),
    {
      "Chưa hiệu lực": "#64748B",
      "Đang thực hiện": "#2563EB",
      "Tạm dừng": "#D97706",
      "Đã hoàn thành": "#059669",
      "Đã thanh lý": "#0F766E",
      "Đã hủy": "#DC2626",
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
    { id: "status-running", name: "Đang thực hiện", color: "#2563EB" },
    { id: "status-complete", name: "Đã hoàn thành", color: "#059669" },
    { id: "status-custom", name: "Chờ nghiệm thu", color: "#64748B" },
  ]);
});
