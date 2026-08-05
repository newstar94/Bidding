import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { snapshotPackageAggregate } from "../../frontend/packages/packageAggregateSnapshot.js";
import {
  loadBreakdownPackageDetails,
  savePlanBreakdown,
} from "../../frontend/plans/KeHoachWorkflow.js";

function packageSnapshotPayload(pkg) {
  const {
    id: _id,
    keHoachId: _keHoachId,
    isLatest: _isLatest,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    rowVersion: _rowVersion,
    ...payload
  } = pkg;
  return payload;
}

function withoutOwnedIds(value) {
  if (Array.isArray(value)) return value.map(withoutOwnedIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => key !== "id" && item !== undefined)
    .map(([key, item]) => [key, withoutOwnedIds(item)]));
}

test("creating a plan version inherits a frozen package snapshot without incrementing its version", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "breakdown-plan-id") return { value: "plan-v00" };
      return null;
    },
  };

  const originalPlan = {
    id: "plan-v00",
    rootId: "plan-v00",
    phienBan: "00",
    isLatest: 1,
    thoiGianDangMa: "2026-08-01T08:00",
    createdAt: "2026-07-01T08:00",
  };
  const linkedPackage = {
    id: "package-v00",
    rootId: "package-v00",
    phienBan: "00",
    isLatest: 1,
    keHoachId: originalPlan.id,
    trangThai: "Đã có kết quả",
    nhaThauTrungThauId: "contractor-1",
    giaTrungThau: "900000000",
    phanLoList: [{ id: "lot-1", tenPhanLo: "Lô cũ", giaTrungThau: "900000000" }],
    timelineItems: [{ id: "timeline-1", status: "DONE" }],
    ehsmtAdjustments: [{ id: "adjustment-1", reason: "Điều chỉnh cũ" }],
  };
  const controller = {
    tempPlanAction: "edit",
    tempPlanData: {
      ...originalPlan,
      thoiGianDangMa: "2026-08-02T08:00",
    },
    backupKeHoachState: [structuredClone(originalPlan)],
    backupGoiThauState: [structuredClone(linkedPackage)],
    model: {
      state: {
        kehoach: [structuredClone(originalPlan)],
        goithau: [structuredClone(linkedPackage)],
        assignments: [{
          id: "plan-assignment-old",
          empId: "employee-1",
          targetId: originalPlan.id,
          type: "kehoach",
        }],
        activeuser: { id: "employee-1" },
      },
      addRecord: async () => {
        throw new Error("version assignment must be staged with its new plan");
      },
      getCurrentDateTimeString: () => "2026-08-05T10:00",
      persistData: async () => {},
      flushMutationOutbox: async () => {},
    },
    view: {
      renderKeHoachTable: async () => {},
      renderGoiThauTable: async () => {},
      customAlert: async () => {},
    },
    updateBreakdownTotal() {},
    closeModal() {},
    autoSync: async () => ({ ok: true }),
  };

  try {
    await savePlanBreakdown.call(controller);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.equal(controller.model.state.kehoach.length, 2, "plan must receive a new version");
  assert.equal(controller.model.state.goithau.length, 2, "new plan must inherit one package snapshot");
  const latestPlan = controller.model.state.kehoach.find((plan) => plan.isLatest == 1);
  const historicalPackage = controller.model.state.goithau.find((pkg) => pkg.id === linkedPackage.id);
  const inheritedPackage = controller.model.state.goithau.find((pkg) => pkg.id !== linkedPackage.id);
  assert.equal(historicalPackage.isLatest, 0);
  assert.equal(inheritedPackage.isLatest, 1);
  assert.equal(inheritedPackage.keHoachId, latestPlan.id);
  assert.equal(inheritedPackage.phienBan, linkedPackage.phienBan);
  assert.deepEqual(
    withoutOwnedIds(packageSnapshotPayload(inheritedPackage)),
    withoutOwnedIds({
      ...packageSnapshotPayload(linkedPackage),
      awardedPhanLoList: [],
      tuyChonMuaThemList: [],
      giaHanList: [],
      yeuCauLamRoList: [],
      traLoiLamRoList: [],
    }),
  );
  assert.notEqual(inheritedPackage.phanLoList[0].id, historicalPackage.phanLoList[0].id);
  assert.notEqual(inheritedPackage.timelineItems[0].id, historicalPackage.timelineItems[0].id);
  assert.notEqual(inheritedPackage.ehsmtAdjustments[0].id, historicalPackage.ehsmtAdjustments[0].id);
  assert.notStrictEqual(inheritedPackage.phanLoList, historicalPackage.phanLoList);
  assert.notStrictEqual(inheritedPackage.timelineItems, historicalPackage.timelineItems);
  const inheritedPlanAssignment = controller.model.state.assignments.find(
    (assignment) => assignment.type === "kehoach" && assignment.targetId === latestPlan.id,
  );
  assert.equal(inheritedPlanAssignment?.empId, "employee-1");
});

