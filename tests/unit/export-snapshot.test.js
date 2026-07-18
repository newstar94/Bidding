import assert from "node:assert/strict";
import test from "node:test";

import { prepareExportSnapshot } from "../../frontend/app/BiddingControllerSync.js";
import { appendExportSnapshotVersion } from "../../frontend/shared/exportSnapshot.js";


test("export snapshot URL always includes the committed sync version", () => {
  assert.equal(
    appendExportSnapshotVersion("/api/export-report/gt-1?type=contract", "12"),
    "/api/export-report/gt-1?type=contract&snapshotVersion=12"
  );
  assert.throws(
    () => appendExportSnapshotVersion("/api/export-report/gt-1", "stale"),
    /phiên bản/
  );
});


test("preparing an export flushes pending mutations and returns server version", async () => {
  let syncCalls = 0;
  const controller = {
    model: { buildMutationSyncPayload() {} },
    async autoSync() {
      syncCalls += 1;
      return { ok: true, data: { syncVersion: 23 } };
    }
  };

  const version = await prepareExportSnapshot.call(controller);

  assert.equal(version, "23");
  assert.equal(syncCalls, 1);
});


test("export is blocked when pending mutations conflict", async () => {
  const controller = {
    model: { buildMutationSyncPayload() {} },
    async autoSync() {
      return { ok: false, status: 409, conflict: true };
    }
  };

  await assert.rejects(
    () => prepareExportSnapshot.call(controller),
    /xung đột/
  );
});
