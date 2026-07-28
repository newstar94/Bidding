import assert from "node:assert/strict";
import test from "node:test";

import { saveQualifiedApproval } from "../../frontend/packages/packageEvaluationProgress.js";

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

  assert.deepEqual(JSON.parse(controller.model.state.goithau[0].danhGiaHsdtMetadata), metadata);
  assert.deepEqual(events.map(([name]) => name), ["update", "persist", "flush", "sync"]);
  assert.equal(saved, controller.model.state.goithau[0]);
});
