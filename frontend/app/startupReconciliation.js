import {
  reportOutboxRetry,
  reportStartupReconciliationFailure,
} from "../shared/releaseDiagnostics.js";

export const STARTUP_RECONCILIATION_PHASE = Object.freeze({
  LOCAL_READY: "LOCAL_READY",
  RECONCILING: "RECONCILING",
  RECONCILED: "RECONCILED",
  OFFLINE_LOCAL: "OFFLINE_LOCAL",
  SYNC_ERROR: "SYNC_ERROR",
  CONFLICT: "CONFLICT",
});

const STARTUP_TRANSITIONS = Object.freeze({
  [STARTUP_RECONCILIATION_PHASE.LOCAL_READY]: new Set([
    STARTUP_RECONCILIATION_PHASE.LOCAL_READY,
    STARTUP_RECONCILIATION_PHASE.RECONCILING,
    STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL,
  ]),
  [STARTUP_RECONCILIATION_PHASE.RECONCILING]: new Set([
    STARTUP_RECONCILIATION_PHASE.RECONCILING,
    STARTUP_RECONCILIATION_PHASE.RECONCILED,
    STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL,
    STARTUP_RECONCILIATION_PHASE.SYNC_ERROR,
    STARTUP_RECONCILIATION_PHASE.CONFLICT,
  ]),
  [STARTUP_RECONCILIATION_PHASE.RECONCILED]: new Set([
    STARTUP_RECONCILIATION_PHASE.RECONCILED,
    STARTUP_RECONCILIATION_PHASE.RECONCILING,
    STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL,
  ]),
  [STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL]: new Set([
    STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL,
    STARTUP_RECONCILIATION_PHASE.LOCAL_READY,
    STARTUP_RECONCILIATION_PHASE.RECONCILING,
  ]),
  [STARTUP_RECONCILIATION_PHASE.SYNC_ERROR]: new Set([
    STARTUP_RECONCILIATION_PHASE.SYNC_ERROR,
    STARTUP_RECONCILIATION_PHASE.RECONCILING,
    STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL,
  ]),
  [STARTUP_RECONCILIATION_PHASE.CONFLICT]: new Set([
    STARTUP_RECONCILIATION_PHASE.CONFLICT,
    STARTUP_RECONCILIATION_PHASE.RECONCILING,
  ]),
});

const ACTIONABLE_SYNC_UX_PHASES = new Set([
  "conflict",
  "error",
  "storageError",
  "transportError",
  "validationRejected",
]);

function currentWorkspaceToken(controller) {
  return String(
    controller?.model?.getWorkspaceToken?.()
      || controller?.model?.workspaceScope?.key
      || "",
  );
}

function isCurrentWorkspace(controller, workspaceToken) {
  if (!workspaceToken) return currentWorkspaceToken(controller) === "";
  if (typeof controller?.model?.isWorkspaceCurrent === "function") {
    return controller.model.isWorkspaceCurrent(workspaceToken);
  }
  return currentWorkspaceToken(controller) === workspaceToken;
}

function isTransportFailure(result) {
  const error = result?.error || result;
  const code = String(error?.code || "").toUpperCase();
  return Boolean(
    result?.transport
      || error?.name === "TypeError"
      || [
        "ECONNABORTED",
        "ECONNREFUSED",
        "ECONNRESET",
        "ENETDOWN",
        "ENETUNREACH",
        "ETIMEDOUT",
        "NETWORK_ERROR",
      ].includes(code),
  );
}

function syncUxPatchForPhase(phase, error = null) {
  if (phase === STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL) {
    return { online: false };
  }
  if (phase === STARTUP_RECONCILIATION_PHASE.CONFLICT) {
    return { phase: "conflict", online: true };
  }
  if (phase === STARTUP_RECONCILIATION_PHASE.SYNC_ERROR) {
    return {
      phase: "error",
      online: true,
      message: error?.message || "Lỗi đồng bộ dữ liệu ban đầu",
    };
  }
  return null;
}

export function getStartupReconciliationState(controller) {
  const state = controller?._startupReconciliationState;
  const workspaceToken = currentWorkspaceToken(controller);
  if (state?.workspaceToken === workspaceToken) return state;
  return {
    phase: globalThis.navigator?.onLine === false
      ? STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL
      : STARTUP_RECONCILIATION_PHASE.LOCAL_READY,
    workspaceToken,
    error: null,
    outboxGeneration: Number(controller?.model?.getMutationOutboxGeneration?.() || 0),
    promise: null,
  };
}

