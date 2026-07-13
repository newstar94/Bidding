export async function reconcileRouteDataAtStartup(controller) {
  controller?.markStartup?.("route-data-sync:start");
  try {
    if (typeof controller?.autoSync === "function") {
      await controller.autoSync();
    }
    if (typeof controller?.forceSyncData === "function") {
      await controller.forceSyncData(true, true, true);
    }
    if (typeof controller?.autoSync === "function") {
      await controller.autoSync();
    }
    return true;
  } catch (error) {
    console.warn("Initial route reconciliation failed; using the local workspace snapshot.", error);
    return false;
  } finally {
    controller?.markStartup?.("route-data-sync:end");
  }
}
