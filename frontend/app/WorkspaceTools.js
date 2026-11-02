import { apiFetch } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { renderLucideIcons } from "../shared/lucideIcons.js";

// Workspace productivity tools, loaded after the first interaction:
// global search (Ctrl+K or "/"), keyboard shortcuts and the getting-started
// checklist. Everything here reads data the user already has in this
// workspace; nothing changes what a user may see.

const STYLESHEET_URL = new URL("./WorkspaceTools.css?no-inline", import.meta.url).pathname;
const SEARCH_LIMIT = 30;

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

function installShortcuts({ search, shortcuts }) {
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
    if (event.key === "?") { event.preventDefault(); shortcuts.open(); }
  });
}

function installHeaderButtons({ search }) {
  const headerRight = document.querySelector(".app-header .header-right");
  if (!headerRight || headerRight.querySelector("[data-bf-tools]")) return;
  const searchButton = element("button", "bf-header-tool");
  searchButton.type = "button";
  searchButton.dataset.bfTools = "search";
  searchButton.setAttribute("aria-label", "Tìm kiếm nhanh (Ctrl+K)");
  searchButton.title = "Tìm kiếm nhanh (Ctrl+K)";
  searchButton.append(icon("search"), element("span", "bf-header-tool-label", "Tìm kiếm"), element("kbd", "", "Ctrl K"));
  searchButton.addEventListener("click", () => search.open());
  headerRight.prepend(searchButton);
  renderLucideIcons(headerRight);
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
    // ADR 0094: lets the invitee tell a verified organization from a look-alike.
    text.append(element(
      "span",
      invitation.organizationVerified ? "bf-invitation-verified" : "bf-invitation-unverified",
      invitation.organizationVerified ? "Mã số thuế đã được xác minh" : "Tổ chức chưa xác minh mã số thuế",
    ));
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
  installShortcuts({ search, shortcuts });
  installHeaderButtons({ search });
  controller.workspaceTools = { search, shortcuts };
  void showPendingInvitations();
  return controller.workspaceTools;
}
