import { apiFetch } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { renderLucideIcons } from "../shared/lucideIcons.js";

// Workspace productivity tools, loaded after the first interaction:
// global search (Ctrl+K or "/"), keyboard shortcuts, the getting-started
// checklist and the deadline & reminder center. Everything here reads data the
// user already has in this workspace (or the authorized /api/deadlines
// projection); nothing changes what a user may see.

const STYLESHEET_URL = new URL("./WorkspaceTools.css?no-inline", import.meta.url).pathname;
const SEARCH_LIMIT = 30;
const REMINDER_CHECK_MS = 60_000;

const SEARCH_SOURCES = Object.freeze([
  { table: "goithau", label: "Gói thầu", code: "maGoiThau", name: "tenGoiThau", command: "showPackageDetails", icon: "package" },
  { table: "kehoach", label: "Kế hoạch", code: "maKeHoach", name: "tenKeHoach", command: "showKeHoachDetails", icon: "clipboard-list" },
  { table: "hopdong", label: "Hợp đồng", code: "soHopDong", name: "tenHopDong", command: "showHopDongDetails", icon: "file-signature" },
  { table: "chudautu", label: "Chủ đầu tư", code: "maSoThue", name: "tenChuDauTu", command: "showChuDauTuDetails", icon: "building-2" },
  { table: "nhathau", label: "Nhà thầu", code: "maSoThue", name: "tenNhaThau", command: "showNhaThauDetails", icon: "hard-hat" },
  { table: "chuyengia", label: "Chuyên gia", code: "soChungChi", name: "hoTen", command: "showChuyenGiaDetails", icon: "user-round" },
]);

const NAVIGATION = Object.freeze([
  { tab: "dashboard", label: "Tổng quan", keywords: "tong quan dashboard" },
  { tab: "kehoach", label: "Kế hoạch LCNT", keywords: "ke hoach lcnt" },
  { tab: "goithau", label: "Gói thầu", keywords: "goi thau" },
  { tab: "goithau-timeline", label: "Timeline gói thầu", keywords: "timeline tien do" },
  { tab: "hopdong", label: "Hợp đồng", keywords: "hop dong" },
  { tab: "chudautu", label: "Chủ đầu tư", keywords: "chu dau tu" },
  { tab: "nhathau", label: "Nhà thầu", keywords: "nha thau" },
  { tab: "chuyengia", label: "Chuyên gia", keywords: "chuyen gia" },
  { tab: "xuatban-word", label: "Xuất bản Word", keywords: "word mau xuat ban" },
  { tab: "profile", label: "Trang cá nhân", keywords: "ca nhan profile tai khoan" },
]);

export function foldText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ")
    .trim();
}

function isLatest(record) {
  if (!record || record.archivedAt) return false;
  return !(record.isLatest === 0 || record.isLatest === false || record.isLatest === "0");
}

/** Rank workspace records against a query (pure, used by tests). */
export function searchWorkspace(state, query, { limit = SEARCH_LIMIT } = {}) {
  const needle = foldText(query);
  if (!needle) return [];
  const terms = needle.split(" ");
  const results = [];
  for (const source of SEARCH_SOURCES) {
    const seen = new Set();
    for (const record of state?.[source.table] || []) {
      if (!isLatest(record)) continue;
      const rootId = String(record.idGoc || record.id_goc || record.id || "");
      if (!rootId || seen.has(rootId)) continue;
      const code = foldText(record[source.code]);
      const name = foldText(record[source.name]);
      const haystack = `${code} ${name}`;
      if (!terms.every((term) => haystack.includes(term))) continue;
      seen.add(rootId);
      let score = 3;
      if (code && code === needle) score = 0;
      else if (code && code.startsWith(needle)) score = 1;
      else if (name.startsWith(needle)) score = 2;
      results.push({
        kind: "record",
        source,
        id: String(record.id),
        code: String(record[source.code] || ""),
        name: String(record[source.name] || ""),
        score,
      });
    }
  }
  results.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "vi"));
  return results.slice(0, limit);
}

