export function workspaceChangedError() {
  const error = new Error("Workspace changed before the operation completed");
  error.name = "AbortError";
  error.code = "WORKSPACE_CHANGED";
  return error;
}

export function currentWorkspaceToken(model) {
  return String(model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "");
}

export function captureWorkspaceLease(model, { controller = null } = {}) {
  const token = currentWorkspaceToken(model);
  return Object.freeze({
    token,
    scope: String(model?.workspaceScope?.key || ""),
    db: model?.db,
    state: model?.state,
    controller,
    signal: controller?.signal || null,
  });
}

export function isWorkspaceLeaseCurrent(model, lease) {
  if (!model || !lease || lease.signal?.aborted) return false;
  const currentToken = currentWorkspaceToken(model);
  return (
    (!lease.token || currentToken === lease.token)
    && model.db === lease.db
    && model.state === lease.state
  );
}

export function assertWorkspaceLeaseCurrent(model, lease) {
  if (!isWorkspaceLeaseCurrent(model, lease)) throw workspaceChangedError();
  return lease;
}

export function beginWorkspaceRequest(model) {
  const controller = new AbortController();
  const lease = captureWorkspaceLease(model, { controller });
  model._workspaceRequestControllers ||= new Set();
  model._workspaceRequestControllers.add(controller);
  return Object.freeze({ controller, lease, signal: controller.signal });
}

export function finishWorkspaceRequest(model, request) {
  model?._workspaceRequestControllers?.delete?.(request?.controller);
}

export function abortWorkspaceRequests(requests) {
  if (!(requests instanceof Set)) return;
  for (const controller of requests) {
    controller?.abort?.(workspaceChangedError());
  }
  requests.clear();
}

export function abortWorkspaceRequestMap(requests) {
  if (!(requests instanceof Map)) return;
  for (const request of requests.values()) {
    const controller = request instanceof AbortController
      ? request
      : request?.controller;
    controller?.abort?.(workspaceChangedError());
  }
  requests.clear();
}