export function transitionStartupReconciliation(
  controller,
  phase,
  { error = null, promise = null, workspaceToken = currentWorkspaceToken(controller) } = {},
) {
  if (!controller || !isCurrentWorkspace(controller, workspaceToken)) return false;
  const previous = getStartupReconciliationState(controller);
  if (!STARTUP_TRANSITIONS[previous.phase]?.has(phase)) {
    const transitionError = new Error(
      `Invalid startup reconciliation transition: ${previous.phase} -> ${phase}`,
    );
    transitionError.code = "INVALID_STARTUP_RECONCILIATION_TRANSITION";
    throw transitionError;
  }
  const state = {
    ...previous,
    phase,
    workspaceToken,
    error,
    promise,
  };
  controller._startupReconciliationState = state;
  const uxPatch = syncUxPatchForPhase(phase, error);
  const preserveActionableFailure = phase === STARTUP_RECONCILIATION_PHASE.SYNC_ERROR
    && ACTIONABLE_SYNC_UX_PHASES.has(String(controller._syncUxState?.phase || ""));
  if (uxPatch && !preserveActionableFailure) controller.updateSyncState?.(uxPatch);
  return state;
}

export function initializeStartupReconciliation(controller) {
  if (!controller) return false;
  const workspaceToken = currentWorkspaceToken(controller);
  const phase = globalThis.navigator?.onLine === false
    ? STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL
    : STARTUP_RECONCILIATION_PHASE.LOCAL_READY;
  const state = {
    phase,
    workspaceToken,
    error: null,
    outboxGeneration: Number(controller?.model?.getMutationOutboxGeneration?.() || 0),
    promise: null,
  };
  controller._startupReconciliationState = state;
  const uxPatch = syncUxPatchForPhase(phase);
  if (uxPatch) controller.updateSyncState?.(uxPatch);
  return state;
}

export function completeStartupReconciliation(controller, result, workspaceToken) {
  if (!isCurrentWorkspace(controller, workspaceToken)) return false;
  if (result?.ok) {
    return transitionStartupReconciliation(
      controller,
      STARTUP_RECONCILIATION_PHASE.RECONCILED,
      { workspaceToken },
    );
  }
  if (result?.conflict || result?.status === 409) {
    return transitionStartupReconciliation(
      controller,
      STARTUP_RECONCILIATION_PHASE.CONFLICT,
      { error: result?.error || null, workspaceToken },
    );
  }
  const offline = globalThis.navigator?.onLine === false;
  return transitionStartupReconciliation(
    controller,
    offline
      ? STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL
      : STARTUP_RECONCILIATION_PHASE.SYNC_ERROR,
    { error: result?.error || null, workspaceToken },
  );
}

function mutationBoundaryError(state) {
  const error = new Error(
    state.phase === STARTUP_RECONCILIATION_PHASE.CONFLICT
      ? "Startup reconciliation has an unresolved conflict"
      : "Authoritative startup reconciliation is required before this mutation",
  );
  error.code = state.phase === STARTUP_RECONCILIATION_PHASE.CONFLICT
    ? "STARTUP_RECONCILIATION_CONFLICT"
    : "STARTUP_RECONCILIATION_REQUIRED";
  error.cause = state.error || undefined;
  return error;
}

export async function awaitAuthoritativeMutationBoundary(controller) {
  let state = getStartupReconciliationState(controller);
  if (globalThis.navigator?.onLine === false) {
    transitionStartupReconciliation(
      controller,
      STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL,
      { workspaceToken: state.workspaceToken },
    );
    return { authoritative: false, offline: true };
  }
  if (state.phase === STARTUP_RECONCILIATION_PHASE.RECONCILED) {
    return { authoritative: true, offline: false };
  }

  const workspaceToken = state.workspaceToken;
  let reconciliation = state.promise || controller?._startupReconciliationPromise;
  if (!reconciliation && typeof controller?.reconcileInitialRouteData === "function") {
    reconciliation = controller.reconcileInitialRouteData();
  }
  if (reconciliation) await reconciliation;
  if (!isCurrentWorkspace(controller, workspaceToken)) {
    const error = new Error("Workspace changed while awaiting startup reconciliation");
    error.name = "AbortError";
    error.code = "WORKSPACE_CHANGED";
    throw error;
  }

  state = getStartupReconciliationState(controller);
  if (state.phase === STARTUP_RECONCILIATION_PHASE.RECONCILED) {
    return { authoritative: true, offline: false };
  }
  if (state.phase === STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL) {
    return { authoritative: false, offline: true };
  }
  throw mutationBoundaryError(state);
}

/**
 * Reconciliation can write a substantial server snapshot to IndexedDB.  It is
 * intentionally deferred until the route shell is interactive so browser
 * storage throughput cannot hold the application loader open.  The task
 * preserves pre-existing outbox work while forcing mutations created in the
 * stale window to cross an authoritative pull before their first push.
 */
