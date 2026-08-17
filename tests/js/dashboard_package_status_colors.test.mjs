import assert from "node:assert/strict";
import test from "node:test";

import { buildPackageStatusChartModel } from "../../frontend/app/DashboardView.js";

test("package status dashboard chart preserves status order with the brighter palette", () => {
  const model = buildPackageStatusChartModel({
    "Chưa xác định": 1,
    "Chuẩn bị": 1,
    "Đang mời thầu": 1,
    "Đã mở thầu": 1,
    "Đang chấm thầu": 1,
    "Đã có kết quả một phần": 1,
    "Đã có kết quả": 1,
    "Hủy thầu": 1,
  });

  assert.deepEqual(
    model.items.map(({ status, color }) => ({ status, color })),
    [
      { status: "Chưa xác định", color: "#94A3B8" },
      { status: "Chuẩn bị", color: "#64748B" },
      { status: "Đang mời thầu", color: "#3B82F6" },
      { status: "Đã mở thầu", color: "#F59E0B" },
      { status: "Đang chấm thầu", color: "#A855F7" },
      { status: "Đã có kết quả một phần", color: "#14B8A6" },
      { status: "Đã có kết quả", color: "#22C55E" },
      { status: "Hủy thầu", color: "#F43F5E" },
    ],
  );
});
