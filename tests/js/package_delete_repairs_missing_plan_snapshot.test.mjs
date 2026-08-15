import assert from "node:assert/strict";
import test from "node:test";

import { deleteGoiThau } from "../../frontend/packages/packageLifecycleWorkflow.js";
import { getPackageDeleteContext } from "../../frontend/packages/packageDeleteHelpers.js";

test("legacy plan snapshots with split package roots are deleted as one package", () => {
  const plans = [
    { id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 0 },
    { id: "plan-01", rootId: "plan-root", phienBan: "01", isLatest: 1 },
  ];
  const packages = [
    {
      id: "pkg-plan00", rootId: "pkg-plan00", keHoachId: "plan-00",
      tenGoiThau: "Gói thầu MS", maGoiThau: "",
    },
    {
      id: "pkg-plan01", rootId: "pkg-plan01", keHoachId: "plan-01",
      tenGoiThau: "Gói thầu MS", maGoiThau: "IB2600444548",
    },
  ];

  const context = getPackageDeleteContext(packages, "pkg-plan01", plans);

  assert.deepEqual(new Set(context.relatedIds), new Set([
    "pkg-plan00", "pkg-plan01",
  ]));
  assert.deepEqual(new Set(context.planIds), new Set(["plan-00", "plan-01"]));
});

test("deleting -02 removes its complete package family instead of repairing history", async () => {
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
      customVersionDeleteChoice: async () => assert.fail(
        "package deletion must not offer a latest-version-only choice",
      ),
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

  assert.deepEqual(deleted, [
    "goithau:pkg-v01-plan00",
    "goithau:pkg-v02-plan01",
  ]);
  assert.deepEqual(model.state.goithau, []);
});

test("deleting a package from the newest plan removes its snapshots from every plan version", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };

  const historical = {
    id: "pkg-v00-plan00",
    rootId: "pkg-root",
    phienBan: "00",
    isLatest: 1,
    keHoachId: "plan-00",
    maGoiThau: "GT-01",
    tenGoiThau: "Gói thầu kiểm thử",
    phanLoList: [],
  };
  const current = {
    ...historical,
    id: "pkg-v00-plan01",
    keHoachId: "plan-01",
  };
  const deleted = [];
  const persisted = [];
  const state = {
    goithau: [historical, current],
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
    persistChanges: async (table, changes) => {
      persisted.push({ table, changes });
    },
    flushMutationOutbox: async () => {},
  };
  const controller = {
    model,
    view: {
      customVersionDeleteChoice: async () => assert.fail(
        "package deletion must not offer a latest-version-only choice",
      ),
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
    await deleteGoiThau.call(controller, current.id);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(deleted, [
    "goithau:pkg-v00-plan00",
    "goithau:pkg-v00-plan01",
  ]);
  assert.deepEqual(model.state.goithau, [], "no historical snapshot may reappear");
  const planMutation = persisted.find((mutation) => mutation.table === "kehoach");
  assert.deepEqual(
    planMutation?.changes?.upserts?.map((plan) => plan.id),
    ["plan-01"],
    "deletion may recalculate only the latest plan; historical plans stay frozen",
  );
});

test("paginated package deletion hydrates and removes snapshots from older plan versions", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = { getElementById: () => null };

  const historical = {
    id: "pkg-plan00", rootId: "pkg-root", phienBan: "00", isLatest: 1,
    keHoachId: "plan-00", tenGoiThau: "Goi thau",
  };
  const current = {
    ...historical, id: "pkg-plan01", keHoachId: "plan-01",
  };
  const requestedPlans = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url), "http://localhost");
    const table = parsed.searchParams.get("table");
    const planId = parsed.searchParams.get("keHoachId");
    if (table === "goithau") requestedPlans.push(planId);
    const items = table === "goithau"
      ? (planId === "plan-00" ? [historical] : [current])
      : [];
    return new Response(JSON.stringify({
      items, totalItems: items.length, hasMore: false, nextCursor: null,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const deleted = [];
  const latestPlan = {
    id: "plan-01", rootId: "plan-root", phienBan: "01", isLatest: 1,
    allVersions: [
      { id: "plan-01", phienBan: "01" },
      { id: "plan-00", phienBan: "00" },
    ],
  };
  const model = {
    useServerSidePagination: true,
    state: {
      goithau: [current], kehoach: [latestPlan], thongtinmothau: [],
    },
    normalizeRecordKeys: (record) => record,
    markDeleted(table, records) {
      for (const record of Array.isArray(records) ? records : [records]) {
        deleted.push(`${table}:${record?.id ?? record}`);
      }
    },
    persistData: async () => {},
    persistChanges: async () => {},
    flushMutationOutbox: async () => {},
  };
  const controller = {
    model,
    view: {
      customVersionDeleteChoice: async () => assert.fail(
        "package deletion must not offer a latest-version-only choice",
      ),
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
    await deleteGoiThau.call(controller, current.id);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }

  assert.deepEqual(new Set(requestedPlans), new Set(["plan-00", "plan-01"]));
  assert.deepEqual(new Set(deleted), new Set([
    "goithau:pkg-plan00", "goithau:pkg-plan01",
  ]));
  assert.deepEqual(model.state.goithau, []);
});