export function scheduleInitialRouteReconciliation(controller, scheduleTask) {
  if (typeof scheduleTask !== "function") return null;
  const workspaceToken = currentWorkspaceToken(controller);
  let resolveScheduled;
  let rejectScheduled;
  const scheduledPromise = new Promise((resolve, reject) => {
    resolveScheduled = resolve;
    rejectScheduled = reject;
  });
  // schedulePostStartupTask also reports callback failures. Attaching a
  // handler here keeps the deferred boundary from becoming an unhandled
  // rejection when no mutation is currently awaiting it.
  void scheduledPromise.catch(() => false);
  controller._startupReconciliationPromise = scheduledPromise;
  transitionStartupReconciliation(
    controller,
    getStartupReconciliationState(controller).phase,
    { promise: scheduledPromise, workspaceToken },
  );
  scheduleTask(async () => {
    try {
      const result = await reconcileRouteDataAtStartup(controller);
      resolveScheduled(result);
      return result;
    } catch (error) {
      rejectScheduled(error);
      throw error;
    } finally {
      if (controller?._startupReconciliationPromise === scheduledPromise) {
        controller._startupReconciliationPromise = null;
      }
    }
  }, { timeout: 2200, delay: 0 });
  return scheduledPromise;
}

export function reconcileRouteDataAtStartup(controller, {
  reportRetry = reportOutboxRetry,
  reportFailure = reportStartupReconciliationFailure,
} = {}) {
  const workspaceToken = currentWorkspaceToken(controller);
  const existing = getStartupReconciliationState(controller);
  if (
    existing.workspaceToken === workspaceToken
    && existing.phase === STARTUP_RECONCILIATION_PHASE.RECONCILING
    && existing.promise
  ) {
    return existing.promise;
  }
  if (globalThis.navigator?.onLine === false) {
    completeStartupReconciliation(
      controller,
      { ok: false, transport: true, error: new TypeError("Browser is offline") },
      workspaceToken,
    );
    return Promise.resolve(false);
  }

  const run = (async () => {
    controller?.markStartup?.("route-data-sync:start");
    try {
      const currentGeneration = Number(
        controller?.model?.getMutationOutboxGeneration?.() || 0,
      );
      const staleWindowMutationPending = currentGeneration > Number(
        existing.outboxGeneration || 0,
      );
      let initialPush = {
        ok: true,
        skipped: true,
        deferredForAuthoritativePull: staleWindowMutationPending,
      };
      if (!staleWindowMutationPending && typeof controller?.autoSync === "function") {
        initialPush = await controller.autoSync({ startupReconciliation: true });
      }
      if (!isCurrentWorkspace(controller, workspaceToken)) return false;
      if (initialPush?.conflict) {
        if (typeof controller?.forceSyncData === "function") {
          await controller.forceSyncData(true, true, true);
        }
        completeStartupReconciliation(controller, initialPush, workspaceToken);
        return false;
      }
      if (!initialPush?.ok) {
        completeStartupReconciliation(controller, initialPush, workspaceToken);
        return false;
      }
      let pullResult = { ok: true, skipped: true, localMutationsPending: false };
      if (typeof controller?.forceSyncData === "function") {
        pullResult = await controller.forceSyncData(true, true, true);
      }
      if (!isCurrentWorkspace(controller, workspaceToken)) return false;
      if (!pullResult?.ok) {
        completeStartupReconciliation(controller, pullResult, workspaceToken);
        return false;
      }
      if (pullResult?.localMutationsPending && typeof controller?.autoSync === "function") {
        const replay = await controller.autoSync({ startupReconciliation: true });
        if (!isCurrentWorkspace(controller, workspaceToken)) return false;
        void reportRetry({ workspaceKey: controller?.model?.workspaceScope?.key });
        if (!replay?.ok) {
          completeStartupReconciliation(controller, replay, workspaceToken);
          return false;
        }
      }
      completeStartupReconciliation(controller, { ok: true }, workspaceToken);
      return true;
    } catch (error) {
      void reportFailure({
        workspaceKey: controller?.model?.workspaceScope?.key,
        correlationId: error?.requestId,
      });
      console.warn("Initial route reconciliation failed; using the local workspace snapshot.");
      completeStartupReconciliation(
        controller,
        { ok: false, error, transport: isTransportFailure(error) },
        workspaceToken,
      );
      return false;
    } finally {
      if (isCurrentWorkspace(controller, workspaceToken)) {
        controller?.markStartup?.("route-data-sync:end");
      }
    }
  })();
  transitionStartupReconciliation(
    controller,
    STARTUP_RECONCILIATION_PHASE.RECONCILING,
    { promise: run, workspaceToken },
  );
  controller._startupReconciliationPromise = run;
  return run.finally(() => {
    if (controller?._startupReconciliationPromise === run) {
      controller._startupReconciliationPromise = null;
    }
  });
}
