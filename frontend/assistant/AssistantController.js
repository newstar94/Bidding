import { assistantApi, consumeAssistantStream } from "./AssistantApi.js";
import { getActiveOrganizationId } from "../app/workspaceState.js";
import { initCustomSelect } from "../shared/view_helpers.js";

const MODES = [
  ["data", "Dữ liệu BiddingFlow"],
  ["procurement_advice", "Tư vấn đấu thầu"],
  ["app_help", "Hướng dẫn ứng dụng"]
];

const ASSISTANT_TRIGGER_POSITION_KEY = "biddingflow.assistant.trigger-position";

const make = (tag, className, text = "") => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

const icon = (name) => {
  const node = make("i");
  node.setAttribute("data-lucide", name);
  node.setAttribute("aria-hidden", "true");
  return node;
};

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (/^\d+$/.test(String(value)) && String(value).length > 6) return `${new Intl.NumberFormat("vi-VN").format(Number(value))} ₫`;
  return String(value);
}

function isSafeSourceUrl(value) {
  const url = String(value || "").trim();
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    const parsed = new URL(url, globalThis.location?.origin || "http://localhost");
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch (_) {
    return false;
  }
}

function isExternalSourceUrl(value) {
  return String(value || "").trim().startsWith("https://");
}

let assistantRequestCounter = 0;

function createAssistantRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `air_${uuid}`;
  assistantRequestCounter += 1;
  return `air_${Date.now().toString(36)}_${assistantRequestCounter.toString(36)}`;
}

function activeWorkspaceName(controller) {
  const id = getActiveOrganizationId();
  const user = controller?.model?.state?.activeuser || {};
  return user.organizations?.find((item) => String(item?.id) === id)?.name || document.getElementById("header-active-org-name")?.textContent || id || "Workspace hiện tại";
}

