import assert from "node:assert/strict";
import test from "node:test";

import { savePackagePreparation } from "../../frontend/packages/packagePreparation.js";
import { BiddingController } from "../../frontend/app/BiddingController.js";

function buildScenario() {
  // The detail screen can render a lightweight projection of the package, and
  // the goithau-detail route historically did not preload assignments.
  const referenceRow = {
    id: "pkg-00",
    rootId: "pkg-00",
    phienBan: "00",
    isLatest: 1,
    keHoachId: "plan-1",
    maGoiThau: "TBMT-01",
    tenGoiThau: "GT A",
    thoiGianDangTai: "2026-08-01 08:00:00",
    thoiGianDongThau: "2026-08-05 08:00:00",
    referenceOnly: true,
  };
  const authoritativePackage = {
    ...referenceRow,
    referenceOnly: false,
    trangThai: "Đang chấm thầu",
    nhaThauTrungThauId: "contractor-1",
    giaTrungThau: "900000000",
    phanLoList: [],
    timelineItems: [],
    ehsmtAdjustments: [],
  };
  const state = {
    goithau: [referenceRow],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  };
  const serverAssignments = [
    { id: "as-1", targetId: "pkg-00", type: "goithau", empId: "emp-1" },
  ];
  let sequence = 0;
  const controller = {
    model: {
      useServerSidePagination: true,
      state,
      getLatestPlan: () => ({ id: "plan-1" }),
      getCurrentDateTimeString: () => "2026-08-06 10:00:00",
      commitLocalMutation: () => {},
      persistData: async () => {},
      flushMutationOutbox: async () => {},
      normalizeRecordKeys: (record) => record,
    },
    fetchRecordByLookup: async (table, id) => {
      if (table !== "goithau") return null;
      const index = state.goithau.findIndex((row) => row.id === id);
      const full = { ...authoritativePackage };
      if (index >= 0) state.goithau[index] = full;
      else state.goithau.push(full);
      return full;
    },
    autoSync: async () => ({ ok: true }),
  };
  return {
    controller,
    state,
    referenceRow,
    serverAssignments,
    generateRecordId: (type) => `${type}-new-${++sequence}`,
  };
}

test("versioning from the detail screen inherits status and assignees of the stored package", async () => {
  const scenario = buildScenario();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const table = new URL(String(url), "http://localhost").searchParams.get("table");
    const items = table === "assignments" ? scenario.serverAssignments : [];
    return new Response(JSON.stringify({ items, totalItems: items.length, hasMore: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let saved;
  try {
    saved = await savePackagePreparation(
      scenario.controller,
      scenario.referenceRow,
      { thoiGianDongThau: "2026-08-07 08:00:00" },
      { generateRecordId: scenario.generateRecordId },
    );
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }

  assert.equal(saved.phienBan, "01", "a new version must be created");
  assert.equal(
    saved.trangThai,
    "Đang chấm thầu",
    "the status must be inherited instead of falling back to the server default",
  );
  assert.equal(saved.nhaThauTrungThauId, "contractor-1");
  assert.deepEqual(
    scenario.state.assignments
      .filter((assignment) => String(assignment.targetId) === String(saved.id))
      .map((assignment) => assignment.empId),
    ["emp-1"],
    "assignees must follow the new version",
  );
});

test("the package detail route preloads assignments", () => {
  const controller = Object.create(BiddingController.prototype);
  controller.routeMap = { dashboard: "tong-quan", "goithau-detail": "goi-thau-chi-tiet" };

  const keys = controller.getStartupPriorityKeys("/goi-thau-chi-tiet/TBMT-01");

  assert.ok(
    keys.includes("ASSIGNMENTS"),
    "without assignments the detail screen reports every package as unassigned",
  );
});
