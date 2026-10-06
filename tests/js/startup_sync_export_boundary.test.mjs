import assert from "node:assert/strict";
import test from "node:test";

import { autoSync } from "../../frontend/app/SyncPushService.js";

test("a settled startup barrier continues the normal export sync path", async () => {
  const startupPromise = Promise.resolve();
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: () => true,
      buildMutationSyncPayload: () => null,
      hasPendingMutationOutboxChanges: () => false,
      state: { activerole: "manager" },
    },
    _startupReconciliationPromise: startupPromise,
    updateSyncState() {},
    getStartupReconciliationState() {
      // Model the cleanup callback that runs immediately after the barrier
      // settles, before the normal flush is allowed to inspect local state.
      this._startupReconciliationPromise = null;
      return { phase: "RECONCILED" };
    },
    autoSync,
  };

  const result = await controller.autoSync();

  assert.deepEqual(result, { ok: true, skipped: true });
});
