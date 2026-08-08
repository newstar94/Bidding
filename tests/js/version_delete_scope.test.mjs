import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteLatestPackageVersion,
  getPackageDeleteContext,
} from "../../frontend/packages/packageDeleteHelpers.js";
import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { deleteHopDong } from "../../frontend/contracts/HopDongWorkflow.js";
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

function fakeModel(goithau) {
  const deleted = [];
  return {
    deleted,
    state: { goithau: goithau.map((row) => ({ ...row })), thongtinmothau: [] },
    markDeleted(table, records) {
      (Array.isArray(records) ? records : [records]).forEach((record) => {
        deleted.push(`${table}:${record?.id ?? record}`);
      });
    },
  };
}

test("deleting the latest package version keeps snapshots owned by other plan versions", () => {
  // Creating a plan version freezes a package snapshot that keeps the same
  // phienBan under the new plan. Deleting "the latest version" of the snapshot
  // must not remove the sibling rows of the previous plan version.
  const model = fakeModel([
    { id: "pkg-v00", rootId: "pkg-v00", phienBan: "00", isLatest: 0, keHoachId: "plan-00" },
    { id: "pkg-v01", rootId: "pkg-v00", phienBan: "01", isLatest: 1, keHoachId: "plan-00" },
    { id: "pkg-v01-snap", rootId: "pkg-v00", phienBan: "01", isLatest: 1, keHoachId: "plan-01" },
  ]);

  const context = getPackageDeleteContext(model.state.goithau, "pkg-v01-snap");
  deleteLatestPackageVersion(model, context);

  assert.deepEqual(model.deleted, ["goithau:pkg-v01-snap"]);
  assert.deepEqual(
    model.state.goithau.map((pkg) => pkg.id),
    ["pkg-v00", "pkg-v01"],
    "packages of the other plan version must survive",
  );
});

test("a single-version package snapshot is never wiped by the latest-version delete", () => {
  // A plan version whose package was inherited unchanged: one phienBan, two
  // plan scopes. Deleting the latest version of one scope leaves the other.
  const model = fakeModel([
    { id: "pkg-a", rootId: "pkg-a", phienBan: "00", isLatest: 0, keHoachId: "plan-00" },
    { id: "pkg-a-snap", rootId: "pkg-a", phienBan: "00", isLatest: 1, keHoachId: "plan-01" },
  ]);

  const context = getPackageDeleteContext(model.state.goithau, "pkg-a-snap");
  deleteLatestPackageVersion(model, context);

  assert.deepEqual(model.deleted, ["goithau:pkg-a-snap"]);
  assert.deepEqual(model.state.goithau.map((pkg) => pkg.id), ["pkg-a"]);
});

test("deleting the latest package version in one plan still promotes the previous one", () => {
  const model = fakeModel([
    { id: "pkg-v00", rootId: "pkg-v00", phienBan: "00", isLatest: 0, keHoachId: "plan-00" },
    { id: "pkg-v01", rootId: "pkg-v00", phienBan: "01", isLatest: 1, keHoachId: "plan-00" },
  ]);

  const context = getPackageDeleteContext(model.state.goithau, "pkg-v01");
  deleteLatestPackageVersion(model, context);

  assert.deepEqual(model.state.goithau.map((pkg) => pkg.id), ["pkg-v00"]);
  assert.equal(model.state.goithau[0].isLatest, 1, "the previous version becomes latest");
});

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
