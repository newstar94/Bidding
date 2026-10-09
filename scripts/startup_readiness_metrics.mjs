// Keep this function self-contained so Playwright can evaluate it in the page.
export function readWorkspaceStartupReadiness({ waitForTerminal = false } = {}) {
  const indicator = document.getElementById("btn-force-sync");
  const applicable = Boolean(indicator);
  const phase = indicator?.dataset.startupReconciliationPhase || null;
  const terminal = ["RECONCILED", "OFFLINE_LOCAL", "SYNC_ERROR", "CONFLICT"].includes(phase);
  if (waitForTerminal && applicable && !terminal) return null;
  const mark = (name) => performance.getEntriesByName(`bf:${name}`).at(-1)?.startTime ?? null;
  const startedMs = applicable ? mark("workspace-reconciliation:RECONCILING") : null;
  const settledMs = terminal ? mark(`workspace-reconciliation:${phase}`) : null;
  return {
    workspaceReconciliationApplicable: applicable,
    workspaceReconciliationPhase: phase,
    workspaceReconciliationStartedMs: startedMs,
    workspaceReconciliationSettledMs: settledMs,
    workspaceReconciliationMs: startedMs !== null && settledMs !== null
      ? Math.round(settledMs - startedMs)
      : null,
    workspaceSynchronizedMs: phase === "RECONCILED" ? settledMs : null,
  };
}

export function hasAuthoritativeWorkspaceReadiness(sample) {
  return !sample.workspaceReconciliationApplicable
    || (sample.workspaceReconciliationPhase === "RECONCILED"
      && Number.isFinite(sample.workspaceSynchronizedMs));
}

export function hasRequestedRouteReadiness(sample, requestedPathname) {
  return sample.pathname === requestedPathname
    && (requestedPathname !== "/admin"
      || (Number.isFinite(sample.adminShellReadyMs)
        && Number.isFinite(sample.adminRouteReadyMs)));
}
