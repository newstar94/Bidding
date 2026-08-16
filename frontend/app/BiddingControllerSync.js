import {
  webSocketSyncClientFor,
} from "./WebSocketSyncClient.js";

export { shouldReconnectWebSocket } from "./WebSocketSyncClient.js";
export {
  applyDashboardSummaryAfterMutation,
  collectCommittedMutationKeys,
  mutationAffectsDashboard,
  selectPostCommitRenderKeys,
  shouldRefreshRouteAfterBackgroundSync,
} from "./SyncRenderCoordinator.js";
export {
  getSyncValidationErrors,
  resolveRowVersionConflicts,
} from "./ConflictResolver.js";
export {
  scheduleBackgroundSync,
  setupAutoSyncBackground,
  shouldScheduleBackgroundSyncForStorageEvent,
} from "./WorkspaceEventBridge.js";
export {
  buildSyncErrorDetailLines,
  updateSyncState,
} from "./SyncPresenter.js";
export {
  detailRecordExists,
  ensureDetailRecordLoaded,
  fetchRecordByLookup,
  finalizePulledSyncState,
  forceSyncData,
} from "./SyncPullService.js";
export { autoSync } from "./SyncPushService.js";
export {
  prepareExportSnapshot,
  resolvePendingSyncConflict,
  setupSyncUx,
} from "./SyncCoordinator.js";
export function setupWebSocketConnection() {
  return webSocketSyncClientFor(this).connect();
}

export function disconnectWebSocket(reconnect = false) {
  return webSocketSyncClientFor(this).disconnect(reconnect);
}
