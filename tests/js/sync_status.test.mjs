import assert from "node:assert/strict";
import test from "node:test";

import { deriveSyncStatus } from "../../frontend/app/syncStatus.js";
import {
  getSyncActivitySnapshot,
  shouldShowLocalPending,
} from "../../frontend/app/SyncCoordinator.js";
import { autoSync } from "../../frontend/app/SyncPushService.js";


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

test("auto sync repairs a duplicate pending plan before building its payload", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { organizationId: "org-1" },
      getWorkspaceToken: () => "workspace-1",
      getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
      repairPendingDuplicatePlanVersions: () => {
        calls.push("repair");
        return Promise.resolve({ duplicatePlanIds: ["plan-duplicate"] });
      },
      buildMutationSyncPayload: () => {
        calls.push("build");
        return null;
      },
    },
    autoSync,
    updateSyncState(state) {
      calls.push(state.phase);
    },
  };

  const result = await autoSync.call(controller);

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.deepEqual(calls, ["repair", "build", "idle"]);
});
