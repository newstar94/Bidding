import { renderLucideIcons } from "../shared/lucideIcons.js";
import { trustedHTML } from "../shared/trustedTypes.js";

const MAX_ITEMS = 500;
const MAX_TEXT_LENGTH = 100_000;

function createRow(basis = {}, index = 0) {
  const row = document.createElement("div");
  row.className = "plan-basis-editor-row";
  row.dataset.planBasisId = String(basis?.id || "");
  const textarea = document.createElement("textarea");
  textarea.className = "form-control plan-basis-editor-text";
  textarea.maxLength = MAX_TEXT_LENGTH;
  textarea.rows = 3;
  textarea.value = String(basis?.noiDungGoc || "");
  textarea.placeholder = "Ví dụ: Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC về việc phê duyệt dự toán";
  textarea.setAttribute("aria-label", `Nội dung căn cứ ${index + 1}`);
  const actions = document.createElement("div");
  actions.className = "plan-basis-editor-actions";
  actions.innerHTML = trustedHTML(`
    <button type="button" class="action-btn" data-plan-basis-up aria-label="Chuyển căn cứ lên" title="Chuyển lên"><i data-lucide="arrow-up"></i></button>
    <button type="button" class="action-btn" data-plan-basis-down aria-label="Chuyển căn cứ xuống" title="Chuyển xuống"><i data-lucide="arrow-down"></i></button>
    <button type="button" class="action-btn btn-delete" data-plan-basis-remove aria-label="Xóa căn cứ" title="Xóa căn cứ"><i data-lucide="trash-2"></i></button>`);
  const metadata = document.createElement("div");
  metadata.className = "plan-basis-editor-metadata";
  if (basis?.parseStatus) {
    metadata.textContent = [
      basis.tenCanCu,
      basis.soVanBan && `Số ${basis.soVanBan}`,
      basis.ngayBanHanh && `Ngày ${basis.ngayBanHanh}`,
      basis.donViBanHanh,
      `Trạng thái: ${basis.parseStatus}`,
    ].filter(Boolean).join(" · ");
    if (basis.parseStatus !== "PARSED") metadata.classList.add("is-warning");
  } else {
    metadata.textContent = "Các trường cấu trúc sẽ được máy chủ phân tích sau khi lưu.";
    metadata.classList.add("is-pending");
  }
  row.append(textarea, actions, metadata);
  return row;
}

function createEmptyState() {
  const empty = document.createElement("div");
  empty.className = "plan-basis-editor-empty";
  const title = document.createElement("strong");
  title.textContent = "Chưa có căn cứ";
  const description = document.createElement("span");
  description.textContent = "Chọn “Thêm căn cứ” để nhập văn bản đầu tiên.";
  empty.append(title, description);
  return empty;
}

function refreshEditorState(container) {
  if (!container) return;
  const rows = [...container.querySelectorAll(".plan-basis-editor-row")];
  container.querySelector(".plan-basis-editor-empty")?.remove();
  rows.forEach((row, index) => {
    row.querySelector(".plan-basis-editor-text")
      ?.setAttribute("aria-label", `Nội dung căn cứ ${index + 1}`);
    const up = row.querySelector("[data-plan-basis-up]");
    const down = row.querySelector("[data-plan-basis-down]");
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === rows.length - 1;
  });
  if (!rows.length) container.appendChild(createEmptyState());
}

export function renderPlanBasisEditor(container, bases = [], lucide = globalThis.lucide) {
  if (!container) return;
  container.replaceChildren(...(bases || []).map(createRow));
  refreshEditorState(container);
  renderLucideIcons(container, lucide);
}

export function addPlanBasisEditorRow(container, basis = {}, lucide = globalThis.lucide) {
  if (!container || container.querySelectorAll(".plan-basis-editor-row").length >= MAX_ITEMS) {
    return false;
  }
  container.appendChild(createRow(basis, container.children.length));
  refreshEditorState(container);
  renderLucideIcons(container, lucide);
  container.querySelector(".plan-basis-editor-row:last-of-type textarea")?.focus();
  return true;
}

export function collectPlanBasisEditorRows(container) {
  if (!container) return [];
  const result = [];
  container.querySelectorAll(".plan-basis-editor-row").forEach((row) => {
    const noiDungGoc = row.querySelector(".plan-basis-editor-text")?.value.trim() || "";
    if (!noiDungGoc) return;
    const item = { noiDungGoc };
    const id = String(row.dataset.planBasisId || "").trim();
    if (id) item.id = id;
    result.push(item);
  });
  return result;
}

export function sanitizePlanBasisRows(bases = []) {
  return (bases || []).flatMap((basis) => {
    const noiDungGoc = String(basis?.noiDungGoc || "").trim();
    if (!noiDungGoc) return [];
    const item = { noiDungGoc };
    const id = String(basis?.id || "").trim();
    if (id) item.id = id;
    return [item];
  });
}

export function bindPlanBasisEditor(container, addButton, lucide = globalThis.lucide) {
  if (!container || container.dataset.planBasisBound) return;
  container.dataset.planBasisBound = "true";
  addButton?.addEventListener("click", () => addPlanBasisEditorRow(container, {}, lucide));
  container.addEventListener("click", (event) => {
    const row = event.target.closest?.(".plan-basis-editor-row");
    if (!row) return;
    if (event.target.closest?.("[data-plan-basis-remove]")) row.remove();
    else if (event.target.closest?.("[data-plan-basis-up]") && row.previousElementSibling) {
      row.parentElement.insertBefore(row, row.previousElementSibling);
    } else if (event.target.closest?.("[data-plan-basis-down]") && row.nextElementSibling) {
      row.parentElement.insertBefore(row.nextElementSibling, row);
    }
    refreshEditorState(container);
  });
}
