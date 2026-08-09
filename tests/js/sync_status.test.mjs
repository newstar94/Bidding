import assert from "node:assert/strict";
import test from "node:test";

import { deriveSyncStatus } from "../../frontend/app/syncStatus.js";
import {
  getSyncActivitySnapshot,
  shouldShowLocalPending,
} from "../../frontend/app/SyncCoordinator.js";


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


test("sync activity is settled only after queued work and outbox durability finish", () => {
  const controller = {
    _autoSyncPromise: null,
    _syncImmediateTimer: null,
    _autoSyncQueued: false,
    _deferImmediateSync: false,
    _pendingMutationCount: 1,
    _syncUxState: { phase: "transportError" },
    model: {
      buildMutationSyncPayload: () => ({ payload: { upserts: [{}] } }),
      getMutationOutboxStatus: () => ({ state: "ready" }),
    },
  };

  assert.deepEqual(getSyncActivitySnapshot(controller), {
    settled: true,
    phase: "transportError",
    hasPendingMutations: true,
  });

  for (const activeState of [
    { _autoSyncPromise: Promise.resolve() },
    { _syncImmediateTimer: 1 },
    { _autoSyncQueued: true },
    { _deferImmediateSync: true },
  ]) {
    assert.equal(
      getSyncActivitySnapshot({ ...controller, ...activeState }).settled,
      false,
    );
  }

  assert.equal(getSyncActivitySnapshot({
    ...controller,
    model: {
      ...controller.model,
      getMutationOutboxStatus: () => ({ state: "pending" }),
    },
  }).settled, false);

  assert.equal(getSyncActivitySnapshot({
    ...controller,
    model: {
      ...controller.model,
      _workspaceMutations: new Set([{}]),
    },
  }).settled, false);
});
