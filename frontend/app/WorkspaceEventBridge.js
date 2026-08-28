import {
  isWorkspaceStorageEvent,
  WORKSPACE_PURGE_CHANNEL,
  WORKSPACE_PURGE_EVENT_KEY,
} from "./workspaceState.js";
import {
  captureWorkspace,
  workspaceIsCurrent,
} from "./SyncWorkspaceContext.js";


const PASSIVE_WORKSPACE_STORAGE_KEYS = new Set([
  "bf_last_sync_version",
  "bf_last_sync_timestamp",
  "bf_last_fetch_time",
  "bf_conflict_server_sync_version"
]);

export function shouldScheduleBackgroundSyncForStorageEvent(event, scope) {
  if (!scope || !isWorkspaceStorageEvent(event, scope)) return false;
  const prefix = `bf_workspace:${scope.key}:`;
  const baseKey = String(event.key).slice(prefix.length);
  return !PASSIVE_WORKSPACE_STORAGE_KEYS.has(baseKey);
}

export function scheduleBackgroundSync(delay = 500) {
  const workspace = captureWorkspace(this);
  const workspaceToken = String(workspace.token || workspace.organizationId || "");
  if (this._backgroundSyncTimer) {
    const timerOwner = this._backgroundSyncTimerOwner;
    if (timerOwner?.workspaceToken === workspaceToken) {
      timerOwner.queued = true;
      this._backgroundSyncQueued = true;
      return;
    }
    clearTimeout(this._backgroundSyncTimer);
    this._backgroundSyncTimer = null;
    this._backgroundSyncTimerOwner = null;
    this._backgroundSyncQueued = false;
  }
  const timerOwner = { workspace, workspaceToken, timer: null, queued: false };
  const timer = setTimeout(async () => {
    if (this._backgroundSyncTimerOwner !== timerOwner) return;
    this._backgroundSyncTimer = null;
    this._backgroundSyncTimerOwner = null;
    this._backgroundSyncQueued = false;
    if (!workspaceIsCurrent(this, workspace)) return;
    const activeRun = this._backgroundSyncRunOwner;
    if (activeRun) {
      if (activeRun.workspaceToken === workspaceToken) {
        activeRun.queued = true;
      } else {
        activeRun.nextWorkspace = workspace;
      }
      this._backgroundSyncQueued = true;
      return;
    }
    const runOwner = {
      workspace,
      workspaceToken,
      queued: timerOwner.queued,
    };
    this._backgroundSyncRunOwner = runOwner;
    this._backgroundSyncRunning = true;
    try {
      const startupReconciliation = this._startupReconciliationPromise;
      if (startupReconciliation) await startupReconciliation;
      if (!workspaceIsCurrent(this, workspace)) return;
      const pullResult = await this.forceSyncData(true);
      if (
        pullResult?.ok !== false
        && workspaceIsCurrent(this, workspace)
        && typeof this.warmPrimaryTabs === "function"
      ) {
        // Authoritative pulls invalidate page projections for changed tables.
        // Refill only missing/stale first pages before the next tab click;
        // warmPrimaryTabs is cache-aware, bounded to two requests at a time and
        // checks the exact workspace generation between batches.
        await this.warmPrimaryTabs();
      }
    } catch (err) {
      console.error("Background sync failed:", err);
    } finally {
      if (this._backgroundSyncRunOwner === runOwner) {
        this._backgroundSyncRunOwner = null;
        this._backgroundSyncRunning = false;
        this._backgroundSyncQueued = false;
        if (
          runOwner.nextWorkspace
          && workspaceIsCurrent(this, runOwner.nextWorkspace)
        ) {
          this.scheduleBackgroundSync(delay);
        } else if (runOwner.queued && workspaceIsCurrent(this, runOwner.workspace)) {
          this.scheduleBackgroundSync(delay);
        }
      }
    }
  }, delay);
  timerOwner.timer = timer;
  this._backgroundSyncTimerOwner = timerOwner;
  this._backgroundSyncTimer = timer;
}

export function setupAutoSyncBackground() {
  const checkAndSync = () => {
    this.scheduleBackgroundSync(500);
  };
  window.addEventListener("focus", checkAndSync);
  if (!this._workspaceStorageListener) {
    this._workspaceStorageListener = (event) => {
      const scope = this.model?.workspaceScope;
      if (scope && event.key === WORKSPACE_PURGE_EVENT_KEY && event.newValue) {
        try {
          const message = JSON.parse(event.newValue);
          if (message.scopeKey === scope.key || message.userId === scope.userId) {
            this.disconnectWebSocket?.(false);
            void this.model.deactivateWorkspace?.();
            return;
          }
        } catch {
          // Ignore malformed cross-tab messages from older clients.
        }
      }
      if (shouldScheduleBackgroundSyncForStorageEvent(event, scope)) {
        this.scheduleBackgroundSync(250);
      }
    };
    window.addEventListener("storage", this._workspaceStorageListener);
  }
  if (!this._workspacePurgeChannel && typeof BroadcastChannel === "function") {
    this._workspacePurgeChannel = new BroadcastChannel(WORKSPACE_PURGE_CHANNEL);
    this._workspacePurgeChannel.onmessage = (event) => {
      const scope = this.model?.workspaceScope;
      if (scope && event.data?.userId === scope.userId) {
        this.disconnectWebSocket?.(false);
        void this.model.deactivateWorkspace?.();
      }
    };
  }
  this.setupWebSocketConnection();
}
