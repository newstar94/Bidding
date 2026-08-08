import assert from "node:assert/strict";
import test from "node:test";

import { deriveSyncStatus } from "../../frontend/app/syncStatus.js";
import { shouldShowLocalPending } from "../../frontend/app/SyncCoordinator.js";


test("sync status distinguishes durable, pending, validation, transport, and offline states", () => {
  assert.equal(deriveSyncStatus({ phase: "serverSaved", lastSyncedAt: 1 }).state, "server-saved");
  assert.deepEqual(deriveSyncStatus({ phase: "localPending" }), {
    state: "local-pending",
    label: "Đã lưu cục bộ · Chờ đồng bộ",
    assertive: false,
  });
  assert.equal(deriveSyncStatus({ phase: "validationRejected" }).state, "validation-rejected");
  assert.equal(deriveSyncStatus({ phase: "transportError" }).state, "transport-error");
  assert.equal(deriveSyncStatus({ phase: "serverSaved", online: false }).state, "offline");
});


test("pending-count notifications do not erase actionable sync failures", () => {
  for (const phase of [
    "transportError",
    "conflict",
    "validationRejected",
    "storageError",
    "error",
  ]) {
    assert.equal(shouldShowLocalPending(phase), false, phase);
  }
  assert.equal(shouldShowLocalPending("idle"), true);
  assert.equal(shouldShowLocalPending("serverSaved"), true);
});
