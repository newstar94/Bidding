import assert from "node:assert/strict";
import test from "node:test";

import { buildPackageDetailViewModel } from "../../frontend/packages/detail/PackageDetailViewModel.js";

const ONE_ENVELOPE = "Một giai đoạn một túi hồ sơ";

function packageRecord(id, version, overrides = {}) {
  return {
    id,
    rootId: "pkg-root",
    phienBan: version,
    keHoachId: `plan-${version}`,
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: ONE_ENVELOPE,
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    ...overrides,
  };
}

function modelFor(packages, plans = []) {
  return {
    state: { goithau: packages, thongtinmothau: [], kehoach: plans },
    getLatestPackage(packageId) {
      const requested = packages.find((pkg) => pkg.id === packageId);
      const rootId = requested?.rootId || requested?.id;
      return packages
        .filter((pkg) => (pkg.rootId || pkg.id) === rootId)
        .sort((left, right) => Number(right.phienBan) - Number(left.phienBan))[0] || null;
    },
    getLatestPlan(planId) {
      const requested = plans.find((plan) => plan.id === planId);
      if (!requested) return null;
      return plans
        .filter((plan) => (plan.rootId || plan.id) === (requested.rootId || requested.id))
        .sort((left, right) => Number(right.phienBan) - Number(left.phienBan))[0] || null;
    },
  };
}

test("package detail canonicalizes to the latest version unless the user switches explicitly", () => {
  const v1 = packageRecord("pkg-v1", "01");
  const v2 = packageRecord("pkg-v2", "02");
  const model = modelFor([v1, v2]);

  assert.equal(buildPackageDetailViewModel({ model, packageId: v1.id }).packageId, v2.id);
  assert.equal(buildPackageDetailViewModel({
    model,
    packageId: v1.id,
    switchingVersion: true,
  }).packageId, v1.id);
});

test("package detail preserves a valid tab only for the same canonical package", () => {
  const pkg = packageRecord("pkg", "01", {
    danhGiaHsdtMetadata: JSON.stringify({ saved: true }),
  });
  const model = modelFor([pkg]);

  assert.equal(buildPackageDetailViewModel({
    model,
    packageId: pkg.id,
    currentPackageId: pkg.id,
    currentTab: "result",
  }).activeTab, "result");
  assert.equal(buildPackageDetailViewModel({
    model,
    packageId: pkg.id,
    currentPackageId: "another-package",
    currentTab: "result",
  }).activeTab, "preparation");
  assert.equal(buildPackageDetailViewModel({
    model,
    packageId: pkg.id,
    currentPackageId: pkg.id,
    currentTab: "missing",
  }).activeTab, "preparation");
});

test("package versions are deduplicated and prefer the copy on the newer plan", () => {
  const oldPlanCopy = packageRecord("pkg-v1-old-plan", "01", { keHoachId: "plan-v1" });
  const newPlanCopy = packageRecord("pkg-v1-new-plan", "01", { keHoachId: "plan-v2" });
  const v2 = packageRecord("pkg-v2", "02", { keHoachId: "plan-v2" });
  const plans = [
    { id: "plan-v1", rootId: "plan-root", phienBan: "01" },
    { id: "plan-v2", rootId: "plan-root", phienBan: "02" },
  ];
  const model = modelFor([oldPlanCopy, newPlanCopy, v2], plans);
  const detail = buildPackageDetailViewModel({
    model,
    packageId: oldPlanCopy.id,
    switchingVersion: true,
  });

  assert.deepEqual(detail.versions, [
    { id: newPlanCopy.id, label: "01", selected: true },
    { id: v2.id, label: "02", selected: false },
  ]);
});

test("package detail derives effective result status and editability in one place", () => {
  const completed = packageRecord("pkg", "01", {
    trangThai: "Đã có kết quả",
    danhGiaHsdtMetadata: JSON.stringify({ saved: true, result: { saved: true } }),
  });
  const editing = buildPackageDetailViewModel({
    model: modelFor([completed]),
    packageId: completed.id,
    editingWholePackage: true,
    editingWholePackageId: completed.id,
  });
  assert.equal(editing.effectiveStatus, "Đang chấm thầu");
  assert.equal(editing.isEditable, true);

  const cancelled = packageRecord("cancelled", "01", { trangThai: "Hủy thầu" });
  const cancelledDetail = buildPackageDetailViewModel({
    model: modelFor([cancelled]),
    packageId: cancelled.id,
  });
  assert.equal(cancelledDetail.isEditable, false);
  assert.equal(cancelledDetail.canCancel, false);
  assert.equal(cancelledDetail.tabs.at(-1).id, "documents");
});