function navigationMatches(query) {
  const needle = foldText(query);
  return NAVIGATION.filter((item) => !needle || foldText(`${item.label} ${item.keywords}`).includes(needle))
    .map((item) => ({ kind: "page", ...item }));
}

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const node = document.createElement("i");
  node.setAttribute("data-lucide", name);
  node.setAttribute("aria-hidden", "true");
  return node;
}

/* ----------------------------- Global search ----------------------------- */

function createSearchDialog(controller) {
  const dialog = element("dialog", "bf-tools-dialog bf-search-dialog");
  dialog.setAttribute("aria-label", "Tìm kiếm nhanh");
  const field = element("div", "bf-search-field");
  field.append(icon("search"));
  const input = element("input", "bf-search-input");
  input.type = "search";
  input.placeholder = "Tìm gói thầu, kế hoạch, hợp đồng, nhà thầu… (mã, tên, MST)";
  input.setAttribute("aria-label", "Từ khóa tìm kiếm");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", "bf-search-results");
  input.autocomplete = "off";
  field.append(input);
  const list = element("ul", "bf-search-results");
  list.id = "bf-search-results";
  list.setAttribute("role", "listbox");
  const hint = element("p", "bf-search-hint", "↑ ↓ để chọn · Enter để mở · Esc để đóng · Dữ liệu tìm trong không gian làm việc hiện tại");
  dialog.append(field, list, hint);
  document.body.append(dialog);

  let items = [];
  let active = 0;
  const choose = async (item) => {
    dialog.close();
    if (!item) return;
    if (item.kind === "page") return controller.switchTab?.(item.tab);
    return controller.executeCommand?.(item.source.command, item.id);
  };
  const render = () => {
    const query = input.value;
    items = [...searchWorkspace(controller.model?.state, query), ...navigationMatches(query)].slice(0, SEARCH_LIMIT + NAVIGATION.length);
    active = Math.min(active, Math.max(0, items.length - 1));
    list.replaceChildren();
    if (!items.length) {
      list.append(element("li", "bf-search-empty", "Không tìm thấy kết quả phù hợp."));
      input.removeAttribute("aria-activedescendant");
      return;
    }
    items.forEach((item, index) => {
      const row = element("li", "bf-search-result");
      row.id = `bf-search-option-${index}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === active));
      row.append(icon(item.kind === "page" ? "arrow-right" : item.source.icon));
      const text = element("span", "bf-search-result-text");
      text.append(element("strong", "", item.kind === "page" ? item.label : (item.name || item.code || "(Không tên)")));
      text.append(element("small", "", item.kind === "page" ? "Mở trang" : [item.source.label, item.code].filter(Boolean).join(" · ")));
      row.append(text);
      row.addEventListener("mousedown", (event) => { event.preventDefault(); void choose(item); });
      list.append(row);
    });
    input.setAttribute("aria-activedescendant", `bf-search-option-${active}`);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
    renderLucideIcons(list);
  };
  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); active = Math.min(items.length - 1, active + 1); render(); }
    if (event.key === "ArrowUp") { event.preventDefault(); active = Math.max(0, active - 1); render(); }
    if (event.key === "Enter") { event.preventDefault(); void choose(items[active]); }
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  renderLucideIcons(dialog);
  return {
    open() {
      if (dialog.open) return;
      input.value = "";
      active = 0;
      render();
      dialog.showModal();
      input.focus();
    },
  };
}

/* ---------------------------- Keyboard shortcuts ---------------------------- */

const SHORTCUTS = Object.freeze([
  ["Ctrl + K", "Tìm kiếm nhanh mọi bản ghi"],
  ["/", "Tìm kiếm nhanh (khi không đang nhập liệu)"],
  ["Ctrl + S", "Lưu biểu mẫu đang mở"],
  ["Shift + H", "Mở trung tâm hạn chót"],
  ["?", "Xem danh sách phím tắt"],
  ["Esc", "Đóng hộp thoại"],
]);

function createShortcutDialog() {
  const dialog = element("dialog", "bf-tools-dialog bf-shortcut-dialog");
  dialog.setAttribute("aria-labelledby", "bf-shortcut-title");
  const title = element("h2", "", "Phím tắt");
  title.id = "bf-shortcut-title";
  const table = element("dl", "bf-shortcut-list");
  for (const [keys, description] of SHORTCUTS) {
    table.append(element("dt", "", keys), element("dd", "", description));
  }
  const close = element("button", "btn btn-outline", "Đóng");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  dialog.append(title, table, close);
  document.body.append(dialog);
  return { open: () => { if (!dialog.open) dialog.showModal(); } };
}

/** Find the primary save control of the active modal (pure DOM lookup). */
export function findActiveModalSaveButton(root = document) {
  const modals = [...root.querySelectorAll(".modal-overlay.active")];
  const modal = modals[modals.length - 1];
  if (!modal) return null;
  const candidates = [
    ...modal.querySelectorAll('[data-shortcut-save], button[type="submit"]:not([disabled]), .modal-footer .btn-primary:not([disabled])'),
  ].filter((button) => !button.disabled && button.getClientRects?.().length !== 0);
  return candidates[0] || null;
}

function installShortcuts({ search, shortcuts, deadlines }) {
  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = String(event.key || "").toLowerCase();
    if (mod && !event.altKey && key === "k") {
      event.preventDefault();
      search.open();
      return;
    }
    if (mod && !event.altKey && key === "s") {
      const save = findActiveModalSaveButton();
      if (save) {
        event.preventDefault();
        save.click();
      }
      return;
    }
    if (mod || event.altKey || isEditableTarget(event.target) || document.querySelector("dialog[open]")) return;
    if (event.key === "/") { event.preventDefault(); search.open(); return; }
    if (event.key === "?") { event.preventDefault(); shortcuts.open(); return; }
    if (event.shiftKey && key === "h") { event.preventDefault(); deadlines.open(); }
  });
}

/* --------------------------- Deadline & reminders --------------------------- */

function reminderStorageKey(controller) {
  const scope = String(controller.model?.workspaceScope?.key || "").trim();
  return scope ? `bf_deadline_reminders:${scope}` : "";
}

export function readReminders(storage, key) {
  if (!key) return {};
  try {
    const parsed = JSON.parse(storage?.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeReminders(storage, key, reminders) {
  if (!key) return;
  try { storage?.setItem(key, JSON.stringify(reminders)); } catch { /* per-browser convenience only */ }
}

/** Epoch ms at which a reminder with `leadDays` should fire for a due date. */
export function reminderFireAt(dueDate, leadDays) {
  const [year, month, day] = String(dueDate || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day - Number(leadDays || 0), 8, 0, 0).getTime();
}

export function bucketDeadline(dueDate, now = new Date()) {
  if (!dueDate) return "later";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [year, month, day] = dueDate.split("-").map(Number);
  const due = new Date(year, month - 1, day).getTime();
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= today + 7 * 86_400_000) return "week";
  return "later";
}

const BUCKETS = Object.freeze([
  ["overdue", "Quá hạn"],
  ["today", "Hôm nay"],
  ["week", "Trong 7 ngày tới"],
  ["later", "Sau đó"],
]);

function formatDue(dueDate) {
  if (!dueDate) return "Chưa có ngày";
  const [year, month, day] = dueDate.split("-");
  return `${day}/${month}/${year}`;
}

async function downloadCalendar(controller) {
  const response = await apiFetch("/api/deadlines/calendar.ics");
  if (!response.ok) throw new Error("Không thể tạo tệp lịch.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "biddingflow-han-chot.ics";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  controller.view?.showToast?.("Đã tải lịch", "Mở tệp .ics để thêm hạn chót vào Google Calendar/Outlook (kèm nhắc trước 1 ngày).", "success");
}

function createDeadlineCenter(controller) {
  const dialog = element("dialog", "bf-tools-dialog bf-deadline-dialog");
  dialog.setAttribute("aria-labelledby", "bf-deadline-title");
  const header = element("div", "bf-deadline-header");
  const title = element("h2", "", "Hạn chót & nhắc việc");
  title.id = "bf-deadline-title";
  const actions = element("div", "bf-deadline-actions");
  const calendarButton = element("button", "btn btn-outline", "Tải lịch (.ics)");
  calendarButton.type = "button";
  const notifyButton = element("button", "btn btn-outline", "Bật thông báo trình duyệt");
  notifyButton.type = "button";
  const closeButton = element("button", "btn btn-outline", "Đóng");
  closeButton.type = "button";
  actions.append(calendarButton, notifyButton, closeButton);
  header.append(title, actions);
  const status = element("p", "bf-deadline-status");
  status.setAttribute("role", "status");
  const body = element("div", "bf-deadline-body");
  dialog.append(header, status, body);
  document.body.append(dialog);

  const storage = globalThis.localStorage;
  let items = [];
  let lastLoaded = 0;

  const updateBadge = () => {
    const badge = document.getElementById("bf-deadline-badge");
    if (!badge) return;
    const urgent = items.filter((item) => ["overdue", "today"].includes(bucketDeadline(item.dueDate))).length;
    badge.textContent = String(urgent);
    badge.hidden = urgent === 0;
  };

  const load = async ({ force = false } = {}) => {
    if (!force && Date.now() - lastLoaded < 5 * 60_000) return items;
    const response = await apiFetch("/api/deadlines");
    if (!response.ok) throw new Error("Không thể tải danh sách hạn chót.");
    const payload = await response.json();
    items = Array.isArray(payload.items) ? payload.items : [];
    lastLoaded = Date.now();
    updateBadge();
    return items;
  };

  const render = () => {
    const reminders = readReminders(storage, reminderStorageKey(controller));
    body.replaceChildren();
    if (!items.length) {
      body.append(element("p", "bf-deadline-empty", "Không có hạn chót nào cần chú ý. Danh sách gồm mốc đóng/mở thầu, báo cáo đánh giá, đăng tải kế hoạch và hạn hợp đồng bạn được phép xem."));
      return;
    }
    for (const [bucket, label] of BUCKETS) {
      const rows = items.filter((item) => bucketDeadline(item.dueDate) === bucket);
      if (!rows.length) continue;
      const section = element("section", `bf-deadline-group bf-deadline-${bucket}`);
      section.append(element("h3", "", `${label} (${rows.length})`));
      const list = element("ul", "bf-deadline-list");
      for (const item of rows) {
        const row = element("li", "bf-deadline-item");
        const text = element("div", "bf-deadline-text");
        text.append(element("strong", "", item.code ? `${item.code} – ${item.label}` : item.label));
        text.append(element("span", "", [item.name, item.detail].filter(Boolean).join(" · ")));
        text.append(element("small", "", `Hạn: ${formatDue(item.dueDate)}`));
        const controls = element("div", "bf-deadline-controls");
        const open = element("button", "btn btn-outline", "Mở");
        open.type = "button";
        open.addEventListener("click", () => {
          dialog.close();
          const command = { package: "showPackageDetails", plan: "showKeHoachDetails", contract: "showHopDongDetails" }[item.targetType];
          if (command) controller.executeCommand?.(command, item.targetId);
        });
        const select = element("select", "bf-deadline-remind");
        select.setAttribute("aria-label", `Nhắc việc cho ${item.code || item.label}`);
        for (const [value, text_] of [["", "Không nhắc"], ["0", "Nhắc sáng ngày đến hạn"], ["1", "Nhắc trước 1 ngày"], ["3", "Nhắc trước 3 ngày"], ["7", "Nhắc trước 7 ngày"]]) {
          const option = element("option", "", text_);
          option.value = value;
          select.append(option);
        }
        const existing = reminders[item.id];
        select.value = existing ? String(existing.leadDays) : "";
        select.disabled = !item.dueDate;
        select.addEventListener("change", () => {
          const key = reminderStorageKey(controller);
          const next = readReminders(storage, key);
          if (select.value === "") delete next[item.id];
          else next[item.id] = { leadDays: Number(select.value), dueDate: item.dueDate, title: text.firstChild.textContent, firedFor: null };
          writeReminders(storage, key, next);
          status.textContent = select.value === "" ? "Đã tắt nhắc việc." : "Đã đặt nhắc việc trên trình duyệt này.";
        });
        controls.append(select, open);
        row.append(text, controls);
        list.append(row);
      }
      section.append(list);
      body.append(section);
    }
  };

  const checkReminders = () => {
    const key = reminderStorageKey(controller);
    const reminders = readReminders(storage, key);
    const now = Date.now();
    let changed = false;
    for (const [id, reminder] of Object.entries(reminders)) {
      const fireAt = reminderFireAt(reminder.dueDate, reminder.leadDays);
      if (!fireAt || now < fireAt || reminder.firedFor === reminder.dueDate) continue;
      reminder.firedFor = reminder.dueDate;
      changed = true;
      const message = `${reminder.title} – hạn ${formatDue(reminder.dueDate)}`;
      controller.view?.showToast?.("Nhắc việc", message, "warning", { duration: 10_000 });
      if (globalThis.Notification?.permission === "granted") {
        try { new globalThis.Notification("BiddingFlow – Nhắc việc", { body: message, tag: `bf-${id}` }); } catch { /* optional */ }
      }
    }
    if (changed) writeReminders(storage, key, reminders);
  };

  calendarButton.addEventListener("click", () => {
    downloadCalendar(controller).catch((error) => { status.textContent = error.message; });
  });
  notifyButton.addEventListener("click", async () => {
    if (!globalThis.Notification) { status.textContent = "Trình duyệt không hỗ trợ thông báo."; return; }
    const permission = await globalThis.Notification.requestPermission();
    status.textContent = permission === "granted"
      ? "Đã bật thông báo. Nhắc việc sẽ hiện khi BiddingFlow đang mở."
      : "Thông báo trình duyệt chưa được cho phép.";
  });
  closeButton.addEventListener("click", () => dialog.close());

  setInterval(checkReminders, REMINDER_CHECK_MS);
  setTimeout(checkReminders, 5_000);
  void load().catch(() => {});

  return {
    async open() {
      if (!dialog.open) dialog.showModal();
      status.textContent = "Đang tải…";
      try {
        await load({ force: true });
        status.textContent = `Cập nhật lúc ${new Date().toLocaleTimeString("vi-VN")}. Nhắc việc lưu trên trình duyệt này; tải tệp lịch để nhận nhắc trên điện thoại.`;
      } catch (error) {
        status.textContent = error.message;
      }
      render();
    },
    load,
    get items() { return items; },
  };
}

function installHeaderButtons({ search, deadlines }) {
  const headerRight = document.querySelector(".app-header .header-right");
  if (!headerRight || headerRight.querySelector("[data-bf-tools]")) return;
  const searchButton = element("button", "bf-header-tool");
  searchButton.type = "button";
  searchButton.dataset.bfTools = "search";
  searchButton.setAttribute("aria-label", "Tìm kiếm nhanh (Ctrl+K)");
  searchButton.title = "Tìm kiếm nhanh (Ctrl+K)";
  searchButton.append(icon("search"), element("span", "bf-header-tool-label", "Tìm kiếm"), element("kbd", "", "Ctrl K"));
  searchButton.addEventListener("click", () => search.open());
  const deadlineButton = element("button", "bf-header-tool bf-header-tool-icon");
  deadlineButton.type = "button";
  deadlineButton.dataset.bfTools = "deadlines";
  deadlineButton.setAttribute("aria-label", "Hạn chót & nhắc việc");
  deadlineButton.title = "Hạn chót & nhắc việc (Shift+H)";
  deadlineButton.append(icon("alarm-clock"));
  const badge = element("span", "bf-header-tool-badge", "0");
  badge.id = "bf-deadline-badge";
  badge.hidden = true;
  deadlineButton.append(badge);
  deadlineButton.addEventListener("click", () => deadlines.open());
  headerRight.prepend(searchButton, deadlineButton);
  renderLucideIcons(headerRight);
}

/* ---------------------------- Getting started ---------------------------- */

function onboardingKey(controller) {
  const scope = String(controller.model?.workspaceScope?.key || "").trim();
  return scope ? `bf_onboarding:${scope}` : "";
}

export function onboardingSteps(state, { isManager = false, visited = {} } = {}) {
  const count = (table) => (state?.[table] || []).filter(isLatest).length;
  const steps = [
    { id: "plan", label: "Tạo kế hoạch lựa chọn nhà thầu đầu tiên", done: count("kehoach") > 0, tab: "kehoach", action: "taomoi" },
    { id: "package", label: "Thêm gói thầu (hoặc lấy dữ liệu tự động trong màn hình kế hoạch)", done: count("goithau") > 0, tab: "goithau", action: "taomoi" },
    { id: "word", label: "Chọn mẫu Word cho hồ sơ, báo cáo", done: Boolean(visited.word), tab: "xuatban-word" },
    { id: "deadlines", label: "Xem trung tâm hạn chót và đặt nhắc việc", done: Boolean(visited.deadlines), tool: "deadlines" },
  ];
  if (isManager) {
    steps.splice(2, 0, { id: "staff", label: "Mời nhân sự và phân công gói thầu", done: (state?.employees || []).length > 1, tab: "managernhanvien" });
  }
  return steps;
}

function installOnboarding(controller, tools) {
  const key = onboardingKey(controller);
  const storage = globalThis.localStorage;
  const read = () => readReminders(storage, key);
  const write = (value) => writeReminders(storage, key, value);
  const isManager = String(controller._initialSessionData?.user?.membership_role || "") === "manager";

  const render = () => {
    const host = document.getElementById("tab-dashboard");
    host?.querySelector(".bf-onboarding")?.remove();
    const saved = read();
    if (!host || saved.dismissed) return;
    const steps = onboardingSteps(controller.model?.state, { isManager, visited: saved.visited || {} });
    const remaining = steps.filter((step) => !step.done).length;
    if (remaining === 0) return;
    const card = element("section", "bf-onboarding");
    card.setAttribute("aria-labelledby", "bf-onboarding-title");
    const head = element("div", "bf-onboarding-head");
    const heading = element("h2", "", `Bắt đầu với BiddingFlow (${steps.length - remaining}/${steps.length})`);
    heading.id = "bf-onboarding-title";
    const dismiss = element("button", "btn btn-outline", "Ẩn hướng dẫn");
    dismiss.type = "button";
    dismiss.addEventListener("click", () => { write({ ...read(), dismissed: true }); card.remove(); });
    head.append(heading, dismiss);
    const list = element("ol", "bf-onboarding-steps");
    for (const step of steps) {
      const item = element("li", step.done ? "is-done" : "");
      item.append(icon(step.done ? "circle-check" : "circle"));
      const button = element("button", "bf-onboarding-step", step.label);
      button.type = "button";
      button.disabled = step.done;
      button.addEventListener("click", () => {
        const visited = { ...(read().visited || {}) };
        if (step.id === "word" || step.id === "deadlines") visited[step.id] = true;
        write({ ...read(), visited });
        if (step.tool === "deadlines") tools.deadlines.open();
        else controller.switchTab?.(step.tab, step.action || null);
        render();
      });
      item.append(button);
      list.append(item);
    }
    card.append(head, list);
    host.prepend(card);
    renderLucideIcons(card);
  };
  render();
  controller.model?.addStorageHydrationListener?.(() => render());
  window.addEventListener("bf:workspace-changed", () => setTimeout(render, 0));
  window.addEventListener("popstate", () => setTimeout(render, 0));
  const markVisited = (id) => {
    const saved = read();
    if (saved.visited?.[id]) return;
    write({ ...saved, visited: { ...(saved.visited || {}), [id]: true } });
    render();
  };
  return { render, markVisited };
}

/* --------------------------- Organization invitations --------------------------- */

// "Để sau" hides the invitations shown for the rest of this browser session;
// a new invitation, a new session or the email link (?loi-moi=1) shows them again.
const INVITATION_SNOOZE_KEY = "bf_invitations_snoozed";

function readSnoozedInvitations(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(INVITATION_SNOOZE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function invitationsToShow(invitations, { snoozed = new Set(), force = false } = {}) {
  return force ? invitations : invitations.filter((invitation) => !snoozed.has(String(invitation.id)));
}

async function showPendingInvitations() {
  let invitations = [];
  try {
    const response = await apiFetch("/api/invitations", { handleHttpErrors: false });
    if (!response.ok) return;
    invitations = (await response.json())?.invitations || [];
  } catch {
    return;
  }
  const session = globalThis.sessionStorage;
  invitations = invitationsToShow(invitations, {
    snoozed: readSnoozedInvitations(session),
    force: new URLSearchParams(globalThis.location?.search || "").has("loi-moi"),
  });
  if (!invitations.length) return;
  const dialog = element("dialog", "bf-tools-dialog bf-invitation-dialog");
  dialog.setAttribute("aria-labelledby", "bf-invitation-title");
  const title = element("h2", "", invitations.length > 1 ? `Bạn có ${invitations.length} lời mời tham gia tổ chức` : "Bạn có lời mời tham gia tổ chức");
  title.id = "bf-invitation-title";
  const list = element("ul", "bf-invitation-list");
  const status = element("p", "bf-deadline-status");
  status.setAttribute("role", "status");
  for (const invitation of invitations) {
    const item = element("li", "bf-deadline-item");
    const text = element("div", "bf-deadline-text");
    text.append(element("strong", "", invitation.organizationName));
    text.append(element("span", "", `Người mời: ${invitation.inviterName || "Quản lý tổ chức"} · Tên hiển thị trong tổ chức: ${invitation.employeeName}`));
    text.append(element("small", "", `Hết hạn: ${new Date(invitation.expiresAt * 1000).toLocaleDateString("vi-VN")}`));
    const controls = element("div", "bf-deadline-controls");
    const decline = element("button", "btn btn-outline", "Từ chối");
    decline.type = "button";
    const accept = element("button", "btn btn-primary", "Chấp nhận");
    accept.type = "button";
    const respond = async (action) => {
      accept.disabled = true;
      decline.disabled = true;
      try {
        const response = await apiFetch(`/api/invitations/${encodeURIComponent(invitation.id)}/${action}`, {
          method: "POST",
          handleHttpErrors: false,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = payload.error || "Không thể xử lý lời mời.";
          accept.disabled = false;
          decline.disabled = false;
          return;
        }
        if (action === "accept") {
          try { globalThis.sessionStorage?.setItem("bf_active_org", invitation.organizationId); } catch { /* optional */ }
          try { globalThis.localStorage?.setItem("bf_active_org", invitation.organizationId); } catch { /* optional */ }
          status.textContent = `${payload.message || "Bạn đã tham gia tổ chức."} Đang chuyển sang tổ chức…`;
          setTimeout(() => window.location.assign("/tong-quan"), 800);
          return;
        }
        item.remove();
        status.textContent = payload.message || "Đã từ chối lời mời.";
        if (!list.children.length) setTimeout(() => dialog.close(), 800);
      } catch (error) {
        status.textContent = error.message;
        accept.disabled = false;
        decline.disabled = false;
      }
    };
    accept.addEventListener("click", () => respond("accept"));
    decline.addEventListener("click", () => respond("decline"));
    controls.append(decline, accept);
    item.append(text, controls);
    list.append(item);
  }
  const later = element("button", "btn btn-outline", "Để sau");
  later.type = "button";
  later.addEventListener("click", () => {
    const snoozed = readSnoozedInvitations(session);
    for (const invitation of invitations) snoozed.add(String(invitation.id));
    try { session?.setItem(INVITATION_SNOOZE_KEY, JSON.stringify([...snoozed])); } catch { /* optional */ }
    dialog.close();
  });
  const body = element("div", "bf-deadline-body");
  body.append(list, status, later);
  dialog.append(title, body);
  document.body.append(dialog);
  dialog.showModal();
}

export async function installWorkspaceTools(controller) {
  if (!controller || controller.workspaceTools) return controller?.workspaceTools;
  await loadStyleOnce(STYLESHEET_URL).catch(() => {});
  const search = createSearchDialog(controller);
  const shortcuts = createShortcutDialog();
  const deadlines = createDeadlineCenter(controller);
  installShortcuts({ search, shortcuts, deadlines });
  installHeaderButtons({ search, deadlines });
  const onboarding = installOnboarding(controller, { deadlines });
  // Opening the deadline center from the header or Shift+H counts too.
  const openDeadlines = deadlines.open;
  deadlines.open = (...args) => {
    onboarding.markVisited("deadlines");
    return openDeadlines(...args);
  };
  controller.workspaceTools = { search, shortcuts, deadlines, onboarding };
  void showPendingInvitations();
  return controller.workspaceTools;
}
