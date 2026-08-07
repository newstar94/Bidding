import assert from "node:assert/strict";
import test from "node:test";

import { restoreRecordSnapshot } from "../../frontend/shared/recordSnapshot.js";
import { getNextVersion } from "../../frontend/shared/VersionedEntityService.js";
import { savePlanBreakdown } from "../../frontend/plans/KeHoachWorkflow.js";

test("restoring a form snapshot keeps the row version owned by the server", () => {
  const live = [{ id: "plan-1", tenKeHoach: "Tên mới", rowVersion: 4, syncVersion: 12 }];
  const snapshot = [{ id: "plan-1", tenKeHoach: "Tên cũ", rowVersion: 1, syncVersion: 7 }];

  const restored = restoreRecordSnapshot(live, snapshot);

  assert.equal(restored[0].tenKeHoach, "Tên cũ", "business fields come from the snapshot");
  assert.equal(restored[0].rowVersion, 4, "row version must follow the live server value");
  assert.equal(restored[0].syncVersion, 12);
});

test("restoring a snapshot keeps the captured version for a record that is no longer live", () => {
  // A record missing from live state was never touched by the sibling save, so
  // the version captured in the snapshot is still the server version.
  const restored = restoreRecordSnapshot([], [{ id: "plan-1", rowVersion: 3 }]);

  assert.equal(restored[0].rowVersion, 3);
});

test("restoring a snapshot does not share nested references with the snapshot", () => {
  const snapshot = [{ id: "plan-1", cvDaThucHienList: [{ tenCongViec: "A" }] }];

  const restored = restoreRecordSnapshot([{ id: "plan-1" }], snapshot);
  restored[0].cvDaThucHienList[0].tenCongViec = "B";

  assert.equal(snapshot[0].cvDaThucHienList[0].tenCongViec, "A");
});

test("restoring a snapshot keeps records the server committed after it was captured", () => {
  const snapshot = [{ id: "pkg-00", rootId: "pkg-00", phienBan: "00", rowVersion: 3 }];
  const live = [
    { id: "pkg-00", rootId: "pkg-00", phienBan: "00", rowVersion: 3, isLatest: 0 },
    { id: "pkg-01", rootId: "pkg-00", phienBan: "01", rowVersion: 1, isLatest: 1 },
  ];

  const restored = restoreRecordSnapshot(live, snapshot);

  assert.deepEqual(restored.map((record) => record.phienBan), ["00", "01"]);
  assert.equal(
    getNextVersion(restored, restored[0]),
    "02",
    "the next version must not collide with a version already stored on the server",
  );
});

test("restoring a snapshot still discards uncommitted records created by the cancelled form", () => {
  const snapshot = [{ id: "pkg-00", rowVersion: 3 }];
  const live = [
    { id: "pkg-00", rowVersion: 3 },
    { id: "pkg-draft", tenGoiThau: "Nháp chưa đồng bộ" },
  ];

  const restored = restoreRecordSnapshot(live, snapshot);

  assert.deepEqual(restored.map((record) => record.id), ["pkg-00"]);
});

test("restoring a snapshot lets the server keep ownership of the latest-version flag", () => {
  const snapshot = [{ id: "pkg-00", rootId: "pkg-00", isLatest: 1, rowVersion: 3 }];
  const live = [{ id: "pkg-00", rootId: "pkg-00", isLatest: 0, rowVersion: 3 }];

  const restored = restoreRecordSnapshot(live, snapshot);

  assert.equal(restored[0].isLatest, 0);
});

test("saving a new plan version keeps the row version committed by a package saved in the same modal", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === "breakdown-plan-id" ? { value: "plan-v00" } : null),
  };

  // The package form inside the breakdown modal already synced, so the server
  // bumped the row version of both the package and its plan.
  const stalePlan = {
    id: "plan-v00",
    rootId: "plan-v00",
    phienBan: "00",
    isLatest: 1,
    thoiGianDangMa: "2026-08-01T08:00",
    tongMucDauTu: 0,
    rowVersion: 1,
  };
  const livePlan = { ...stalePlan, tongMucDauTu: 500, rowVersion: 2 };
  const linkedPackage = {
    id: "package-v00",
    rootId: "package-v00",
    phienBan: "00",
    isLatest: 1,
    keHoachId: stalePlan.id,
    giaGoiThau: 500,
    rowVersion: 2,
  };

  const controller = {
    tempPlanAction: "edit",
    tempPlanData: { ...stalePlan, thoiGianDangMa: "2026-08-02T08:00" },
    backupKeHoachState: [structuredClone(stalePlan)],
    backupGoiThauState: [structuredClone({ ...linkedPackage, rowVersion: 1 })],
    model: {
      state: {
        kehoach: [structuredClone(livePlan)],
        goithau: [structuredClone(linkedPackage)],
        assignments: [],
        activeuser: { id: "employee-1" },
      },
      getCurrentDateTimeString: () => "2026-08-05T10:00",
      persistData: async () => {},
      flushMutationOutbox: async () => {},
      addRecord: async () => {},
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

  const historicalPlan = controller.model.state.kehoach.find((plan) => plan.id === stalePlan.id);
  const newPlanVersion = controller.model.state.kehoach.find((plan) => plan.id !== stalePlan.id);

  assert.equal(
    historicalPlan.rowVersion,
    2,
    "the superseded plan must keep the row version the server already committed",
  );
  assert.equal(historicalPlan.isLatest, 0);
  assert.equal(newPlanVersion.isLatest, 1);
  assert.equal("rowVersion" in newPlanVersion, false, "a brand new version has no server version yet");

  const inheritedPackage = controller.model.state.goithau.find((pkg) => pkg.id !== linkedPackage.id);
  const historicalPackage = controller.model.state.goithau.find((pkg) => pkg.id === linkedPackage.id);
  assert.equal(historicalPackage.rowVersion, 2, "package row versions stay untouched by the plan snapshot");
  assert.equal("rowVersion" in inheritedPackage, false);
});
