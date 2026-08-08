import { reportOutboxRetry } from "../shared/releaseDiagnostics.js";

export async function reconcileRouteDataAtStartup(controller) {
  controller?.markStartup?.("route-data-sync:start");
  try {
    let initialPush = { ok: true, skipped: true };
    if (typeof controller?.autoSync === "function") {
      initialPush = await controller.autoSync();
      if (initialPush?.skipped !== true) void reportOutboxRetry();
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
      void reportOutboxRetry();
      if (!replay?.ok) return false;
    }
    return true;
  } catch (error) {
    console.warn("Initial route reconciliation failed; using the local workspace snapshot.", error);
    return false;
  } finally {
    controller?.markStartup?.("route-data-sync:end");
  }
}
