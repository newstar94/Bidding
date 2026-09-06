import { apiFetch } from "../shared/apiClient.js";
import { workNotificationId, readDismissedWorkNotifications, dismissWorkNotification } from "./notificationDismissals.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml, htmlIcon, safeAttr } from "../shared/view_helpers.js";
import {
  ALERT_META,
  deriveContractExpiryAlerts,
  deriveDashboardAlerts,
  derivePlanPublishingAlerts,
  selectDashboardActionItems
} from "./DashboardView.js";
import {
  assertWorkspaceLeaseCurrent,
  beginWorkspaceRequest,
  finishWorkspaceRequest,
  workspaceChangedError,
} from "./workspaceLease.js";

const EMPTY_ACTIVITY = `
  <div class="notification-empty">
    ${htmlIcon("inbox", 'aria-hidden="true"')}
    <span>Chưa có thông báo mới</span>
  </div>`;

const NOTIFICATION_UNAVAILABLE = `
  <div class="notification-empty is-error" role="status">
    ${htmlIcon("cloud-off", 'aria-hidden="true"')}
    <span>Không thể tải thông báo lúc này.</span>
    <button type="button" class="notification-retry" data-notification-retry>Thử lại</button>
  </div>`;

export function formatMoment(value) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date).replace(/[-–—]/g, "/");
}

function activityIcon(kind) {
  if (kind === "assignment_added") return "briefcase-business";
  if (kind === "assignment_removed") return "shield-off";
  if (kind === "organization_added") return "building-2";
  return "log-out";
}

function activityTone(item) {
  const severity = String(item?.severity || "").toLowerCase();
  // Notifications that represent a failed/negative outcome use the danger
  // tone so they are not mistaken for an informational update.
  if (["error", "danger", "failed", "failure"].includes(severity) || severity === "warning") {
    return "red";
  }
  return "info";
}

function rawWorkAlerts(controller) {
  const summaryItems = controller?.model?.dashboardSummary?.alertItems;
  if (Array.isArray(summaryItems)) return summaryItems;
  const model = controller?.model;
  if (!model) return [];
  const packages = model.getFilteredGoiThau?.() || [];
  const plans = model.getFilteredKeHoach?.() || [];
  const contracts = model.getFilteredHopDong?.() || [];
  return selectDashboardActionItems([
    ...deriveDashboardAlerts(packages).items,
    ...derivePlanPublishingAlerts(plans).items,
    ...deriveContractExpiryAlerts(contracts).items
  ]);
}

function workAlerts(controller) {
  const dismissed = readDismissedWorkNotifications(controller.model);
  return rawWorkAlerts(controller).filter((item) => !dismissed.has(workNotificationId(item)));
}

function selectableNotifications(state, controller) {
  return [...state.items, ...workAlerts(controller).map((item) => ({
    id: workNotificationId(item), workAlert: true, readAt: 1,
  }))];
}

function workIdentity(item) {
  if (item.targetType === "contract") {
    return item.soHopDong || item.tenHopDong || "Hợp đồng";
  }
  if (item.targetType === "plan") {
    return item.maKeHoach || item.tenKeHoach || "Kế hoạch LCNT";
  }
  return item.maGoiThau || item.tenGoiThau || "Gói thầu";
}

function navigateToTarget(controller, targetType, targetId) {
  if (!targetId || !controller?.switchTab) return;
  const tab = {
    goithau: "goithau-detail",
    package: "goithau-detail",
    hopdong: "hopdong-detail",
    contract: "hopdong-detail",
    plan: "kehoach-detail"
  }[targetType];
  if (tab) controller.switchTab(tab, String(targetId));
}