test("package copy-on-write clones mutable children and freezes the source aggregate", () => {
  let sequence = 0;
  const createId = (type) => `${type}-${++sequence}`;
  const source = {
    id: "package-old",
    rootId: "package-root",
    phienBan: "00",
    isLatest: 1,
    keHoachId: "plan-v00",
    tenGoiThau: "Tên cũ",
    trangThai: "Đã có kết quả",
    phanLo: "Có",
    phanLoList: [{ id: "lot-old", maPhanLo: "L01", tenPhanLo: "Lô 1" }],
    awardedPhanLoList: [{ id: "lot-old", maPhanLo: "L01", giaTrungThau: "90" }],
    timelineItems: [{ id: "timeline-old", sourceEntityId: "lot-old", trangThai: "DONE" }],
    ehsmtAdjustments: [{ id: "adjustment-old", reason: "Điều chỉnh cũ" }],
    danhGiaHsdtMetadata: JSON.stringify({
      criteria: [{ id: "criterion-old", code: "C01", name: "Tiêu chí" }],
      saved: true,
    }),
  };
  const state = {
    goithauhanghoa: [{ id: "goods-old", goiThauId: source.id, phanLoId: "lot-old", maHangHoa: "HH01" }],
    thongtinmothau: [{
      id: "opening-old",
      goiThauId: source.id,
      nhaThauId: "contractor-1",
      thanhVienLienDanh: [{ id: "member-old", thanhVienNhaThauId: "contractor-2" }],
      baoCaoDanhGiaChiTietList: [{
        id: "report-old",
        vongDanhGiaId: "evaluation-round:package-old:single",
        loaiVong: "single",
        chiTietList: [{ id: "detail-old", tieuChiDanhGiaId: "criterion-old", ketQua: "pass" }],
      }],
    }],
    hanghoaduthaunhathau: [{
      id: "bidder-goods-old",
      goiThauId: source.id,
      thongTinMoThauId: "opening-old",
      phanLoId: "lot-old",
      goiThauHangHoaId: "goods-old",
    }],
    assignments: [{ id: "assignment-old", targetId: source.id, type: "goithau", empId: "user-1" }],
  };
  const frozenSource = structuredClone({ source, state });

  const snapshot = snapshotPackageAggregate(state, source, {
    targetPackageId: "package-new",
    targetPlanId: "plan-v01",
    packageVersion: "01",
    timestamp: "2026-08-05T10:00:00",
    overrides: { tenGoiThau: "Tên mới" },
    createId,
  });

  assert.deepEqual({ source, state }, frozenSource, "snapshot creation must not mutate historical data");
  assert.equal(snapshot.packageRecord.keHoachId, "plan-v01");
  assert.equal(snapshot.packageRecord.phienBan, "01");
  assert.equal(snapshot.packageRecord.tenGoiThau, "Tên mới");
  assert.equal(snapshot.packageRecord.trangThai, "Đã có kết quả");
  assert.notEqual(snapshot.packageRecord.phanLoList[0].id, "lot-old");
  assert.equal(snapshot.packageRecord.timelineItems[0].sourceEntityId, snapshot.packageRecord.phanLoList[0].id);
  assert.equal(snapshot.goithauhanghoa[0].goiThauId, "package-new");
  assert.equal(snapshot.goithauhanghoa[0].phanLoId, snapshot.packageRecord.phanLoList[0].id);
  assert.equal(snapshot.thongtinmothau[0].goiThauId, "package-new");
  assert.notEqual(snapshot.thongtinmothau[0].id, "opening-old");
  assert.notEqual(snapshot.thongtinmothau[0].thanhVienLienDanh[0].id, "member-old");
  assert.equal(snapshot.hanghoaduthaunhathau[0].thongTinMoThauId, snapshot.thongtinmothau[0].id);
  assert.equal(snapshot.hanghoaduthaunhathau[0].goiThauHangHoaId, snapshot.goithauhanghoa[0].id);
  assert.equal(snapshot.assignments[0].targetId, "package-new");
  assert.notEqual(snapshot.assignments[0].id, "assignment-old");
  const clonedCriterion = JSON.parse(snapshot.packageRecord.danhGiaHsdtMetadata).criteria[0];
  const clonedReport = snapshot.thongtinmothau[0].baoCaoDanhGiaChiTietList[0];
  assert.equal(clonedReport.vongDanhGiaId, "evaluation-round:package-new:single");
  assert.equal(clonedReport.chiTietList[0].tieuChiDanhGiaId, clonedCriterion.id);
});

