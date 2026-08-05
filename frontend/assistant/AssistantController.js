import { assistantApi, consumeAssistantStream } from "./AssistantApi.js";
import { getActiveOrganizationId } from "../app/workspaceState.js";
import { initCustomSelect } from "../shared/view_helpers.js";

const MODES = [
  ["data", "Dữ liệu BiddingFlow"],
  ["procurement_advice", "Tư vấn đấu thầu"],
  ["app_help", "Hướng dẫn ứng dụng"]
];

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
    this.activeMessage = null;
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
  }

  mount() {
    if (document.getElementById("bf-assistant-trigger")) return;
    this.trigger = make("button", "bf-assistant-trigger");
    this.trigger.id = "bf-assistant-trigger";
    this.trigger.type = "button";
    this.trigger.setAttribute("aria-label", "Mở trợ lý BiddingFlow");
    this.trigger.setAttribute("aria-controls", "bf-assistant-panel");
    this.trigger.setAttribute("aria-expanded", "false");
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

    this.panel = make("aside", "bf-assistant-panel");
    this.panel.id = "bf-assistant-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    this.panel.setAttribute("aria-label", "Trợ lý BiddingFlow");
    this.panel.setAttribute("aria-live", "off");
    this.panel.hidden = true;
    document.body.appendChild(this.panel);
    this.buildPanel();
    this.trigger.addEventListener("click", () => this.toggle());
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
    window.addEventListener("popstate", () => this.loadSuggestions());
    this.loadSuggestions();
    window.lucide?.createIcons?.({ root: this.panel });
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
    modeSelect.id = "bf-assistant-mode-select";
    modeSelect.dataset.dropdownInline = "true";
    modeSelect.setAttribute("aria-label", "Chế độ trợ lý");
    MODES.forEach(([value, label]) => { const option = make("option", "", label); option.value = value; modeSelect.appendChild(option); });
    modeSelect.value = this.mode;
    modeSelect.addEventListener("change", () => this.changeMode(modeSelect.value));
    context.append(modeSelect);

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
    this.suggestions = make("div", "bf-assistant-suggestions");
    this.composer = make("form", "bf-assistant-composer");
    this.composer.setAttribute("aria-label", "Gửi câu hỏi cho trợ lý");
    this.input = make("textarea", "bf-assistant-input");
    this.input.rows = 2; this.input.maxLength = 4000; this.input.placeholder = "Hỏi về dữ liệu, quy trình hoặc cách dùng BiddingFlow…";
    this.input.setAttribute("aria-label", "Nội dung câu hỏi");
    this.input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.send(); } });
    const actions = make("div", "bf-assistant-composer-actions");
    this.clearButton = make("button", "bf-assistant-clear", "Cuộc trò chuyện mới"); this.clearButton.type = "button"; this.clearButton.addEventListener("click", () => this.newConversation());
    this.stopButton = make("button", "bf-assistant-stop", "Dừng"); this.stopButton.type = "button"; this.stopButton.hidden = true; this.stopButton.addEventListener("click", () => this.stop());
    this.sendButton = make("button", "bf-assistant-send"); this.sendButton.type = "submit"; this.sendButton.setAttribute("aria-label", "Gửi câu hỏi"); this.sendButton.append(icon("arrow-up"));
    actions.append(this.clearButton, this.stopButton, this.sendButton);
    this.composer.append(this.input, actions);
    this.composer.addEventListener("submit", (event) => { event.preventDefault(); this.send(); });
    this.panel.append(header, context, this.historyPanel, this.status, this.messages, this.suggestions, this.composer);
    initCustomSelect(modeSelect.id);
    const modeWrapper = this.panel.querySelector(`.custom-select-container[data-target="${modeSelect.id}"]`);
    modeWrapper?.classList.add("bf-assistant-mode-select");
    this.enhanceModeSelect(modeSelect, modeWrapper);
    this.showWelcome();
  }

  enhanceModeSelect(select, wrapper) {
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
    this.messages.replaceChildren();
    const welcome = make("div", "bf-assistant-welcome");
    welcome.append(make("div", "bf-assistant-welcome-mark", "✦"), make("h3", "", "Bạn muốn kiểm tra điều gì?"), make("p", "", "Mình chỉ đọc dữ liệu đã kiểm tra trong workspace hiện tại."));
    this.messages.appendChild(welcome);
  }

  toggle() { if (this.panel.hidden) this.open(); else this.close(); }
  open() {
    this.previousFocus = document.activeElement;
    this.panel.hidden = false;
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
      row.appendChild(button);
      this.historyList.appendChild(row);
    });
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
    await this.loadSuggestions();
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
    this.messages.replaceChildren();
    messages.forEach((message) => {
      if (!message || !["user", "assistant"].includes(message.role)) return;
      const rendered = this.addBubble(message.role, String(message.content || ""));
      if (message.role === "assistant" && message.id) this.addFeedback(rendered.row, message.id);
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
    if (result.filters && Object.keys(result.filters).length) {
      const filters = make("div", "bf-assistant-filter-row", "Bộ lọc");
      Object.entries(result.filters).forEach(([key, value]) => { if (value === null || value === "") return; filters.appendChild(make("span", "bf-assistant-filter", `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)); });
      card.appendChild(filters);
    }
    (result.records || []).slice(0, 20).forEach((record) => {
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

  async send(question = null) {
    if (this.abortController) return;
    const content = String(question ?? this.input.value ?? "").trim();
    if (!content) { this.input.focus(); return; }
    const operation = new AbortController();
    this.abortController = operation;
    this.sendButton.disabled = true;
    this.stopButton.hidden = false;
    this.setStatus("Đang chuẩn bị cuộc trò chuyện…");
    try {
      await this.historyReady;
      if (operation.signal.aborted || this.abortController !== operation) return;
      this.lastQuestion = content;
      this.input.value = "";
      this.setStatus("Đang xử lý câu hỏi…");
      this.addBubble("user", content);
      const assistant = this.addBubble("assistant", "");
      this.activeMessage = assistant;
      const id = await this.ensureConversation();
      this.rememberConversationTitle(id, content);
      const response = await assistantApi.sendMessage(id, content, operation.signal);
      await consumeAssistantStream(response, (event) => this.onEvent(event), operation.signal);
    } catch (error) {
      if (error?.name !== "AbortError") this.showFailure(error?.message || "Không thể nhận câu trả lời.");
    } finally {
      if (this.abortController === operation) {
        this.abortController = null;
        this.sendButton.disabled = false;
        this.stopButton.hidden = true;
        this.activeMessage = null;
      }
    }
  }

  onEvent(event) {
    if (event.type === "message.started") this.setStatus("Đang xử lý câu hỏi…");
    if (event.type === "message.delta" && this.activeMessage) { this.activeMessage.bubble.textContent += String(event.delta || ""); this.messages.scrollTop = this.messages.scrollHeight; }
    if (event.type === "tool.started") this.setStatus("Đang kiểm tra dữ liệu được phân quyền…");
    if (event.type === "tool.completed") {
      this.setStatus(event.status === "completed" ? "Đã kiểm tra dữ liệu và nguồn." : "Không thể hoàn tất truy vấn dữ liệu.");
    }
    if (event.type === "source.added") this.setStatus("Đã thêm nguồn kiểm chứng.");
    if (event.type === "message.completed" && this.activeMessage) {
      this.setStatus("Đã hoàn tất câu trả lời.");
      this.addFeedback(this.activeMessage.row, event.messageId);
    }
    if (event.type === "message.failed") this.showFailure(event.message || "Trợ lý không thể hoàn thành yêu cầu.", event.code);
  }

  addFeedback(row, messageId) {
    if (!messageId || row.querySelector(".bf-assistant-feedback")) return;
    const controls = make("div", "bf-assistant-feedback");
    [["up", "thumbs-up", "Hữu ích"], ["down", "thumbs-down", "Chưa đúng"]].forEach(([rating, iconName, label]) => { const button = make("button", "bf-assistant-feedback-button"); button.type = "button"; button.setAttribute("aria-label", label); button.append(icon(iconName)); button.addEventListener("click", async () => { button.disabled = true; try { await assistantApi.feedback(messageId, rating, rating === "up" ? "correct" : "not_helpful"); button.classList.add("is-selected"); } catch (_) { button.disabled = false; } }); controls.appendChild(button); });
    controls.querySelectorAll('button').forEach((button) => {
      button.title = button.getAttribute('aria-label') || '';
    });
    row.appendChild(controls);
    window.lucide?.createIcons?.({ root: controls });
  }

  showFailure(message, code = "") {
    this.setStatus("Có lỗi khi xử lý câu hỏi.");
    const failure = make("div", "bf-assistant-error"); failure.append(make("span", "", message));
    if (this.lastQuestion) { const retry = make("button", "bf-assistant-retry", "Thử lại"); retry.type = "button"; retry.addEventListener("click", () => { failure.remove(); this.send(this.lastQuestion); }); failure.appendChild(retry); }
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
    this.conversationId = "";
    this.conversations = [];
    this.historyReady = Promise.resolve();
    this.historyInitialized = restoreNow;
    const workspace = this.panel?.querySelector(".bf-assistant-workspace"); if (workspace) workspace.textContent = activeWorkspaceName(this.controller);
    this.setHistoryOpen(false);
    this.renderConversationHistory();
    this.showWelcome();
    this.loadSuggestions();
    if (restoreNow) this.historyReady = this.restoreLatestConversation();
  }

  async loadSuggestions() {
    try { const result = await assistantApi.getSuggestedQuestions(window.location.pathname); this.suggestions.replaceChildren(); (result.items || []).forEach((item) => { const button = make("button", "bf-assistant-suggestion", item.label || item.question); button.type = "button"; button.addEventListener("click", () => this.send(item.question)); this.suggestions.appendChild(button); }); } catch (_) { this.suggestions.replaceChildren(); }
  }
}