function renderNotifications(state, controller, elements) {
  if (state.unavailable) {
    elements.readAll.disabled = true;
    elements.list.innerHTML = trustedHTML(NOTIFICATION_UNAVAILABLE);
    window.lucide?.createIcons?.({ root: elements.list });
    return;
  }
  const items = state.items || [];
  state.selected ||= new Set();
  const visibleIds = new Set(selectableNotifications(state, controller).map((item) => item.id));
  state.selected = new Set([...state.selected].filter((id) => visibleIds.has(id)));
  const alerts = workAlerts(controller);
  elements.readAll.disabled = !state.unreadCount;
  if (!items.length && !alerts.length) {
    elements.list.innerHTML = trustedHTML(EMPTY_ACTIVITY);
    return;
  }

  const activityMarkup = items.map((item) => {
    const unread = !item.readAt;
    const actionable = Boolean(item.route && item.targetId);
    const tone = activityTone(item);
    return `
      <div class="notification-select-row">
      ${state.selecting ? `<input type="checkbox" data-notification-select="${safeAttr(item.id)}" aria-label="Chọn thông báo: ${safeAttr(item.title)}" ${state.selected.has(item.id) ? "checked" : ""} ${state.deleting ? "disabled" : ""}>` : ""}
      <button type="button" class="notification-item ${unread ? "is-unread" : ""} notification-item-tone-${tone}"
          data-notification-id="${safeAttr(item.id)}"
          data-target-type="${safeAttr(item.targetType || "")}"
          data-target-id="${safeAttr(item.targetId || "")}" ${actionable ? "" : 'data-static="true"'}>
        <span class="notification-item-icon tone-${tone}">
          ${htmlIcon(activityIcon(item.kind), 'aria-hidden="true"')}
        </span>
        <span class="notification-item-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.message)}</span>
          <time>${escapeHtml(formatMoment(item.createdAt))}</time>
        </span>
        ${unread ? '<span class="notification-unread-dot" aria-label="Chưa đọc"></span>' : ""}
      </button></div>`;
  }).join("");

  const workMarkup = alerts.map((item) => {
    const meta = ALERT_META[item.alertKey] || {
      label: "Công việc cần xử lý",
      detail: "Kiểm tra tiến độ",
      icon: "triangle-alert",
      tone: "amber"
    };
    const detail = item.alertDetail || meta.detail;
    const selectionId = workNotificationId(item);
    return `
      <div class="notification-select-row">
      ${state.selecting ? `<input type="checkbox" data-notification-select="${safeAttr(selectionId)}" aria-label="Chọn thông báo: ${safeAttr(meta.label)}" ${state.selected.has(selectionId) ? "checked" : ""} ${state.deleting ? "disabled" : ""}>` : ""}
      <button type="button" class="notification-item notification-work-item"
          data-work-selection-id="${safeAttr(selectionId)}"
          data-work-target-type="${safeAttr(item.targetType || "")}"
          data-work-target-id="${safeAttr(item.id || "")}">
        <span class="notification-item-icon tone-${safeAttr(meta.tone)}">
          ${htmlIcon(meta.icon, 'aria-hidden="true"')}
        </span>
        <span class="notification-item-copy">
          <strong>${escapeHtml(meta.label)}</strong>
          <span>${escapeHtml(workIdentity(item))}${detail ? ` · ${escapeHtml(detail)}` : ""}</span>
          ${item.deadline ? `<time>Hạn: ${escapeHtml(item.deadline)}</time>` : ""}
        </span>
        ${htmlIcon("chevron-right", 'class="notification-chevron" aria-hidden="true"')}
      </button></div>`;
  }).join("");

  const selectionMarkup = state.selecting ? `<div class="notification-selection-tools">
    <label><input type="checkbox" data-notification-select-all ${visibleIds.size && state.selected.size === visibleIds.size ? "checked" : ""} ${state.deleting ? "disabled" : ""}> Chọn tất cả đang hiển thị</label>
    <button type="button" class="notification-read-all" data-notification-delete-selected ${!state.selected.size || state.deleting ? "disabled" : ""}>${state.deleting ? "Đang xóa…" : `Xóa (${state.selected.size})`}</button>
    </div>` : "";
  elements.list.innerHTML = trustedHTML(`${selectionMarkup}${activityMarkup}${workMarkup}`);
  const selectAll = elements.list.querySelector("[data-notification-select-all]");
  if (selectAll) selectAll.indeterminate = state.selected.size > 0 && state.selected.size < visibleIds.size;
  window.lucide?.createIcons?.({ root: elements.list });
}

function updateBadge(state, elements) {
  const count = Math.max(0, Number(state.unreadCount || 0));
  elements.badge.hidden = count === 0;
  elements.badge.textContent = count > 99 ? "99+" : String(count);
  elements.trigger.setAttribute(
    "aria-label",
    count ? `Mở trung tâm thông báo, ${count} thông báo chưa đọc` : "Mở trung tâm thông báo"
  );
}

