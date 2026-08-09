import {
  reportOutboxRetry,
  reportStartupReconciliationFailure,
} from "../shared/releaseDiagnostics.js";

export async function reconcileRouteDataAtStartup(controller, {
  reportRetry = reportOutboxRetry,
  reportFailure = reportStartupReconciliationFailure,
} = {}) {
  controller?.markStartup?.("route-data-sync:start");
  try {
    let initialPush = { ok: true, skipped: true };
    if (typeof controller?.autoSync === "function") {
      initialPush = await controller.autoSync();
    }
    if (initialPush?.conflict) {
      if (typeof controller?.forceSyncData === "function") {
        await controller.forceSyncData(true, true, true);
      }
      return false;
    }
    let pullResult = { ok: true, skipped: true, localMutationsPending: false };
    if (typeof controller?.forceSyncData === "function") {
      pullResult = await controller.forceSyncData(true, true, true);
    }
    if (!pullResult?.ok) return false;
    if (pullResult?.localMutationsPending && typeof controller?.autoSync === "function") {
      const replay = await controller.autoSync();
      void reportRetry({ workspaceKey: controller?.model?.workspaceScope?.key });
      if (!replay?.ok) return false;
    }
    return true;
  } catch (error) {
    void reportFailure({
      workspaceKey: controller?.model?.workspaceScope?.key,
      correlationId: error?.requestId,
    });
    console.warn("Initial route reconciliation failed; using the local workspace snapshot.");
    return false;
  } finally {
    controller?.markStartup?.("route-data-sync:end");
  }
}