function formatConversationTime(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

export function mountAssistant(controller, config) {
  const assistant = new AssistantController(controller, config);
  assistant.mount();
  return assistant;
}

class AssistantController {
  constructor(controller, config) {
    this.controller = controller;
    this.config = config;
    this.mode = "data";
    this.conversationId = "";
    this.abortController = null;
    this.lastQuestion = "";
    this.lastRequestId = "";
    this.activeMessage = null;
    this.activeUserMessage = null;
    this.workspaceId = getActiveOrganizationId();
    this.previousFocus = null;
    this.trigger = null;
    this.panel = null;
    this.status = null;
    this.conversations = [];
    this.historyRequestId = 0;
    this.conversationRequestId = 0;
    this.historyReady = Promise.resolve();
    this.historyInitialized = false;
    this.historyButton = null;
    this.historyPanel = null;
    this.historyList = null;
    this.sourceList = null;
    this.sourceKeys = new Set();
    this.targetHint = null;
    this.targetChip = null;
    this.modeSelect = null;
    this.triggerDrag = null;
    this.suppressTriggerClick = false;
    this.positionPanel = this.positionPanel.bind(this);
  }

  mount() {
    if (document.getElementById("bf-assistant-trigger")) return;
    this.trigger = make("button", "bf-assistant-trigger");
    this.trigger.id = "bf-assistant-trigger";
    this.trigger.type = "button";
    this.trigger.setAttribute("aria-label", "Mở trợ lý BiddingFlow");
    this.trigger.setAttribute("aria-controls", "bf-assistant-panel");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.title = "Kéo để di chuyển · Nhấn để mở trợ lý";
    const triggerMark = make("span", "bf-assistant-trigger-mark");
    triggerMark.setAttribute("aria-hidden", "true");
    const robotFace = make("span", "bf-assistant-trigger-robot");
    robotFace.append(
      make("span", "bf-assistant-trigger-robot-eyes"),
      make("span", "bf-assistant-trigger-robot-smile")
    );
    triggerMark.appendChild(robotFace);
    const triggerCopy = make("span", "bf-assistant-trigger-copy");
    triggerCopy.append(
      make("strong", "bf-assistant-trigger-label", "Trợ lý AI"),
      make("span", "bf-assistant-trigger-hint", "Hỏi về đấu thầu")
    );
    this.trigger.append(triggerMark, triggerCopy);
    document.body.appendChild(this.trigger);
    this.restoreTriggerPosition();

    this.panel = make("aside", "bf-assistant-panel");
    this.panel.id = "bf-assistant-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    this.panel.setAttribute("aria-label", "Trợ lý BiddingFlow");
    this.panel.setAttribute("aria-live", "off");
    this.panel.hidden = true;
    document.body.appendChild(this.panel);
    this.buildPanel();
    this.trigger.addEventListener("click", () => {
      if (this.suppressTriggerClick) {
        this.suppressTriggerClick = false;
        return;
      }
      this.toggle();
    });
    this.bindTriggerDrag();
    this.panel.addEventListener("keydown", (event) => this.trapFocus(event));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.panel.hidden) this.close();
    });
    document.addEventListener("click", (event) => {
      if (this.historyPanel?.hidden !== false) return;
      if (this.historyPanel.contains(event.target) || this.historyButton?.contains(event.target)) return;
      this.setHistoryOpen(false);
    });
    window.addEventListener("bf:workspace-changed", () => this.resetForWorkspace());
    window.addEventListener("bf:assistant-target", (event) => {
      void this.setTargetHint(event.detail);
    });
    window.addEventListener("resize", this.positionPanel);
    window.lucide?.createIcons?.({ root: this.panel });
  }

  restoreTriggerPosition() {
    try {
      const saved = JSON.parse(window.localStorage?.getItem(ASSISTANT_TRIGGER_POSITION_KEY) || "null");
      if (!Number.isFinite(saved?.left) || !Number.isFinite(saved?.top)) return;
      const rect = this.trigger.getBoundingClientRect();
      const left = Math.min(Math.max(0, saved.left), Math.max(0, window.innerWidth - rect.width));
      const top = Math.min(Math.max(0, saved.top), Math.max(0, window.innerHeight - rect.height));
      this.trigger.style.left = `${left}px`;
      this.trigger.style.top = `${top}px`;
      this.trigger.style.right = "auto";
      this.trigger.style.bottom = "auto";
    } catch (_) {
      // Storage can be unavailable in private or restricted browsing contexts.
    }
  }

  persistTriggerPosition() {
    try {
      const rect = this.trigger.getBoundingClientRect();
      window.localStorage?.setItem(ASSISTANT_TRIGGER_POSITION_KEY, JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
      }));
    } catch (_) {
      // Keep dragging usable even when persistence is blocked.
    }
  }

  bindTriggerDrag() {
    this.trigger.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType !== "touch") return;
      const rect = this.trigger.getBoundingClientRect();
      this.triggerDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originLeft: rect.left,
        originTop: rect.top,
        moved: false,
      };
      this.trigger.setPointerCapture?.(event.pointerId);
    });
    this.trigger.addEventListener("pointermove", (event) => {
      const drag = this.triggerDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
      drag.moved = true;
      const rect = this.trigger.getBoundingClientRect();
      const left = Math.min(Math.max(0, drag.originLeft + deltaX), Math.max(0, window.innerWidth - rect.width));
      const top = Math.min(Math.max(0, drag.originTop + deltaY), Math.max(0, window.innerHeight - rect.height));
      this.trigger.style.left = `${left}px`;
      this.trigger.style.top = `${top}px`;
      this.trigger.style.right = "auto";
      this.trigger.style.bottom = "auto";
      this.trigger.classList.toggle("is-dragging", true);
      if (!this.panel.hidden) this.positionPanel();
      event.preventDefault();
    });
    const finishDrag = (event) => {
      const drag = this.triggerDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      this.trigger.releasePointerCapture?.(event.pointerId);
      this.triggerDrag = null;
      this.trigger.classList.remove("is-dragging");
      if (drag.moved) {
        this.suppressTriggerClick = true;
        this.persistTriggerPosition();
      }
    };
    this.trigger.addEventListener("pointerup", finishDrag);
    this.trigger.addEventListener("pointercancel", finishDrag);
  }

  positionPanel() {
    if (!this.panel || this.panel.hidden || !this.trigger) return;
    const triggerRect = this.trigger.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();
    const gap = 12;
    const margin = 8;
    let left = triggerRect.right - panelRect.width;
    let top = triggerRect.top - panelRect.height - gap;
    if (top < margin) top = triggerRect.bottom + gap;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - panelRect.width - margin));
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - panelRect.height - margin));
    this.panel.style.left = `${Math.round(left)}px`;
    this.panel.style.top = `${Math.round(top)}px`;
    this.panel.style.right = "auto";
    this.panel.style.bottom = "auto";
  }

  buildPanel() {
    const header = make("div", "bf-assistant-header");
    const heading = make("div", "bf-assistant-heading");
    heading.append(make("span", "bf-assistant-eyebrow", "BiddingFlow AI"), make("h2", "bf-assistant-title", "Trợ lý đấu thầu"));
    const headerActions = make("div", "bf-assistant-header-actions");
    this.historyButton = make("button", "action-btn bf-assistant-history-trigger");
    this.historyButton.type = "button";
    this.historyButton.title = "Lịch sử trò chuyện";
    this.historyButton.setAttribute("aria-label", "Lịch sử trò chuyện");
    this.historyButton.setAttribute("aria-controls", "bf-assistant-history-panel");
    this.historyButton.setAttribute("aria-expanded", "false");
    this.historyButton.append(icon("history"));
    this.historyButton.addEventListener("click", () => this.setHistoryOpen(this.historyPanel?.hidden !== false));
    const close = make("button", "modal-close bf-assistant-close", "×");
    close.type = "button"; close.setAttribute("aria-label", "Đóng trợ lý"); close.addEventListener("click", () => this.close());
    headerActions.append(this.historyButton, close);
    header.append(heading, headerActions);

    const context = make("div", "bf-assistant-context");
    context.append(icon("building-2"), make("span", "bf-assistant-workspace", activeWorkspaceName(this.controller)));
    const modeSelect = make("select", "bf-assistant-mode");
    this.modeSelect = modeSelect;
    modeSelect.id = "bf-assistant-mode-select";
    modeSelect.dataset.dropdownInline = "true";
    modeSelect.setAttribute("aria-label", "Chế độ trợ lý");
    MODES.forEach(([value, label]) => { const option = make("option", "", label); option.value = value; modeSelect.appendChild(option); });
    modeSelect.value = this.mode;
    modeSelect.addEventListener("change", () => this.changeMode(modeSelect.value));
    context.append(modeSelect);
    this.targetChip = make("div", "bf-assistant-target-chip");
    this.targetChip.hidden = true;
    const targetLabel = make("span", "bf-assistant-target-label");
    const clearTarget = make("button", "bf-assistant-target-clear", "×");
    clearTarget.type = "button";
    clearTarget.setAttribute("aria-label", "Bỏ target tuân thủ");
    clearTarget.addEventListener("click", () => this.clearTargetHint());
    this.targetChip.append(targetLabel, clearTarget);
    context.append(this.targetChip);

    this.historyPanel = make("section", "bf-assistant-history-panel");
    this.historyPanel.id = "bf-assistant-history-panel";
    this.historyPanel.hidden = true;
    this.historyPanel.setAttribute("role", "region");
    this.historyPanel.setAttribute("aria-label", "Lịch sử trò chuyện");
    const historyHeading = make("div", "bf-assistant-history-heading");
    historyHeading.append(make("strong", "", "Lịch sử trò chuyện"), make("span", "", "Chọn để tiếp tục"));
    this.historyList = make("div", "bf-assistant-history-list");
    this.historyList.setAttribute("role", "list");
    this.historyPanel.append(historyHeading, this.historyList);

    this.status = make("div", "bf-assistant-status", "Sẵn sàng");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.setAttribute("aria-atomic", "true");
    this.messages = make("div", "bf-assistant-messages");
    this.messages.setAttribute("role", "log");
    this.messages.setAttribute("aria-live", "polite");
    this.composer = make("form", "bf-assistant-composer");
    this.composer.setAttribute("aria-label", "Gửi câu hỏi cho trợ lý");
    this.input = make("textarea", "bf-assistant-input");
    this.input.rows = 2; this.input.maxLength = 4000; this.input.placeholder = "Hỏi về dữ liệu, quy trình hoặc cách dùng BiddingFlow…";
    this.input.setAttribute("aria-label", "Nội dung câu hỏi");
    this.input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.send(); } });
    const inputShell = make("div", "bf-assistant-input-shell");
    const actions = make("div", "bf-assistant-composer-actions");
    this.clearButton = make("button", "bf-assistant-clear");
    this.clearButton.type = "button";
    this.clearButton.setAttribute("aria-label", "Tạo cuộc trò chuyện mới");
    this.clearButton.append(icon("plus"), make("span", "", "Cuộc trò chuyện mới"));
    this.clearButton.addEventListener("click", () => this.newConversation());
    this.stopButton = make("button", "bf-assistant-stop", "Dừng"); this.stopButton.type = "button"; this.stopButton.hidden = true; this.stopButton.addEventListener("click", () => this.stop());
    this.sendButton = make("button", "bf-assistant-send"); this.sendButton.type = "submit"; this.sendButton.setAttribute("aria-label", "Gửi câu hỏi"); this.sendButton.append(icon("arrow-up"));
    actions.append(this.clearButton, this.stopButton, this.sendButton);
    inputShell.append(this.input, actions);
    this.composer.append(inputShell);
    this.composer.addEventListener("submit", (event) => { event.preventDefault(); this.send(); });
    this.panel.append(header, context, this.historyPanel, this.status, this.messages, this.composer);
    initCustomSelect(modeSelect.id);
    const modeWrapper = this.panel.querySelector(`.custom-select-container[data-target="${modeSelect.id}"]`);
    modeWrapper?.classList.add("bf-assistant-mode-select");
    this.enhanceModeSelect(modeSelect, modeWrapper);
    this.showWelcome();
  }

  enhanceModeSelect(select, wrapper) {
    if (select?.__bfAccessibleCombobox) return;
    const trigger = wrapper?.querySelector(".custom-select-trigger");
    const options = wrapper?.querySelector(".custom-select-options");
    if (!trigger || !options) return;
    trigger.tabIndex = 0;
    trigger.setAttribute("role", "button");
    trigger.setAttribute("aria-haspopup", "listbox");
    options.id = `${select.id}-options`;
    options.setAttribute("role", "listbox");
    trigger.setAttribute("aria-controls", options.id);
    const syncAccessibility = () => {
      trigger.setAttribute("aria-expanded", String(wrapper.classList.contains("open")));
      options.querySelectorAll(".custom-option-item").forEach((item) => {
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(item.dataset.value === select.value));
      });
    };
    trigger.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        trigger.click();
      } else if (event.key === "Escape" && wrapper.classList.contains("open")) {
        event.preventDefault();
        document.dispatchEvent(new Event("click"));
        trigger.focus();
      }
    });
    select.addEventListener("change", syncAccessibility);
    options.addEventListener("click", () => queueMicrotask(syncAccessibility));
    const observer = new MutationObserver(syncAccessibility);
    observer.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
    syncAccessibility();
  }

  showWelcome() {
    this.sourceList = null;
    this.sourceKeys.clear();
    this.messages.replaceChildren();
    const welcome = make("div", "bf-assistant-welcome");
    welcome.append(make("div", "bf-assistant-welcome-mark", "✦"), make("h3", "", "Bạn muốn kiểm tra điều gì?"), make("p", "", "Mình chỉ đọc dữ liệu đã kiểm tra trong workspace hiện tại."));
    this.messages.appendChild(welcome);
  }

  toggle() { if (this.panel.hidden) this.open(); else this.close(); }
  open() {
    this.previousFocus = document.activeElement;
    this.panel.hidden = false;
    this.positionPanel();
    this.trigger.setAttribute("aria-expanded", "true");
    this.trigger.setAttribute("aria-label", "Đóng trợ lý BiddingFlow");
    if (!this.historyInitialized) {
      this.historyInitialized = true;
      this.historyReady = this.restoreLatestConversation();
    }
    this.input.focus();
  }
  close() {
    this.setHistoryOpen(false);
    this.panel.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.setAttribute("aria-label", "Mở trợ lý BiddingFlow");
    if (this.previousFocus instanceof HTMLElement && document.contains(this.previousFocus)) this.previousFocus.focus();
    else this.trigger.focus();
  }

  trapFocus(event) {
    if (event.key === "Escape" && this.historyPanel?.hidden === false) {
      event.preventDefault();
      event.stopPropagation();
      this.setHistoryOpen(false);
      this.historyButton?.focus();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...this.panel.querySelectorAll("button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex=\"-1\"])")]
      .filter((element) => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  setStatus(text) { if (this.status) this.status.textContent = text; }

  async setTargetHint(value) {
    const targetType = String(value?.targetType || "").trim();
    const targetId = String(value?.targetId || "").trim();
    const versionId = String(value?.versionId || targetId).trim();
    if (!["kehoach", "goithau"].includes(targetType) || !targetId || !versionId) return;
    this.targetHint = { targetType, targetId, versionId };
    if (this.mode !== "procurement_advice") {
      this.modeSelect.value = "procurement_advice";
      this.modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await this.historyReady;
    } else {
      await this.newConversation();
    }
    const label = this.targetChip?.querySelector(".bf-assistant-target-label");
    if (label) label.textContent = `${targetType === "goithau" ? "Gói thầu" : "Kế hoạch"} · ${versionId}`;
    if (this.targetChip) this.targetChip.hidden = false;
    this.open();
    this.setStatus("Target/version đã được ghim; server sẽ kiểm tra lại quyền khi gọi tool.");
  }

  clearTargetHint() {
    this.targetHint = null;
    if (this.targetChip) this.targetChip.hidden = true;
    this.showWelcome();
    this.setStatus("Đã bỏ target tuân thủ và kết quả cũ.");
  }

  setHistoryOpen(open) {
    if (!this.historyPanel || !this.historyButton) return;
    const next = Boolean(open);
    if (next) this.renderConversationHistory();
    this.historyPanel.hidden = !next;
    this.historyButton.setAttribute("aria-expanded", String(next));
  }

  renderConversationHistory() {
    if (!this.historyList) return;
    this.historyList.replaceChildren();
    const conversations = this.conversations.filter((item) => item?.id && item?.mode === this.mode);
    if (!conversations.length) {
      this.historyList.appendChild(make("p", "bf-assistant-history-empty", "Chưa có cuộc trò chuyện nào."));
      return;
    }
    conversations.forEach((conversation) => {
      const row = make("div", "bf-assistant-history-row");
      row.setAttribute("role", "listitem");
      const button = make("button", "bf-assistant-history-item");
      button.type = "button";
      button.dataset.conversationId = conversation.id;
      button.setAttribute("aria-current", String(conversation.id === this.conversationId));
      const title = make("span", "bf-assistant-history-item-title", conversation.title || "Cuộc trò chuyện chưa đặt tên");
      const time = make("span", "bf-assistant-history-item-time", formatConversationTime(
        conversation.updatedAt || conversation.updated_at || conversation.createdAt || conversation.created_at
      ));
      button.append(title, time);
      button.addEventListener("click", () => this.selectConversation(conversation.id));
      const deleteLabel = conversation.title || "Cuộc trò chuyện chưa đặt tên";
      const deleteButton = make("button", "bf-assistant-history-delete");
      deleteButton.type = "button";
      deleteButton.dataset.conversationId = conversation.id;
      deleteButton.setAttribute("aria-label", `Xóa cuộc trò chuyện ${deleteLabel}`);
      deleteButton.title = "Xóa cuộc trò chuyện";
      deleteButton.append(icon("trash-2"));
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.deleteConversation(conversation.id);
      });
      row.append(button, deleteButton);
      this.historyList.appendChild(row);
    });
    window.lucide?.createIcons?.({ root: this.historyList });
  }

  notify(title, message, type = "info") {
    this.controller?.view?.showToast?.(title, message, type);
  }

  async deleteConversation(conversationId) {
    const target = this.conversations.find((item) => item?.id === conversationId && item?.mode === this.mode);
    if (!target || this.abortController) return;
    const title = target.title || "Cuộc trò chuyện chưa đặt tên";
    const confirmationMessage = `Bạn có chắc muốn xóa cuộc trò chuyện "${title}" không? Toàn bộ tin nhắn trong cuộc trò chuyện này sẽ bị xóa khỏi lịch sử.`;
    let confirmed = false;
    if (typeof this.controller?.view?.customConfirm === "function") {
      confirmed = Boolean(await this.controller.view.customConfirm("Xóa lịch sử trợ lý", confirmationMessage, "trash-2"));
    } else if (typeof globalThis.confirm === "function") {
      confirmed = globalThis.confirm(confirmationMessage);
    }
    if (!confirmed) return;

    const wasCurrent = this.conversationId === conversationId;
    this.setStatus("Đang xóa cuộc trò chuyện…");
    try {
      await assistantApi.deleteConversation(conversationId);
      this.conversations = this.conversations.filter((item) => item?.id !== conversationId);
      if (wasCurrent && this.conversationId === conversationId) {
        this.conversationRequestId += 1;
        this.conversationId = "";
        this.showWelcome();
      }
      this.renderConversationHistory();
      this.setStatus("Đã xóa cuộc trò chuyện khỏi lịch sử.");
      this.notify("Đã xóa lịch sử", `Cuộc trò chuyện "${title}" đã được xóa.`, "success");
    } catch (error) {
      this.setStatus("Không thể xóa cuộc trò chuyện.");
      this.notify("Không thể xóa lịch sử", error?.message || "Vui lòng thử lại.", "error");
    }
  }

  async selectConversation(conversationId) {
    const target = this.conversations.find((item) => item?.id === conversationId && item?.mode === this.mode);
    if (!target || this.abortController) return;
    const requestId = ++this.conversationRequestId;
    this.setStatus("Đang tải cuộc trò chuyện…");
    try {
      const detail = await assistantApi.getConversation(conversationId);
      if (requestId !== this.conversationRequestId || target.mode !== this.mode) return;
      if (detail?.conversation?.mode && detail.conversation.mode !== this.mode) return;
      this.conversationId = conversationId;
      this.renderConversationMessages(detail?.messages || []);
      this.renderConversationHistory();
      this.setHistoryOpen(false);
      this.setStatus("Đã tải cuộc trò chuyện.");
      this.input?.focus();
    } catch (_) {
      if (requestId === this.conversationRequestId) this.setStatus("Không thể tải cuộc trò chuyện.");
    }
  }

  async changeMode(mode) {
    if (!MODES.some(([value]) => value === mode)) return;
    this.conversationRequestId += 1;
    this.mode = mode;
    this.conversationId = "";
    this.historyInitialized = true;
    this.setHistoryOpen(false);
    this.showWelcome();
    this.renderConversationHistory();
    this.setStatus(`Đang tải ${MODES.find(([value]) => value === mode)?.[1] || "chế độ mới"}…`);
    this.historyReady = this.restoreLatestConversation();
    await this.historyReady;
  }

  async newConversation() {
    this.stop();
    this.historyRequestId += 1;
    this.conversationRequestId += 1;
    this.historyReady = Promise.resolve();
    this.historyInitialized = true;
    this.conversationId = "";
    this.renderConversationHistory();
    this.setHistoryOpen(false);
    this.showWelcome();
    this.setStatus("Sẵn sàng cho cuộc trò chuyện mới.");
    this.input.focus();
  }

  async ensureConversation() {
    await this.historyReady;
    if (this.conversationId) return this.conversationId;
    const result = await assistantApi.createConversation(this.mode);
    this.conversationId = result.id;
    this.conversations = [
      { ...result, mode: result.mode || this.mode },
      ...this.conversations.filter((item) => item?.id !== result.id)
    ];
    this.renderConversationHistory();
    return this.conversationId;
  }

  rememberConversationTitle(conversationId, content) {
    const index = this.conversations.findIndex((item) => item?.id === conversationId);
    if (index < 0) return;
    const current = this.conversations[index];
    const updated = {
      ...current,
      title: current.title || String(content || "").slice(0, 120),
      updatedAt: new Date().toISOString()
    };
    this.conversations.splice(index, 1);
    this.conversations.unshift(updated);
    this.renderConversationHistory();
  }

  renderConversationMessages(messages = []) {
    this.sourceList = null;
    this.sourceKeys.clear();
    this.messages.replaceChildren();
    messages.forEach((message) => {
      if (!message || !["user", "assistant"].includes(message.role)) return;
      const rendered = this.addBubble(message.role, String(message.content || ""));
      if (message.role === "assistant" && message.id) {
        this.addFeedback(rendered.row, message.id, message.feedbackRating || message.feedback_rating || "");
      }
    });
    if (!this.messages.childElementCount) this.showWelcome();
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  async restoreLatestConversation() {
    const requestId = ++this.historyRequestId;
    const workspaceId = this.workspaceId;
    const mode = this.mode;
    try {
      const result = await assistantApi.listConversations();
      if (requestId !== this.historyRequestId || workspaceId !== this.workspaceId || mode !== this.mode) return;
      this.conversations = Array.isArray(result.items) ? result.items : [];
      this.renderConversationHistory();
      const latest = this.conversations.find((item) => item?.mode === mode && item?.id);
      if (!latest) {
        this.conversationId = "";
        this.setStatus("Sẵn sàng");
        return;
      }
      const conversationRequestId = ++this.conversationRequestId;
      const detail = await assistantApi.getConversation(latest.id);
      if (requestId !== this.historyRequestId || conversationRequestId !== this.conversationRequestId || workspaceId !== this.workspaceId || mode !== this.mode) return;
      if (detail?.conversation?.mode && detail.conversation.mode !== mode) return;
      this.conversationId = latest.id;
      this.renderConversationMessages(detail?.messages || []);
      this.renderConversationHistory();
      this.setStatus("Đã khôi phục cuộc trò chuyện gần nhất.");
    } catch (_) {
      if (requestId === this.historyRequestId) {
        this.historyInitialized = false;
        this.setStatus("Sẵn sàng");
      }
    }
  }

  addNotice(text) { const node = make("div", "bf-assistant-notice", text); this.messages.appendChild(node); this.messages.scrollTop = this.messages.scrollHeight; }

  addBubble(role, text = "") {
    const row = make("div", `bf-assistant-message bf-assistant-message-${role}`);
    const bubble = make("div", "bf-assistant-bubble", text);
    row.appendChild(bubble); this.messages.appendChild(row); this.messages.scrollTop = this.messages.scrollHeight;
    return { row, bubble };
  }

  renderToolResult(result) {
    if (!result) return;
    const card = make("section", "bf-assistant-result-card");
    const title = make("div", "bf-assistant-result-title", "Kết quả dữ liệu");
    const summary = make("div", "bf-assistant-result-summary");
    Object.entries(result.summary || {}).slice(0, 4).forEach(([key, value]) => {
      if (key === "widgets") return;
      const item = make("div", "bf-assistant-stat"); item.append(make("span", "bf-assistant-stat-label", key === "recordCount" ? "Bản ghi" : key === "value" ? "Giá trị" : key), make("strong", "bf-assistant-stat-value", typeof value === "object" ? JSON.stringify(value) : formatValue(value))); summary.appendChild(item);
    });
    card.append(title, summary);
    const compliance = result.records?.[0];
    if (compliance?.findings && compliance?.target) {
      title.textContent = "Kiểm tra tuân thủ xác định";
      const target = make("p", "bf-assistant-compliance-target", `${compliance.target.type} · ${compliance.target.exactVersionId}`);
      card.appendChild(target);
      compliance.findings.forEach((finding) => {
        const item = make("article", "bf-assistant-finding");
        item.dataset.result = finding.result || "";
        item.append(
          make("strong", "", `${finding.ruleId} · ${finding.result}`),
          make("span", "", `Mức: ${finding.severity}`),
          make("code", "", (finding.evidencePaths || []).join(" · ") || "Chưa có evidence path"),
        );
        card.appendChild(item);
      });
      if (compliance.notEvaluated?.length) {
        const unavailable = make("section", "bf-assistant-not-evaluated");
        unavailable.appendChild(make("strong", "", "Chưa đánh giá"));
        compliance.notEvaluated.forEach((item) => unavailable.appendChild(make("code", "", `${item.code}: ${item.reason}`)));
        card.appendChild(unavailable);
      }
    }
    if (result.filters && Object.keys(result.filters).length) {
      const filters = make("div", "bf-assistant-filter-row", "Bộ lọc");
      Object.entries(result.filters).forEach(([key, value]) => { if (value === null || value === "") return; filters.appendChild(make("span", "bf-assistant-filter", `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)); });
      card.appendChild(filters);
    }
    (compliance ? [] : result.records || []).slice(0, 20).forEach((record) => {
      const line = make("div", "bf-assistant-record");
      line.append(make("span", "bf-assistant-record-name", record.name || record.group || record.code || record.id), make("span", "bf-assistant-record-meta", record.value ? formatValue(record.value) : record.status || ""));
      const link = (result.sourceLinks || []).find((source) => source.url?.endsWith(`/${record.id}`));
      if (link?.url) { const anchor = make("a", "bf-assistant-record-link", "Mở"); anchor.href = link.url; line.appendChild(anchor); }
      card.appendChild(line);
    });
    const sources = make("div", "bf-assistant-source-row");
    (result.sourceLinks || []).slice(0, 5).forEach((source) => { if (!source?.url?.startsWith("/") || source.url.startsWith("//")) return; const anchor = make("a", "bf-assistant-source", source.label || "Nguồn"); anchor.href = source.url; sources.appendChild(anchor); });
    if (sources.childElementCount) card.appendChild(sources);
    this.messages.appendChild(card); this.messages.scrollTop = this.messages.scrollHeight;
  }

  renderSource(source) {
    const url = String(source?.url || "").trim();
    const title = String(source?.title || source?.label || "Nguồn pháp luật").trim();
    const isGenericGuideRoute = url === "/tong-quan"
      && (source?.documentType === "BIDDINGFLOW_HELP" || title === "Hướng dẫn sử dụng BiddingFlow");
    if (isGenericGuideRoute || !isSafeSourceUrl(url) || this.sourceKeys.has(url)) return;
    this.sourceKeys.add(url);
    const sourceTarget = this.activeMessage?.row || this.messages;
    if (!this.sourceList || !this.sourceList.isConnected || !sourceTarget.contains(this.sourceList)) {
      this.sourceList = make("section", "bf-assistant-source-list");
      this.sourceList.setAttribute("aria-label", "Nguồn tham khảo");
      sourceTarget.appendChild(this.sourceList);
    }
    const item = make("div", "bf-assistant-source-item");
    const anchor = make("a", "bf-assistant-source", title);
    anchor.href = url;
    if (isExternalSourceUrl(url)) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    item.appendChild(anchor);
    if (source.effectiveFrom) item.appendChild(make("span", "bf-assistant-source-meta", `Hiệu lực: ${source.effectiveFrom}`));
    this.sourceList.appendChild(item);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  async send(question = null, requestId = "") {
    if (this.abortController) return;
    const content = String(question ?? this.input.value ?? "").trim();
    if (!content) { this.input.focus(); return; }
    const clientRequestId = String(requestId || "").trim() || createAssistantRequestId();
    const operation = new AbortController();
    this.abortController = operation;
    this.sendButton.disabled = true;
    this.stopButton.hidden = false;
    this.setStatus("Đang chuẩn bị cuộc trò chuyện…");
    try {
      await this.historyReady;
      if (operation.signal.aborted || this.abortController !== operation) return;
      this.lastQuestion = content;
      this.lastRequestId = clientRequestId;
      this.input.value = "";
      this.sourceList = null;
      this.sourceKeys.clear();
      this.setStatus("Đang xử lý câu hỏi…");
      this.activeUserMessage = this.addBubble("user", content);
      const assistant = this.addBubble("assistant", "");
      this.activeMessage = assistant;
      const id = await this.ensureConversation();
      this.rememberConversationTitle(id, content);
      const response = await assistantApi.sendMessage(
        id,
        content,
        operation.signal,
        globalThis.location?.pathname || "/",
        clientRequestId,
        this.targetHint,
      );
      await consumeAssistantStream(response, (event) => this.onEvent(event), operation.signal);
    } catch (error) {
      if (error?.name !== "AbortError") this.showFailure(error?.message || "Không thể nhận câu trả lời.");
    } finally {
      if (this.abortController === operation) {
        this.abortController = null;
        this.sendButton.disabled = false;
        this.stopButton.hidden = true;
        this.activeMessage = null;
        this.activeUserMessage = null;
      }
    }
  }

  onEvent(event) {
    if (event.type === "source.added") this.renderSource(event.source);
    if (event.type === "message.started") this.setStatus("Đang xử lý câu hỏi…");
    if (event.type === "message.delta" && this.activeMessage) { this.activeMessage.bubble.textContent += String(event.delta || ""); this.messages.scrollTop = this.messages.scrollHeight; }
    if (event.type === "tool.started") this.setStatus("Đang kiểm tra dữ liệu được phân quyền…");
    if (event.type === "tool.completed") {
      this.setStatus(event.status === "completed" ? "Đã kiểm tra dữ liệu và nguồn." : "Không thể hoàn tất truy vấn dữ liệu.");
      if (
        event.status === "completed"
        && event.result?.records?.[0]?.findings
      ) this.renderToolResult(event.result);
    }
    if (event.type === "source.added") this.setStatus("Đã thêm nguồn kiểm chứng.");
    if (event.type === "message.completed" && this.activeMessage) {
      this.setStatus("Đã hoàn tất câu trả lời.");
      this.addFeedback(this.activeMessage.row, event.messageId);
    }
    if (event.type === "message.failed") this.showFailure(event.message || "Trợ lý không thể hoàn thành yêu cầu.", event.code);
  }

  addFeedback(row, messageId, initialRating = "") {
    if (!messageId || row.querySelector(".bf-assistant-feedback")) return;
    const controls = make("div", "bf-assistant-feedback");
    const definitions = [["up", "thumbs-up", "Hữu ích"], ["down", "thumbs-down", "Chưa đúng"]];
    const buttons = new Map();
    let selectedRating = ["up", "down"].includes(initialRating) ? initialRating : "";
    const syncState = () => {
      buttons.forEach((button, rating) => {
        const selected = rating === selectedRating;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    };
    definitions.forEach(([rating, iconName, label]) => {
      const button = make("button", "bf-assistant-feedback-button");
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.setAttribute("aria-pressed", "false");
      button.append(icon(iconName));
      buttons.set(rating, button);
      button.addEventListener("click", async () => {
        const nextRating = selectedRating === rating ? "" : rating;
        buttons.forEach((item) => { item.disabled = true; });
        try {
          if (nextRating) {
            await assistantApi.feedback(messageId, nextRating, nextRating === "up" ? "correct" : "not_helpful");
          } else {
            await assistantApi.clearFeedback(messageId);
          }
          selectedRating = nextRating;
          syncState();
        } catch (_) {
          // Keep the previous selection when persistence fails.
        } finally {
          buttons.forEach((item) => { item.disabled = false; });
        }
      });
      controls.appendChild(button);
    });
    syncState();
    row.appendChild(controls);
    window.lucide?.createIcons?.({ root: controls });
  }

  showFailure(message, code = "") {
    this.setStatus("Có lỗi khi xử lý câu hỏi.");
    const failedUserRow = this.activeUserMessage?.row || null;
    this.activeMessage?.row?.remove();
    const failure = make("div", "bf-assistant-error"); failure.append(make("span", "", message));
    if (this.lastQuestion) {
      const retryQuestion = this.lastQuestion;
      const retryRequestId = this.lastRequestId;
      const retry = make("button", "bf-assistant-retry", "Thử lại");
      retry.type = "button";
      retry.addEventListener("click", () => {
        failure.remove();
        failedUserRow?.remove();
        this.send(retryQuestion, retryRequestId);
      });
      failure.appendChild(retry);
    }
    if (code === "AI_DISABLED") this.addNotice("Trợ lý hiện đang tắt theo cấu hình hệ thống.");
    this.messages.appendChild(failure); this.messages.scrollTop = this.messages.scrollHeight;
  }

  stop() { this.abortController?.abort(); }

  resetForWorkspace() {
    const restoreNow = this.panel?.hidden === false;
    this.stop();
    this.historyRequestId += 1;
    this.conversationRequestId += 1;
    this.workspaceId = getActiveOrganizationId();
    this.targetHint = null;
    if (this.targetChip) this.targetChip.hidden = true;
    this.conversationId = "";
    this.conversations = [];
    this.historyReady = Promise.resolve();
    this.historyInitialized = restoreNow;
    const workspace = this.panel?.querySelector(".bf-assistant-workspace"); if (workspace) workspace.textContent = activeWorkspaceName(this.controller);
    this.setHistoryOpen(false);
    this.renderConversationHistory();
    this.showWelcome();
    if (restoreNow) this.historyReady = this.restoreLatestConversation();
  }
}