export function initializeNotificationCenter(controller) {
  const root = document.getElementById("notification-center");
  if (!root || root.dataset.initialized === "true") return null;
  const elements = {
    root,
    trigger: document.getElementById("notification-trigger"),
    badge: document.getElementById("notification-badge"),
    panel: document.getElementById("notification-panel"),
    readAll: document.getElementById("notification-read-all"),
    list: document.getElementById("notification-list")
  };
  if (Object.values(elements).some((element) => !element)) return null;
  root.dataset.initialized = "true";
  const state = { items: [], unreadCount: 0, loading: false, unavailable: false };
  let activeRequest = null;
  let disposed = false;
  const deleteToggle = document.getElementById("notification-delete-toggle");
  const onDeleteToggle = () => {
    if (disposed || state.deleting) return;
    state.selecting = !state.selecting;
    state.selected = new Set();
    deleteToggle?.setAttribute("aria-pressed", String(state.selecting));
    renderNotifications(state, controller, elements);
  };
  deleteToggle?.addEventListener("click", onDeleteToggle);

  const refresh = async () => {
    if (disposed || state.loading) return;
    state.loading = true;
    const request = beginWorkspaceRequest(controller.model);
    activeRequest = request;
    try {
      const response = await apiFetch("/api/notifications?limit=40", {
        signal: request.signal,
      });
      assertWorkspaceLeaseCurrent(controller.model, request.lease);
      if (!response.ok) {
        state.unavailable = true;
        renderNotifications(state, controller, elements);
        updateBadge(state, elements);
        return;
      }
      const payload = await response.json();
      assertWorkspaceLeaseCurrent(controller.model, request.lease);
      state.unavailable = false;
      state.items = Array.isArray(payload.items) ? payload.items : [];
      state.unreadCount = Number(payload.unreadCount || 0);
      renderNotifications(state, controller, elements);
      updateBadge(state, elements);
      window.lucide?.createIcons?.({ root: elements.panel });
    } catch (error) {
      if (!disposed && error?.code !== "WORKSPACE_CHANGED") {
        console.warn("Unable to refresh notifications:", error);
        state.unavailable = true;
        renderNotifications(state, controller, elements);
        updateBadge(state, elements);
      }
    } finally {
      finishWorkspaceRequest(controller.model, request);
      if (activeRequest === request) activeRequest = null;
      state.loading = false;
    }
  };

  const setOpen = (open) => {
    if (disposed) return;
    elements.panel.hidden = !open;
    elements.trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      renderNotifications(state, controller, elements);
      refresh();
    }
  };

  const onTriggerClick = (event) => {
    event.stopPropagation();
    setOpen(elements.panel.hidden);
  };
  const onReadAllClick = async () => {
    if (disposed || !state.unreadCount) return;
    const response = await apiFetch("/api/notifications/read-all", { method: "POST" });
    if (!disposed && response.ok) await refresh();
  };
  const onListClick = async (event) => {
    if (disposed) return;
    // Rendering selection replaces the clicked node. Do not let the same
    // event reach the outside-click handler with a now-detached target.
    event.stopPropagation();
    const selection = event.target.closest?.("[data-notification-select], [data-notification-select-all]");
    if (selection) {
      if (state.deleting) return;
      if (selection.hasAttribute("data-notification-select-all")) {
        state.selected = new Set(selection.checked ? selectableNotifications(state, controller).map((item) => item.id) : []);
      } else {
        const id = selection.dataset.notificationSelect;
        if (selection.checked) state.selected.add(id);
        else state.selected.delete(id);
      }
      renderNotifications(state, controller, elements);
      return;
    }
    const deleteButton = event.target.closest?.("[data-notification-delete-selected]");
    if (deleteButton) {
      const selectedItems = selectableNotifications(state, controller).filter((entry) => state.selected.has(entry.id));
      if (!selectedItems.length || state.deleting) return;
      state.deleting = true;
      deleteButton.disabled = true;
      const request = beginWorkspaceRequest(controller.model);
      try {
        const confirmed = await controller.view.customConfirm(
          "Xóa thông báo", `Xóa ${selectedItems.length} thông báo đã chọn? Không thể hoàn tác. Dữ liệu và phân công liên quan không bị xóa.`, "trash-2",
        );
        if (!confirmed || disposed) return;
        assertWorkspaceLeaseCurrent(controller.model, request.lease);
        for (const item of selectedItems) {
        const id = item.id;
        if (item.workAlert) {
          assertWorkspaceLeaseCurrent(controller.model, request.lease);
          dismissWorkNotification(controller.model, id);
          state.selected.delete(id);
          continue;
        }
        const response = await apiFetch(`/api/notifications/${encodeURIComponent(id)}`, {
          method: "DELETE", signal: request.signal,
        });
        assertWorkspaceLeaseCurrent(controller.model, request.lease);
        if (!response.ok) throw new Error("Không thể xóa thông báo.");
        state.items = state.items.filter((entry) => entry.id !== id);
        if (!item.readAt) state.unreadCount = Math.max(0, state.unreadCount - 1);
        state.selected.delete(id);
        }
        renderNotifications(state, controller, elements);
        updateBadge(state, elements);
        elements.trigger.focus();
        await refresh();
      } catch (error) {
        if (!disposed && error?.code !== "WORKSPACE_CHANGED") {
          controller.view.showToast?.("Không thể xóa thông báo", "Vui lòng thử lại.", "error");
        }
      } finally {
        finishWorkspaceRequest(controller.model, request);
        state.deleting = false;
        deleteButton.disabled = false;
        if (!disposed) { renderNotifications(state, controller, elements); updateBadge(state, elements); }
      }
      return;
    }
    if (event.target.closest?.("[data-notification-retry]")) {
      await refresh();
      return;
    }
    const notificationItem = event.target.closest?.("[data-notification-id]");
    if (notificationItem) {
      const id = notificationItem.dataset.notificationId;
      if (state.selecting) {
        if (state.deleting) return;
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        renderNotifications(state, controller, elements);
        return;
      }
      const current = state.items.find((entry) => entry.id === id);
      if (current && !current.readAt) {
        await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
        if (disposed) return;
        current.readAt = Math.floor(Date.now() / 1000);
        state.unreadCount = Math.max(0, state.unreadCount - 1);
        renderNotifications(state, controller, elements);
        updateBadge(state, elements);
      }
      if (notificationItem.dataset.static !== "true") {
        setOpen(false);
        navigateToTarget(controller, notificationItem.dataset.targetType, notificationItem.dataset.targetId);
      }
      return;
    }

    const workItem = event.target.closest?.("[data-work-target-id]");
    if (!workItem) return;
    if (state.selecting) {
      if (state.deleting) return;
      const id = workItem.dataset.workSelectionId;
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      renderNotifications(state, controller, elements);
      return;
    }
    setOpen(false);
    navigateToTarget(controller, workItem.dataset.workTargetType, workItem.dataset.workTargetId);
  };
  const onDocumentClick = (event) => {
    if (!event.target.closest?.("#notification-center")) setOpen(false);
  };
  const onDocumentKeydown = (event) => {
    if (event.key === "Escape" && !elements.panel.hidden) {
      setOpen(false);
      elements.trigger.focus();
    }
  };
  const onVisibilityChange = () => {
    if (!document.hidden) refresh();
  };
  const onInterval = () => {
    if (!document.hidden) refresh();
  };

  elements.trigger.addEventListener("click", onTriggerClick);
  elements.readAll.addEventListener("click", onReadAllClick);
  elements.list.addEventListener("click", onListClick);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const intervalId = window.setInterval(onInterval, 60000);

  const api = {
    refresh,
    open: () => setOpen(true),
    dispose() {
      if (disposed) return;
      disposed = true;
      activeRequest?.controller?.abort?.(workspaceChangedError());
      window.clearInterval(intervalId);
      elements.trigger.removeEventListener("click", onTriggerClick);
      deleteToggle?.removeEventListener("click", onDeleteToggle);
      elements.readAll.removeEventListener("click", onReadAllClick);
      elements.list.removeEventListener("click", onListClick);
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeydown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      elements.panel.hidden = true;
      elements.trigger.setAttribute("aria-expanded", "false");
      delete root.dataset.initialized;
      if (controller.notificationCenter === api) controller.notificationCenter = null;
    },
  };

  renderNotifications(state, controller, elements);
  refresh();
  return api;
}
