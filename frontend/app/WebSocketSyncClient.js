import { APP_DEBUG } from "./appConfig.js";
import { getActiveOrganizationId } from "./workspaceState.js";
import {
  reportWebSocketPollingFallback,
  reportWebSocketReconnect,
} from "../shared/releaseDiagnostics.js";


const NON_RETRYABLE_CLOSE_CODES = new Set([1000, 4001, 4003, 4401, 4403]);
const CLIENTS = new WeakMap();

function captureWorkspace(controller) {
  return {
    token: controller.model?.getWorkspaceToken?.() || "",
    organizationId: controller.model?.workspaceScope?.organizationId
      || getActiveOrganizationId(),
  };
}

function workspaceIsCurrent(controller, snapshot) {
  return !!snapshot.organizationId
    && controller.model?.isWorkspaceCurrent?.(snapshot.token) !== false;
}

function hideOfflineBanner() {
  const banner = globalThis.document?.getElementById("offline-indicator-banner");
  banner?.classList.remove("visible");
  if (banner) banner.hidden = true;
}

export function shouldReconnectWebSocket(closeCode) {
  return !NON_RETRYABLE_CLOSE_CODES.has(Number(closeCode));
}

export class WebSocketSyncClient {
  constructor(controller) {
    this.controller = controller;
  }

  startPollingFallback(interval = 30_000) {
    const controller = this.controller;
    if (controller._wsPollingTimer) return;
    controller._wsPollingStartedAt = Date.now();
    controller._wsPollingTimer = setInterval(() => {
      if (globalThis.navigator?.onLine === false) return;
      controller.notificationCenter?.refresh?.();
      controller.scheduleBackgroundSync?.(0);
    }, interval);
  }

  stopPollingFallback() {
    const controller = this.controller;
    if (!controller._wsPollingTimer) return;
    clearInterval(controller._wsPollingTimer);
    controller._wsPollingTimer = null;
    const startedAt = Number(controller._wsPollingStartedAt || 0);
    controller._wsPollingStartedAt = 0;
    if (startedAt > 0) void reportWebSocketPollingFallback(Date.now() - startedAt);
  }

  connect() {
    const controller = this.controller;
    const workspace = captureWorkspace(controller);
    if (!workspace.organizationId) return;
    if (controller.ws && controller._wsOrganizationId === workspace.organizationId
      && [WebSocket.OPEN, WebSocket.CONNECTING].includes(controller.ws.readyState)) {
      if (!controller._wsReady) this.startPollingFallback();
      return;
    }
    if (controller.ws) this.disconnect(false);
    if (controller._wsReconnectTimer) {
      clearTimeout(controller._wsReconnectTimer);
      controller._wsReconnectTimer = null;
    }
    this.startPollingFallback();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/sync`;
    const debug = APP_DEBUG;
    if (debug) console.log("Connecting to WebSocket sync server:", wsUrl);
    const ws = new WebSocket(wsUrl);
    controller.ws = ws;
    controller._wsOrganizationId = workspace.organizationId;
    controller._wsReady = false;
    controller._wsReconnectEnabled = true;
    ws.onopen = () => {
      if (debug) console.log("WebSocket connection established. Sending auth...");
      controller._wsRetryDelay = 5e3;
      controller.updateSyncState?.({ online: true });
      ws.send(JSON.stringify({
        action: "auth",
        organizationId: workspace.organizationId,
      }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "ready") {
          if (controller.ws !== ws || !workspaceIsCurrent(controller, workspace)
            || String(msg.organizationId || "") !== workspace.organizationId) return;
          controller._wsReady = true;
          this.stopPollingFallback();
          hideOfflineBanner();
          controller.updateSyncState?.({ online: true });
          return;
        }
        if (msg.type === "ping") {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (msg.event === "db_changed") {
          if (!workspaceIsCurrent(controller, workspace)) return;
          if (debug) console.log("Database changed event received from WebSocket. Triggering Delta Sync...");
          controller.notificationCenter?.refresh?.();
          controller.scheduleBackgroundSync(300);
        } else if (msg.event === "organization_member_changed") {
          if (!workspaceIsCurrent(controller, workspace)) return;
          const employeeTab = document.getElementById("tab-managernhanvien");
          if (employeeTab?.classList.contains("active")
            && typeof controller.reloadEmployeesFromDatabase === "function") {
            void controller.reloadEmployeesFromDatabase().then(() => {
              controller.view.renderManagerNhanVienPanel();
            });
          }
        } else if (msg.event === "organization_subscription_changed"
          || msg.event === "user_access_settings_changed") {
          if (!workspaceIsCurrent(controller, workspace)) return;
          void controller._checkSessionNow?.();
          controller.scheduleBackgroundSync(300);
        }
      } catch (error) {
        console.error("Error handling WebSocket message:", error);
      }
    };
    ws.onclose = (event) => {
      if (controller.ws && controller.ws !== ws) return;
      if (controller.ws === ws) {
        controller.ws = null;
        controller._wsOrganizationId = null;
        controller._wsReady = false;
      }
      const reconnectEnabled = Boolean(controller._wsReconnectEnabled);
      const workspaceCurrent = workspaceIsCurrent(controller, workspace);
      const retryable = shouldReconnectWebSocket(event.code);
      const intentionalWorkspaceChange = event.code === 1000
        && event.reason === "workspace_changed";
      if (!reconnectEnabled || !workspaceCurrent || !retryable) {
        if (controller._wsReconnectTimer) {
          clearTimeout(controller._wsReconnectTimer);
          controller._wsReconnectTimer = null;
        }
        controller._wsRetryDelay = 5e3;
        if (reconnectEnabled && workspaceCurrent && !intentionalWorkspaceChange) {
          this.startPollingFallback();
        }
        if (debug && !intentionalWorkspaceChange) {
          console.warn(`WebSocket connection closed permanently for this session (code: ${event.code || "unknown"}). A new login is required before reconnecting.`);
        }
        return;
      }
      const currentDelay = controller._wsRetryDelay || 5e3;
      const nextDelay = Math.min(6e4, Math.round(currentDelay * 1.5));
      controller._wsRetryDelay = nextDelay;
      void reportWebSocketReconnect();
      this.startPollingFallback();
      if (debug) {
        console.log(`WebSocket connection closed (code: ${event.code || "unknown"}, reason: ${event.reason || "none"}). Reconnecting in ${Math.round(nextDelay / 1e3)}s...`);
      }
      if (controller._wsReconnectTimer) clearTimeout(controller._wsReconnectTimer);
      controller._wsReconnectTimer = setTimeout(() => {
        controller._wsReconnectTimer = null;
        this.connect();
      }, nextDelay);
    };
    ws.onerror = (error) => {
      if (controller.ws !== ws || controller._wsPageSuspended) return;
      console.error("WebSocket error:", error);
      ws.close();
    };
  }

  disconnect(reconnect = false) {
    const controller = this.controller;
    controller._wsReconnectEnabled = reconnect;
    if (reconnect) this.startPollingFallback();
    else this.stopPollingFallback();
    if (controller._wsReconnectTimer) {
      clearTimeout(controller._wsReconnectTimer);
      controller._wsReconnectTimer = null;
    }
    const socket = controller.ws;
    controller.ws = null;
    controller._wsOrganizationId = null;
    controller._wsReady = false;
    if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
      socket.close(1000, "workspace_changed");
    }
  }
}

export function webSocketSyncClientFor(controller) {
  let client = CLIENTS.get(controller);
  if (!client) {
    client = new WebSocketSyncClient(controller);
    CLIENTS.set(controller, client);
  }
  return client;
}
