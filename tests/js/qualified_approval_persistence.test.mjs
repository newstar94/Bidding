import assert from "node:assert/strict";
import test from "node:test";

import {
  commitPackageAwardDependencies,
  saveQualifiedApproval,
} from "../../frontend/packages/packageEvaluationProgress.js";

test("qualified approval stages a detached package before persisting and syncing", async () => {
  const canonicalPackage = {
    id: "pkg-1",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: false },
      financial: { saved: false },
    }),
  };
  const detachedPackage = { ...canonicalPackage };
  const metadata = {
    is1G2T: true,
    technical: { saved: true, qualifiedSaved: true, soQdPheDuyetKt: "01/QD" },
    financial: { saved: false },
  };
  const events = [];
  const controller = {
    model: {
      state: { goithau: [canonicalPackage] },
      async updateRecord(table, record) {
        events.push(["update", table, record.id]);
        this.state[table] = this.state[table].map((item) => (
          String(item.id) === String(record.id) ? { ...record } : item
        ));
      },
      async persistData(table) {
        events.push(["persist", table]);
        this.state[table] = this.state[table].map((item) => ({ ...item }));
      },
      async flushMutationOutbox() {
        events.push(["flush"]);
      },
    },
    async autoSync() {
      events.push(["sync", this.model.state.goithau[0].danhGiaHsdtMetadata]);
      return { ok: true };
    },
  };

  const saved = await saveQualifiedApproval(controller, detachedPackage, metadata);

  assert.deepEqual(JSON.parse(controller.model.state.goithau[0].danhGiaHsdtMetadata), {
    ...metadata,
    schemaVersion: 1,
  });
  assert.deepEqual(events.map(([name]) => name), ["update", "persist", "flush", "sync"]);
  assert.equal(saved, controller.model.state.goithau[0]);
});


test("award dependencies do not restage existing contractors", async () => {
  const persisted = [];
  const contractor = { id: "contractor-new", tenNhaThau: "Nhà thầu mới" };
  const bid = { id: "bid-new", goiThauId: "pkg-1", nhaThauId: contractor.id };
  const controller = {
    model: {
      state: {
        goithau: [{ id: "pkg-1" }],
        nhathau: [contractor],
        thongtinmothau: [bid],
      },
      commitLocalMutation() {},
      async persistChanges(table, changes) {
        persisted.push({ table, changes });
      },
      async flushMutationOutbox() {},
    },
    async autoSync() { return { ok: true }; },
  };

  await commitPackageAwardDependencies(controller, {
    packageRecord: { id: "pkg-1" },
  });

  assert.deepEqual(persisted, [
    { table: "thongtinmothau", changes: { upserts: [bid], deletions: [] } },
  ]);
});


test("direct-award dependencies explicitly persist a newly created contractor", async () => {
  const persisted = [];
  const contractor = { id: "contractor-new", tenNhaThau: "Nhà thầu mới" };
  const bid = { id: "bid-new", goiThauId: "pkg-1", nhaThauId: contractor.id };
  const controller = {
    model: {
      state: {
        goithau: [{ id: "pkg-1" }],
        nhathau: [contractor],
        thongtinmothau: [bid],
      },
      commitLocalMutation() {},
      async persistChanges(table, changes) { persisted.push({ table, changes }); },
      async flushMutationOutbox() {},
    },
    async autoSync() { return { ok: true }; },
  };

  await commitPackageAwardDependencies(controller, {
    contractorRecords: [contractor],
    packageRecord: { id: "pkg-1" },
  });

  assert.deepEqual(persisted, [
    { table: "nhathau", changes: { upserts: [contractor], deletions: [] } },
    { table: "thongtinmothau", changes: { upserts: [bid], deletions: [] } },
  ]);
});
