import assert from "node:assert/strict";
import test from "node:test";

import { deleteGoiThau } from "../../frontend/packages/packageLifecycleWorkflow.js";

test("deleting -02 repairs a missing -01 snapshot inside the current plan", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };

  const source = {
    id: "pkg-v01-plan00",
    rootId: "pkg-root",
    phienBan: "01",
    isLatest: 1,
    keHoachId: "plan-00",
    maGoiThau: "GT-01",
    tenGoiThau: "Gói thầu kiểm thử",
    trangThai: "Đang chấm thầu",
    phanLoList: [],
  };
  const target = {
    ...source,
    id: "pkg-v02-plan01",
    phienBan: "02",
    keHoachId: "plan-01",
    thoiGianDongThau: "2026-08-10 09:00:00",
  };
  const deleted = [];
  const state = {
    goithau: [source, target],
    kehoach: [
      { id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 0 },
      { id: "plan-01", rootId: "plan-root", phienBan: "01", isLatest: 1 },
    ],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  };
  const model = {
    useServerSidePagination: false,
    state,
    getCurrentDateTimeString: () => "2026-08-07 14:00:00",
    markDeleted(table, records) {
      for (const record of Array.isArray(records) ? records : [records]) {
        deleted.push(`${table}:${record?.id ?? record}`);
      }
    },
    persistData: async () => {},
    flushMutationOutbox: async () => {},
  };
  const controller = {
    model,
    view: {
      customVersionDeleteChoice: async () => 1,
      customConfirm: async () => true,
      customAlert: async () => {},
      renderGoiThauTable: async () => {},
      renderKeHoachTable: async () => {},
    },
    fetchRecordByLookup: async (table, id) => (
      model.state[table]?.find((record) => String(record.id) === String(id)) || null
    ),
    recalculatePlanTotal() {},
    renderBreakdownPackagesList() {},
    updateBreakdownTotal() {},
    autoSync: async () => ({ ok: true }),
  };

  try {
    await deleteGoiThau.call(controller, target.id);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(deleted, ["goithau:pkg-v02-plan01"]);
  assert.equal(
    model.state.goithau.some((pkg) => pkg.id === target.id),
    false,
    "-02 must be deleted",
  );
  const restored = model.state.goithau.find((pkg) => (
    pkg.rootId === "pkg-root"
    && pkg.keHoachId === "plan-01"
    && pkg.phienBan === "01"
  ));
  assert.ok(restored, "the current plan must receive a repaired -01 snapshot");
  assert.equal(restored.isLatest, 1, "the repaired -01 becomes current after -02 is deleted");
  assert.equal(restored.trangThai, source.trangThai, "business state must be inherited from the predecessor");
});
