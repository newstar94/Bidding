import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { deleteHopDong } from "../../frontend/contracts/HopDongWorkflow.js";
import { deleteChuyenGia } from "../../frontend/experts/ChuyenGiaWorkflow.js";
import { deleteKeHoach } from "../../frontend/plans/KeHoachWorkflow.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    readJson(key, fallback) {
      return structuredClone(values.get(key) ?? fallback);
    },
    writeJson(key, value) {
      values.set(key, structuredClone(value));
    },
  };
}

test("deleting the latest plan version is blocked by packages known only to the server", async () => {
  const planV00 = { id: "plan-00", rootId: "plan-00", phienBan: "00", isLatest: 0, tenKeHoach: "KH" };
  const planV01 = { id: "plan-01", rootId: "plan-00", phienBan: "01", isLatest: 1, tenKeHoach: "KH" };
  const packagesByPlan = {
    "plan-00": [{ id: "pkg-a", rootId: "pkg-a", phienBan: "00", isLatest: 0, keHoachId: "plan-00" }],
    "plan-01": [{ id: "pkg-a-snap", rootId: "pkg-a", phienBan: "00", isLatest: 1, keHoachId: "plan-01" }],
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const planId = new URL(String(url), "http://localhost").searchParams.get("keHoachId");
    const items = packagesByPlan[planId] || [];
    return new Response(JSON.stringify({ items, totalItems: items.length, hasMore: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let alertTitle = null;
  let markDeletedCalled = false;
  const controller = {
    model: {
      useServerSidePagination: true,
      // Local state is missing the package frozen under the newest plan version.
      state: { kehoach: [planV00, planV01], goithau: [...packagesByPlan["plan-00"]] },
      markDeleted() { markDeletedCalled = true; },
      persistData: async () => {},
      flushMutationOutbox: async () => {},
      normalizeRecordKeys: (record) => record,
    },
    view: {
      customVersionDeleteChoice: async () => 1,
      customAlert: async (title) => { alertTitle = title; },
      renderKeHoachTable: async () => {},
    },
    fetchRecordByLookup: async () => planV01,
    autoSync: async () => ({ ok: true }),
  };

  try {
    await deleteKeHoach.call(controller, "plan-01");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }

  assert.equal(alertTitle, "Không thể xóa");
  assert.equal(markDeletedCalled, false, "no plan version may be deleted while packages reference it");
  assert.deepEqual(controller.model.state.kehoach.map((plan) => plan.id), ["plan-00", "plan-01"]);
});

test("deleting a contract retains the server row version after removing its local projection", async () => {
  const contract = {
    id: "contract-01",
    rootId: "contract-01",
    rowVersion: 12,
    tenHopDong: "Contract with version",
  };
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org", organizationId: "org" };
  model.workspaceStorage = memoryStorage();
  model.db = {
    stores: ["hopdong"],
    async get() { return null; },
    async set() {},
  };
  model.state.hopdong = [contract];
  model.persistChanges = async () => {};

  const controller = {
    model,
    view: {
      customConfirm: async () => true,
      renderHopDongTable: async () => {},
    },
    fetchRecordByLookup: async () => contract,
    autoSync: async () => ({ ok: true }),
  };

  await deleteHopDong.call(controller, contract.id);

  assert.deepEqual(model.buildMutationSyncPayload()?.payload.deletions, [{
    table: "hopdong",
    id: contract.id,
    expectedVersion: 12,
  }]);
});

test("deleting an expert uses the authoritative refreshed row version", async () => {
  const staleHistoricalExpert = {
    id: "expert-00",
    rootId: "expert-00",
    phienBan: "00",
    isLatest: 0,
    rowVersion: 1,
    hoTen: "Historical expert with stale local version",
  };
  const staleExpert = {
    id: "expert-01",
    rootId: "expert-00",
    phienBan: "01",
    isLatest: 1,
    rowVersion: 1,
    hoTen: "Expert with stale local version",
  };
  const authoritativeHistoricalExpert = {
    ...staleHistoricalExpert,
    rowVersion: 2,
  };
  const authoritativeExpert = {
    ...staleExpert,
    allVersions: [
      { id: staleExpert.id, phienBan: 1 },
      { id: staleHistoricalExpert.id, phienBan: 0 },
    ],
  };
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org", organizationId: "org" };
  model.workspaceStorage = memoryStorage();
  model.db = {
    stores: ["chuyengia"],
    async get() { return null; },
    async set() {},
  };
  model.state.activerole = "manager";
  model.state.chuyengia = [staleHistoricalExpert, staleExpert];
  model.state.goithau = [];
  model.persistChanges = async () => {};

  const controller = {
    model,
    view: {
      customConfirm: async () => true,
      customVersionDeleteChoice: async () => 2,
      renderChuyenGiaTable: async () => {},
    },
    // The mutation seam must consume this returned authority directly instead
    // of relying on an incidental state mutation by the concrete fetcher.
    fetchRecordByLookup: async (_table, id) => (
      id === staleHistoricalExpert.id
        ? authoritativeHistoricalExpert
        : authoritativeExpert
    ),
    autoSync: async () => ({ ok: true }),
  };

  await deleteChuyenGia.call(controller, staleExpert.id);

  assert.deepEqual(model.buildMutationSyncPayload()?.payload.deletions, [{
    table: "chuyengia",
    id: staleHistoricalExpert.id,
    expectedVersion: 2,
  }, {
    table: "chuyengia",
    id: staleExpert.id,
    expectedVersion: 1,
  }]);
});
