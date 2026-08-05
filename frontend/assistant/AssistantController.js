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
    window.addEventListener("bf:workspace-changed", () => this.resetForWorkspace());
    window.addEventListener("popstate", () => this.loadSuggestions());
    this.loadSuggestions();
    window.lucide?.createIcons?.({ root: this.panel });
  }

  buildPanel() {
    const header = make("div", "bf-assistant-header");
    const heading = make("div", "bf-assistant-heading");
    heading.append(make("span", "bf-assistant-eyebrow", "BiddingFlow AI"), make("h2", "bf-assistant-title", "Trợ lý đấu thầu"));
    const close = make("button", "bf-assistant-icon-button");
    close.type = "button"; close.setAttribute("aria-label", "Đóng trợ lý"); close.append(icon("x")); close.addEventListener("click", () => this.close());
    header.append(heading, close);

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
    this.panel.append(header, context, this.status, this.messages, this.suggestions, this.composer);
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
    welcome.append(make("div", "bf-assistant-welcome-mark", "✦"), make("h3", "", "Bạn muốn kiểm tra điều gì?"), make("p", "", "Mình chỉ đọc dữ liệu trong workspace hiện tại và trả lời trực tiếp từ số liệu đã được kiểm tra."));
    this.messages.appendChild(welcome);
  }

  toggle() { if (this.panel.hidden) this.open(); else this.close(); }
  open() {
    this.previousFocus = document.activeElement;
    this.panel.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    this.trigger.setAttribute("aria-label", "Đóng trợ lý BiddingFlow");
    this.input.focus();
  }
  close() {
    this.panel.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.setAttribute("aria-label", "Mở trợ lý BiddingFlow");
    if (this.previousFocus instanceof HTMLElement && document.contains(this.previousFocus)) this.previousFocus.focus();
    else this.trigger.focus();
  }

  trapFocus(event) {
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

  async changeMode(mode) {
    if (!MODES.some(([value]) => value === mode)) return;
    this.mode = mode; this.conversationId = ""; this.showWelcome();
    this.addNotice(`Đã chuyển sang ${MODES.find(([value]) => value === mode)?.[1] || "chế độ mới"}. Cuộc trò chuyện được tách riêng.`);
  }

  async newConversation() {
    this.stop();
    const previousConversationId = this.conversationId;
    this.conversationId = "";
    if (previousConversationId) {
      try { await assistantApi.deleteConversation(previousConversationId); } catch (_) { /* The next conversation remains isolated. */ }
    }
    this.showWelcome();
    await this.loadSuggestions();
    this.input.focus();
  }

  async ensureConversation() {
    if (this.conversationId) return this.conversationId;
    const result = await assistantApi.createConversation(this.mode);
    this.conversationId = result.id;
    return this.conversationId;
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
    this.lastQuestion = content; this.input.value = "";
    this.setStatus("Đang xử lý câu hỏi…");
    this.addBubble("user", content);
    const assistant = this.addBubble("assistant", ""); this.activeMessage = assistant;
    this.abortController = new AbortController(); this.sendButton.disabled = true; this.stopButton.hidden = false;
    try {
      const id = await this.ensureConversation();
      const response = await assistantApi.sendMessage(id, content, this.abortController.signal);
      await consumeAssistantStream(response, (event) => this.onEvent(event), this.abortController.signal);
    } catch (error) {
      if (error?.name !== "AbortError") this.showFailure(error?.message || "Không thể nhận câu trả lời.");
    } finally {
      this.abortController = null; this.sendButton.disabled = false; this.stopButton.hidden = true; this.activeMessage = null;
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
    this.workspaceId = getActiveOrganizationId(); this.conversationId = ""; this.stop();
    const workspace = this.panel?.querySelector(".bf-assistant-workspace"); if (workspace) workspace.textContent = activeWorkspaceName(this.controller);
    this.showWelcome(); this.loadSuggestions();
  }

  async loadSuggestions() {
    try { const result = await assistantApi.getSuggestedQuestions(window.location.pathname); this.suggestions.replaceChildren(); (result.items || []).forEach((item) => { const button = make("button", "bf-assistant-suggestion", item.label || item.question); button.type = "button"; button.addEventListener("click", () => this.send(item.question)); this.suggestions.appendChild(button); }); } catch (_) { this.suggestions.replaceChildren(); }
  }
}
