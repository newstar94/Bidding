import {
  getActiveOrganizationId,
  getWorkspaceStorage,
} from "./workspaceState.js";


export function currentWorkspaceStorage(controller) {
  return controller.model?.workspaceStorage || getWorkspaceStorage();
}

export function captureWorkspace(controller) {
  return {
    token: controller.model?.getWorkspaceToken?.() || "",
    organizationId: controller.model?.workspaceScope?.organizationId
      || getActiveOrganizationId(),
    workspaceKey: controller.model?.workspaceScope?.key || "",
    storage: controller.model?.workspaceStorage || null,
  };
}

export function workspaceIsCurrent(controller, snapshot) {
  return Boolean(
    snapshot.organizationId
    && controller.model?.isWorkspaceCurrent?.(snapshot.token) !== false
  );
}

export async function awaitCurrentWorkspacePulls(controller) {
  const workspace = captureWorkspace(controller);
  const pullKey = String(workspace.token || workspace.organizationId || "");
  if (!pullKey) return;
  const model = controller?.model;
  const requestIsCurrent = (request) => (
    request?.promise
    && typeof request.promise.then === "function"
    && (!request.lease || (
      (!request.lease.token || request.lease.token === workspace.token)
      && (!request.lease.scope || request.lease.scope === workspace.workspaceKey)
      && (!request.lease.state || request.lease.state === model?.state)
      && (!request.lease.db || request.lease.db === model?.db)
    ))
  );
  while (true) {
    const flights = controller?._workspacePullFlights?.get?.(pullKey);
    const activeRequests = [
      ...(flights?.values?.() || []),
      ...(model?._paginationRequests?.values?.() || []),
      ...(model?._planPackageHydrationRequests?.values?.() || []),
    ].filter(requestIsCurrent);
    const active = [...new Set(activeRequests.map((request) => request.promise))];
    if (active.length === 0) return;
    await Promise.allSettled(active);
    if (!workspaceIsCurrent(controller, workspace)) {
      const error = new Error("Workspace changed while awaiting an authoritative pull");
      error.name = "AbortError";
      error.code = "WORKSPACE_CHANGED";
      throw error;
    }
  }
}
