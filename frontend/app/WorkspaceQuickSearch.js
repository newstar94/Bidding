import { requestJson } from "../shared/apiClient.js";

const ENTITIES = Object.freeze({
  packages: { label: "Gói thầu", command: "showPackageDetails" },
  plans: { label: "Kế hoạch", command: "showKeHoachDetails" },
  contracts: { label: "Hợp đồng", command: "showHopDongDetails" },
});

const workspaceToken = (controller) => controller?.model?.getWorkspaceToken?.()
  || controller?.model?.workspaceScope?.key || "";

function element(tag, className, content = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}

export function openWorkspaceQuickSearch(controller) {
  const trigger = document.getElementById("btn-workspace-search");
  const previousFocus = document.activeElement;
  const initialToken = workspaceToken(controller);
  const dialog = element("dialog", "workspace-search-dialog");
  dialog.setAttribute("aria-labelledby", "workspace-search-title");
  dialog.setAttribute("aria-modal", "true");
  const title = element("h2", "", "Tìm kiếm hồ sơ");
  title.id = "workspace-search-title";
  const close = element("button", "btn btn-outline", "Đóng");
  close.type = "button";
  const header = element("header", "workspace-search-header");
  header.append(title, close);
  const form = element("form", "workspace-search-form");
  const entityLabel = element("label", "", "Phân hệ");
  const entity = document.createElement("select");
  entity.setAttribute("aria-label", "Phân hệ tìm kiếm");
  for (const [key, value] of Object.entries(ENTITIES)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = value.label;
    entity.append(option);
  }
  entityLabel.append(entity);
  const queryLabel = element("label", "", "Mã hoặc tên hồ sơ");
  const query = document.createElement("input");
  query.type = "search";
  query.minLength = 2;
  query.maxLength = 100;
  query.required = true;
  query.autocomplete = "off";
  query.placeholder = "Nhập ít nhất 2 ký tự";
  queryLabel.append(query);
  const submit = element("button", "btn btn-primary", "Tìm");
  submit.type = "submit";
  form.append(entityLabel, queryLabel, submit);
  const status = element("p", "workspace-search-status", "Tìm theo mã hoặc tên trong workspace hiện tại.");
  status.setAttribute("role", "status");
  const results = element("div", "workspace-search-results");
  const more = element("button", "btn btn-outline", "Xem thêm");
  more.type = "button";
  more.hidden = true;
  dialog.append(header, form, status, results, more);
  document.body.append(dialog);
  trigger?.setAttribute("aria-expanded", "true");

  let closed = false;
  let generation = 0;
  let activeRequest = null;
  let nextOffset = null;
  let lastQuery = "";
  let lastEntity = "";
  const isCurrent = () => !closed && workspaceToken(controller) === initialToken;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    generation += 1;
    activeRequest?.abort();
    clearInterval(scopeTimer);
    trigger?.setAttribute("aria-expanded", "false");
    dialog.close();
    dialog.remove();
    previousFocus?.focus?.();
  };
  const scopeTimer = setInterval(() => { if (!isCurrent()) cleanup(); }, 250);
  close.addEventListener("click", cleanup);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); cleanup(); });
  dialog.showModal();
  query.focus();

  const search = async (offset = 0) => {
    if (!isCurrent()) return cleanup();
    const value = query.value.trim();
    if (value.length < 2) {
      status.textContent = "Nhập ít nhất 2 ký tự.";
      return;
    }
    const type = entity.value;
    const ticket = ++generation;
    activeRequest?.abort();
    activeRequest = new AbortController();
    submit.disabled = true;
    more.hidden = true;
    status.textContent = "Đang tìm kiếm…";
    if (offset === 0) results.replaceChildren();
    try {
      const data = await requestJson("/api/workspace-search", {
        method: "POST",
        body: { entity: type, query: value, offset, limit: 20 },
        signal: activeRequest.signal,
        retries: 0,
      });
      if (!isCurrent() || ticket !== generation) return;
      lastQuery = value;
      lastEntity = type;
      nextOffset = data.nextOffset;
      for (const item of data.items || []) {
        const button = element("button", "workspace-search-result", `${item.code || "Không có mã"} · ${item.name || "Chưa có tên"}`);
        button.type = "button";
        button.addEventListener("click", () => {
          if (!isCurrent()) return cleanup();
          cleanup();
          void controller.executeCommand(ENTITIES[type].command, item.id);
        });
        results.append(button);
      }
      status.textContent = results.childElementCount
        ? `Đã hiển thị ${results.childElementCount} hồ sơ ${ENTITIES[type].label.toLowerCase()}.`
        : "Không tìm thấy hồ sơ phù hợp trong phạm vi bạn được xem.";
      more.hidden = !data.hasMore;
    } catch (error) {
      if (!isCurrent() || ticket !== generation) return;
      status.textContent = error?.status === 403
        ? "Bạn không có quyền xem phân hệ này trong workspace hiện tại."
        : "Không thể tìm kiếm lúc này. Vui lòng thử lại.";
    } finally {
      if (isCurrent() && ticket === generation) submit.disabled = false;
    }
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); void search(); });
  entity.addEventListener("change", () => { generation += 1; activeRequest?.abort(); results.replaceChildren(); more.hidden = true; status.textContent = "Chọn Tìm để tra cứu phân hệ này."; });
  query.addEventListener("input", () => { generation += 1; activeRequest?.abort(); results.replaceChildren(); more.hidden = true; status.textContent = "Chọn Tìm để tra cứu từ khóa mới."; });
  more.addEventListener("click", () => {
    if (query.value.trim() !== lastQuery || entity.value !== lastEntity || nextOffset == null) return;
    void search(nextOffset);
  });
  return dialog;
}

export function setupWorkspaceQuickSearch(controller) {
  const trigger = document.getElementById("btn-workspace-search");
  if (!trigger || trigger.dataset.bound === "true") return;
  trigger.dataset.bound = "true";
  trigger.addEventListener("click", () => { void openWorkspaceQuickSearch(controller); });
}
