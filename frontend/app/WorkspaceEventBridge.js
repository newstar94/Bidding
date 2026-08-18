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
  if (this._backgroundSyncTimer) {
    this._backgroundSyncQueued = true;
    return;
  }
  const workspace = captureWorkspace(this);
  this._backgroundSyncTimer = setTimeout(async () => {
    this._backgroundSyncTimer = null;
    if (!workspaceIsCurrent(this, workspace)) return;
    if (this._backgroundSyncRunning) {
      this._backgroundSyncQueued = true;
      return;
    }
    this._backgroundSyncRunning = true;
    try {
      const startupReconciliation = this._startupReconciliationPromise;
      if (startupReconciliation) await startupReconciliation;
      if (!workspaceIsCurrent(this, workspace)) return;
      await this.forceSyncData(true);
    } catch (err) {
      console.error("Background sync failed:", err);
    } finally {
      this._backgroundSyncRunning = false;
      if (this._backgroundSyncQueued) {
        this._backgroundSyncQueued = false;
        this.scheduleBackgroundSync(delay);
      }
    }
  }, delay);
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
