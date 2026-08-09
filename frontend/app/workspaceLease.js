export function workspaceChangedError() {
  const error = new Error("Workspace changed before the operation completed");
  error.name = "AbortError";
  error.code = "WORKSPACE_CHANGED";
  return error;
}

export function captureWorkspaceLease(model, { controller = null } = {}) {
  const token = String(
    model?.getWorkspaceToken?.()
    || model?.workspaceScope?.key
    || "",
  );
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
  const currentToken = String(
    model.getWorkspaceToken?.()
    || model.workspaceScope?.key
    || "",
  );
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