test("package snapshot canonicalizes browser date values before sync", () => {
  const source = {
    id: "package-old",
    rootId: "package-root",
    keHoachId: "plan-old",
    thoiGianDangTai: new Date(2026, 6, 31, 8, 0, 0),
    thoiGianDongThau: "2026-08-14T09:00:00.000Z",
    thoiGianMoThau: "14/08/2026 10:00",
    ngayQuyetDinhKetQua: "2026-08-20T00:00:00.000Z",
  };

  const snapshot = snapshotPackageAggregate({
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  }, source, {
    targetPackageId: "package-new",
    targetPlanId: "plan-new",
    timestamp: "2026-08-05 10:00:00",
    createId: (type) => `${type}-new`,
  });

  assert.match(snapshot.packageRecord.thoiGianDangTai, /^2026-07-31 08:00:00$/);
  assert.equal(snapshot.packageRecord.thoiGianDongThau, "2026-08-14 09:00:00");
  assert.equal(snapshot.packageRecord.thoiGianMoThau, "2026-08-14 10:00:00");
  assert.equal(snapshot.packageRecord.ngayQuyetDinhKetQua, "2026-08-20");
});

test("plan snapshot loader hydrates owned child tables even when local pagination flag is false", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousLucide = globalThis.lucide;
  const packageId = "package-old";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://localhost");
    const table = url.searchParams.get("table");
    const items = table === "goithauhanghoa"
      ? [{ id: "goods-old", goiThauId: packageId, maHangHoa: "HH01" }]
      : [];
    return new Response(JSON.stringify({ items, totalItems: items.length, hasMore: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  globalThis.document = {
    getElementById: (id) => id === "breakdown-plan-id" ? { value: "plan-old" } : null,
  };
  globalThis.lucide = { createIcons() {} };
  const controller = {
    model: {
      useServerSidePagination: false,
      state: {
        goithau: [{
          id: packageId,
          keHoachId: "plan-old",
          giaGoiThau: "100",
          hinhThucLuaChon: "Đấu thầu rộng rãi",
        }],
        goithauhanghoa: [],
        thongtinmothau: [],
        hanghoaduthaunhathau: [],
        assignments: [],
      },
      getLatestPackagesForPlan(planId) {
        return this.state.goithau.filter((pkg) => pkg.keHoachId === planId);
      },
    },
    fetchRecordByLookup: async () => null,
    renderBreakdownPackagesList() {},
    updateBreakdownTotal() {},
  };

  try {
    await loadBreakdownPackageDetails.call(controller, "plan-old");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLucide === undefined) delete globalThis.lucide;
    else globalThis.lucide = previousLucide;
  }

  assert.deepEqual(controller.model.state.goithauhanghoa, [{
    id: "goods-old",
    goiThauId: packageId,
    maHangHoa: "HH01",
    referenceOnly: false,
  }]);
});

test("each plan version resolves only its own frozen package snapshot", () => {
  const model = new BiddingModel();
  model.state.kehoach = [
    { id: "plan-v00", rootId: "plan-v00", phienBan: "00", isLatest: 0 },
    { id: "plan-v01", rootId: "plan-v00", phienBan: "01", isLatest: 1 },
  ];
  const historicalPackage = {
    id: "package-plan-v00",
    rootId: "package-root",
    phienBan: "00",
    isLatest: 0,
    keHoachId: "plan-v00",
    tenGoiThau: "Tên cũ",
  };
  const currentPackage = {
    ...historicalPackage,
    id: "package-plan-v01",
    isLatest: 1,
    keHoachId: "plan-v01",
    tenGoiThau: "Tên mới",
  };
  model.state.goithau = [historicalPackage, currentPackage];

  assert.deepEqual(model.getLatestPackagesForPlan("plan-v00"), [historicalPackage]);
  assert.deepEqual(model.getLatestPackagesForPlan("plan-v01"), [currentPackage]);
});

test("plan aggregate remaps rebid ancestry to the inherited canceled package", async () => {
  const { snapshotPlanAggregate } = await import("../../frontend/plans/planAggregateSnapshot.js");
  let sequence = 0;
  const createId = (type) => `${type}-copy-${++sequence}`;
  const canceled = {
    id: "canceled-old",
    rootId: "canceled-root",
    keHoachId: "plan-old",
    phienBan: "00",
    isLatest: 1,
    trangThai: "Hủy thầu",
  };
  const rebid = {
    id: "rebid-old",
    rootId: "rebid-root",
    keHoachId: "plan-old",
    phienBan: "00",
    isLatest: 1,
    isRebid: true,
    rebidFromPackageId: canceled.id,
  };
  const aggregate = snapshotPlanAggregate({
    goithau: [canceled, rebid],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  }, {
    sourcePlanId: "plan-old",
    targetPlanId: "plan-new",
    timestamp: "2026-08-05T10:00:00",
    createId,
  });
  const canceledCopy = aggregate.goithau.find((pkg) => pkg.rootId === canceled.rootId);
  const rebidCopy = aggregate.goithau.find((pkg) => pkg.rootId === rebid.rootId);
  assert.equal(rebidCopy.rebidFromPackageId, canceledCopy.id);
});
