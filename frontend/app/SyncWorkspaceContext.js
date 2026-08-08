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
  };
}

export function workspaceIsCurrent(controller, snapshot) {
  return Boolean(
    snapshot.organizationId
    && controller.model?.isWorkspaceCurrent?.(snapshot.token) !== false
  );
}
