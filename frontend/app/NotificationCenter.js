import { apiFetch } from "../shared/apiClient.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml, htmlIcon, safeAttr } from "../shared/view_helpers.js";
import {
  ALERT_META,
  deriveContractExpiryAlerts,
  deriveDashboardAlerts,
  derivePlanPublishingAlerts,
  selectDashboardActionItems
} from "./DashboardView.js";

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

function formatMoment(value) {
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
  }).format(date);
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

function workAlerts(controller) {
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
      </button>`;
  }).join("");

  const workMarkup = alerts.map((item) => {
    const meta = ALERT_META[item.alertKey] || {
      label: "Công việc cần xử lý",
      detail: "Kiểm tra tiến độ",
      icon: "triangle-alert",
      tone: "amber"
    };
    const detail = item.alertDetail || meta.detail;
    return `
      <button type="button" class="notification-item notification-work-item"
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
      </button>`;
  }).join("");

  elements.list.innerHTML = trustedHTML(`${activityMarkup}${workMarkup}`);
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
  root.dataset.initialized = "true";
  const elements = {
    root,
    trigger: document.getElementById("notification-trigger"),
    badge: document.getElementById("notification-badge"),
    panel: document.getElementById("notification-panel"),
    readAll: document.getElementById("notification-read-all"),
    list: document.getElementById("notification-list")
  };
  if (Object.values(elements).some((element) => !element)) return null;
  const state = { items: [], unreadCount: 0, loading: false, unavailable: false };

  const refresh = async () => {
    if (state.loading) return;
    state.loading = true;
    try {
      const response = await apiFetch("/api/notifications?limit=40");
      if (!response.ok) {
        state.unavailable = true;
        renderNotifications(state, controller, elements);
        updateBadge(state, elements);
        return;
      }
      const payload = await response.json();
      state.unavailable = false;
      state.items = Array.isArray(payload.items) ? payload.items : [];
      state.unreadCount = Number(payload.unreadCount || 0);
      renderNotifications(state, controller, elements);
      updateBadge(state, elements);
      window.lucide?.createIcons?.({ root: elements.panel });
    } catch (error) {
      console.warn("Unable to refresh notifications:", error);
      state.unavailable = true;
      renderNotifications(state, controller, elements);
      updateBadge(state, elements);
    } finally {
      state.loading = false;
    }
  };

  const setOpen = (open) => {
    elements.panel.hidden = !open;
    elements.trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      renderNotifications(state, controller, elements);
      refresh();
    }
  };

  elements.trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(elements.panel.hidden);
  });
  elements.readAll.addEventListener("click", async () => {
    if (!state.unreadCount) return;
    const response = await apiFetch("/api/notifications/read-all", { method: "POST" });
    if (response.ok) await refresh();
  });
  elements.list.addEventListener("click", async (event) => {
    if (event.target.closest?.("[data-notification-retry]")) {
      await refresh();
      return;
    }
    const notificationItem = event.target.closest?.("[data-notification-id]");
    if (notificationItem) {
      const id = notificationItem.dataset.notificationId;
      const current = state.items.find((entry) => entry.id === id);
      if (current && !current.readAt) {
        await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
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
    setOpen(false);
    navigateToTarget(controller, workItem.dataset.workTargetType, workItem.dataset.workTargetId);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("#notification-center")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.panel.hidden) {
      setOpen(false);
      elements.trigger.focus();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  window.setInterval(() => {
    if (!document.hidden) refresh();
  }, 60000);

  renderNotifications(state, controller, elements);
  refresh();
  return { refresh };
}
