import assert from "node:assert/strict";
import test from "node:test";

test("dashboard package counts use the same derived result status as the package list", async () => {
  const dashboard = await import("../../frontend/app/DashboardView.js");
  assert.equal(typeof dashboard.derivePackageStatusCounts, "function");

  const packages = [
    {
      id: "pkg-partial",
      phanLo: "Có",
      trangThai: "Đang chấm thầu",
      phanLoList: [
        { id: "lot-1", maPhanLo: "PL1" },
        { id: "lot-2", maPhanLo: "PL2" },
      ],
      danhGiaHsdtMetadata: JSON.stringify({
        lotBatches: {
          "batch-1": {
            id: "batch-1",
            status: "FINAL",
            lotIds: ["lot-1"],
            lotCodes: ["PL1"],
            result: { saved: true },
          },
        },
      }),
    },
    {
      id: "pkg-complete",
      phanLo: "Không",
      trangThai: "Đang chấm thầu",
      danhGiaHsdtMetadata: JSON.stringify({
        saved: true,
        result: { saved: true },
      }),
    },
  ];

  assert.deepEqual(dashboard.derivePackageStatusCounts(packages), {
    "Chuẩn bị": 0,
    "Đang mời thầu": 0,
    "Đã mở thầu": 0,
    "Đang chấm thầu": 0,
    "Đã có kết quả một phần": 1,
    "Đã có kết quả": 1,
    "Hủy thầu": 0,
  });
});

test("package status donut and legend share one semantic color for every status", async () => {
  const dashboard = await import("../../frontend/app/DashboardView.js");
  const model = dashboard.buildPackageStatusChartModel({
    "Chuẩn bị": 0,
    "Đang mời thầu": 0,
    "Đã mở thầu": 0,
    "Đang chấm thầu": 0,
    "Đã có kết quả một phần": 1,
    "Đã có kết quả": 1,
    "Hủy thầu": 0,
  });

  const positiveItems = model.items.filter((item) => item.count > 0);
  assert.equal(positiveItems.length, 2);
  assert.notEqual(positiveItems[0].color, positiveItems[1].color);
  positiveItems.forEach((item) => {
    assert.match(model.gradient, new RegExp(item.color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
  assert.equal(model.items.find((item) => item.status === "Đã có kết quả")?.color, "var(--success)");
  assert.equal(model.items.find((item) => item.status === "Hủy thầu")?.color, "var(--danger)");
});
