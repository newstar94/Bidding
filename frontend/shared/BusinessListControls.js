import { trustedHTML } from "./trustedTypes.js";
import { escapeHtml } from "./view_helpers.js";
import { renderLucideIcons } from "./lucideIcons.js";
import { loadStyleOnce } from "./externalAssets.js";
import { loadPaginatedRecords } from "./tableDataUtils.js";
import { getVersionLabel } from "./formatters.js";
import { isWorkspaceLeaseCurrent } from "../app/workspaceLease.js";
import { loadWorkspaceEmployees } from "./workspaceEmployeeLoader.js";
import { businessListState } from "./BusinessListState.js";
import {
  businessListFilterField, getBusinessListFilters,
  setBusinessListFilters, normalizeBusinessListFilters,
} from "./BusinessListFilters.js";
import {
  getBusinessListSelection, setBusinessListPage, clearBusinessListSelection,
  isBusinessListRowSelected, reconcileBusinessListRowVersion,
  toggleBusinessListRow, selectBusinessListPage, selectAllBusinessListResults,
} from "./BusinessListSelection.js";

export { getBusinessListFilters, matchesBusinessListFilters } from "./BusinessListFilters.js";
export { getBusinessListSelection } from "./BusinessListSelection.js";

const BINDINGS = new WeakMap();
const STYLESHEET_URL = new URL("./BusinessListControls.css?no-inline", import.meta.url).pathname;
const LABELS = { kehoach: "kế hoạch", goithau: "gói thầu", hopdong: "hợp đồng" };
const RENDERS = { kehoach: "renderKeHoachTable", goithau: "renderGoiThauTable", hopdong: "renderHopDongTable" };
const VERSION_MAPS = { kehoach: "selectedPlanVersion", goithau: "selectedPackageVersion", hopdong: "selectedHopDongVersion" };
const LEGACY_DATES = { kehoach: "ngayPheDuyet", goithau: "ngayQuyetDinh", hopdong: "ngayKy" };
const LIST_FILTER_OPERATORS = {
  kehoach: new Map([["chuDauTuId", "in"], ["ngayPheDuyet", "range"]]),
  goithau: new Map([
    ["keHoachId", "in"], ["trangThai", "in"], ["hinhThucLuaChon", "in"], ["linhVuc", "in"],
    ["phuongThucLuaChon", "in"], ["loaiHopDong", "in"], ["phanLo", "in"], ["isThuoc", "in"],
    ["tuyChonMuaThem", "in"], ["thoiGianDangTai", "range"],
  ]),
  hopdong: new Map([
    ["chuDauTuId", "in"], ["nhaThauId", "in"], ["keHoachId", "in"], ["goiThauIds", "in"],
    ["assigneeId", "in"], ["trangThaiHopDong", "in"], ["ngayKy", "range"],
  ]),
};
const esc = escapeHtml;
const keyOf = (condition) => `${condition.field}:${["year", "month"].includes(condition.operator) ? condition.operator : "value"}`;
const searchText = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLocaleLowerCase("vi");

function binding(view, type) { return BINDINGS.get(view)?.get(type); }
function pendingDeleteScopeIsCurrent(ui, pending = ui.pendingBulkDelete) {
  if (!pending?.scope) return false;
  const model = ui.view.model;
  const { scope } = pending;
  return isWorkspaceLeaseCurrent(model, scope.lease)
    && scope.identity === String(model.state.activeuser?.id || model.workspaceScope?.userId || "")
    && scope.organization === String(model.workspaceScope?.organizationId || "") && scope.role === model.state.activerole;
}
function hasCurrentScope(ui) {
  if (ui.state === businessListState(ui.view.model, ui.type)) return true;
  ui.state = businessListState(ui.view.model, ui.type);
  ui.displayed.clear();
  if (!pendingDeleteScopeIsCurrent(ui)) ui.pendingBulkDelete = null;
  ui.loading = true;
  closePanel(ui, false);
  refreshBusinessListSelection(ui.view, ui.type);
  return false;
}
function filterChoices(type) {
  return [...LIST_FILTER_OPERATORS[type]].map(([key, operator]) => ({
    ...businessListFilterField(type, key), id: `${key}:value`, operator,
  }));
}

function migrateLegacyFilters(view, type) {
  const previousConditions = getBusinessListFilters(view.model, type);
  const operators = LIST_FILTER_OPERATORS[type];
  // Retire old conditions that are no longer offered by this list's filter popup.
  const conditions = previousConditions.filter((condition) => operators.get(condition.field) === condition.operator);
  const fields = [[`filter-${type}-nam`, LEGACY_DATES[type], "year"], [`filter-${type}-thang`, LEGACY_DATES[type], "month"]];
  if (type === "goithau") fields.push(["filter-goithau-trangthai", "trangThai", "in"], ["filter-goithau-hinhthuc", "hinhThucLuaChon", "in"]);
  let changed = conditions.length !== previousConditions.length;
  for (const [id, field, operator] of fields) {
    const control = document.getElementById(id);
    if (!control?.value) continue;
    if (operators.get(field) === operator) {
      const condition = { field, operator, value: [control.value] };
      const previous = conditions.findIndex((entry) => keyOf(entry) === keyOf(condition));
      if (previous >= 0) conditions[previous] = condition;
      else conditions.push(condition);
    }
    control.value = "";
    changed = true;
  }
  if (changed) {
    setBusinessListFilters(view.model, type, conditions);
    clearBusinessListSelection(view.model, type);
    view.model.currentPage[type] = 1;
    view.model.savePage?.(type);
  }
}

function updateFilterButton(ui) {
  const count = getBusinessListFilters(ui.view.model, ui.type).length;
  const label = count ? `Bộ lọc (${count})` : "Bộ lọc";
  ui.button.innerHTML = trustedHTML(`<i data-lucide="list-filter" aria-hidden="true"></i> ${esc(label)}`);
  ui.button.classList.toggle("has-active-filters", count > 0);
  ui.button.setAttribute("aria-expanded", String(!ui.panel.hidden));
  renderLucideIcons(ui.button);
}

function showError(ui, message = "") {
  const error = ui.panel.querySelector("[data-filter-error]");
  if (error) { error.textContent = message; error.hidden = !message; }
}

function closePanel(ui, restoreFocus = true) {
  ui.generation += 1;
  for (const timer of ui.searchTimers.values()) clearTimeout(timer);
  ui.searchTimers.clear();
  if (ui.panel.open) ui.panel.close();
  ui.panel.hidden = true;
  ui.draft = null;
  updateFilterButton(ui);
  if (restoreFocus) ui.button.focus();
}

function localOptions(ui, definition) {
  const state = ui.view.model.state || {};
  if (definition.options) return definition.options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  if (definition.kind === "catalog") return (state.customcontractstatuses || []).map((row) => ({ value: row.name, label: row.name }));
  if (definition.kind === "assignee") {
    const options = new Map([...(state.employees || []), ...(state.activeuser ? [state.activeuser] : [])]
      .map((row) => [String(row.id), { value: String(row.id), label: row.name || row.tenNhanSu || row.organizationProfile?.name || row.email || String(row.id) }]));
    if (ui.type === "hopdong") {
      const contracts = new Map((state.hopdong || []).map((row) => [String(row.id), row]));
      for (const assignment of state.assignments || []) {
        const contract = contracts.get(String(assignment.targetId));
        const value = String(assignment.empId || "");
        if (assignment.type !== "hopdong" || !contract || !value || options.has(value)
          || (assignment.organizationId && contract.organizationId && assignment.organizationId !== contract.organizationId)) continue;
        options.set(value, { value, label: value });
      }
    }
    return [...options.values()];
  }
  return referenceOptions(ui, definition, state[definition.table] || []);
}

function referenceOptions(ui, definition, records) {
  const options = new Map();
  for (const row of records) {
    // allVersions comes from the API's existing per-version read scope.
    const versions = ui.type === "hopdong" && Array.isArray(row.allVersions) ? row.allVersions : [];
    for (const version of [...versions, row]) {
      const record = { ...row, ...version };
      const value = String(record.id || "");
      const label = [record[definition.codeKey], record[definition.labelKey]].filter(Boolean).join(" · ") || value;
      options.set(value, { value, label: ui.type === "hopdong" && record.phienBan != null ? `${label} · Phiên bản ${getVersionLabel(record.phienBan)}` : label });
    }
  }
  return [...options.values()];
}

function optionMarkup(ui, condition, index, query = "") {
  const definition = businessListFilterField(ui.type, condition.field);
  const selected = new Set(Array.isArray(condition.value) ? condition.value : [condition.value].filter(Boolean));
  const remote = ui.options.get(condition.field);
  const choices = condition.operator === "month" ? Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` }))
    : remote?.items || localOptions(ui, definition);
  const byId = new Map(choices.filter((item) => item.value).map((item) => [String(item.value), item]));
  for (const item of localOptions(ui, definition)) {
    if (selected.has(String(item.value))) byId.set(String(item.value), item);
  }
  for (const value of selected) if (!byId.has(String(value))) byId.set(String(value), { value: String(value), label: String(value) });
  const needle = searchText(query);
  const visible = [...byId.values()].filter((item) => selected.has(String(item.value)) || searchText(item.label).includes(needle));
  return visible.map((item) => `<label class="business-filter-option"><input type="checkbox" data-filter-value="${index}" value="${esc(String(item.value))}" ${selected.has(String(item.value)) ? "checked" : ""}><span>${esc(item.label)}</span></label>`).join("")
    || '<p class="business-filter-hint">Không có lựa chọn phù hợp.</p>';
}

function conditionMarkup(ui, condition, index) {
  const definition = businessListFilterField(ui.type, condition.field);
  const label = `${condition.operator === "year" ? "Năm · " : condition.operator === "month" ? "Tháng · " : ""}${definition.label}`;
  const id = `${ui.type}-condition-${index}`;
  let control;
  if (condition.operator === "range") {
    const date = definition.kind !== "money";
    const dateRangeLabels = date && Boolean(LIST_FILTER_OPERATORS[ui.type]);
    control = `<div class="business-filter-range">
      <label for="${id}-min">${dateRangeLabels ? "Từ ngày" : "Từ"}<input id="${id}-min" data-filter-index="${index}" data-filter-bound="min" type="${date ? "date" : "text"}" ${date ? 'min="0001-01-01" max="9999-12-31"' : 'inputmode="numeric" maxlength="19" placeholder="Không giới hạn"'} value="${esc(condition.value?.min || "")}"></label>
      <label for="${id}-max">${dateRangeLabels ? "Đến ngày" : "Đến"}<input id="${id}-max" data-filter-index="${index}" data-filter-bound="max" type="${date ? "date" : "text"}" ${date ? 'min="0001-01-01" max="9999-12-31"' : 'inputmode="numeric" maxlength="19" placeholder="Không giới hạn"'} value="${esc(condition.value?.max || "")}"></label></div>`;
  } else if (condition.operator === "year") {
    control = `<label class="business-filter-hint" for="${id}-years">Có thể nhập nhiều năm, cách nhau bằng dấu phẩy</label>
      <input id="${id}-years" data-filter-index="${index}" data-filter-years type="text" inputmode="numeric" maxlength="512" placeholder="Ví dụ: 2025, 2026" value="${esc((Array.isArray(condition.value) ? condition.value : [condition.value]).join(", "))}">`;
  } else if (definition.kind === "text") {
    control = `<div class="business-filter-text"><select data-no-custom="true" data-filter-operator="${index}" aria-label="Điều kiện ${esc(label)}">
      ${[["contains", "Chứa"], ["equals", "Bằng"], ["not_contains", "Không chứa"]].map(([value, text]) => `<option value="${value}" ${condition.operator === value ? "selected" : ""}>${text}</option>`).join("")}</select>
      <input data-filter-index="${index}" type="text" maxlength="512" aria-label="Giá trị ${esc(label)}" placeholder="Nhập giá trị…" value="${esc(String(condition.value || ""))}"></div>`;
  } else {
    const count = Array.isArray(condition.value) ? condition.value.length : condition.value ? 1 : 0;
    control = `<details class="business-filter-values" data-filter-options="${index}"><summary><span data-filter-value-summary>${count ? `Đã chọn ${count} giá trị` : "Chọn một hoặc nhiều giá trị"}</span><i data-lucide="chevron-down" aria-hidden="true"></i></summary>
      <div class="business-filter-value-body"><input type="search" data-filter-option-search="${index}" placeholder="Tìm trong danh sách…" aria-label="Tìm ${esc(label)}">
        <div class="business-filter-option-list" data-filter-option-list="${index}">${optionMarkup(ui, condition, index)}</div>
        <p class="business-filter-hint" data-filter-options-status="${index}" role="status"></p>
        ${definition.kind === "reference" && ui.view.model.useServerSidePagination ? `<button type="button" class="btn btn-outline" data-filter-load-more="${index}" hidden>Xem thêm</button>` : ""}</div></details>`;
  }
  return `<fieldset class="business-filter-condition" data-filter-condition="${index}"><legend>${esc(label)}</legend>
    <button type="button" class="business-filter-remove" data-filter-remove="${index}" aria-label="Bỏ điều kiện ${esc(label)}">×</button>${control}</fieldset>`;
}

function renderConditions(ui) {
  for (const timer of ui.searchTimers.values()) clearTimeout(timer);
  ui.searchTimers.clear();
  const container = ui.panel.querySelector("[data-filter-conditions]");
  container.innerHTML = trustedHTML(ui.draft.length ? ui.draft.map((condition, index) => conditionMarkup(ui, condition, index)).join("")
    : '<div class="business-filter-empty"><strong>Chọn trường dữ liệu để bắt đầu</strong><span>Bạn có thể kết hợp nhiều trường trong cùng một bộ lọc.</span></div>');
  for (const control of ui.panel.querySelectorAll("[data-filter-field]")) {
    control.checked = ui.draft.some((condition) => keyOf(condition) === control.value);
    control.disabled = !control.checked && ui.draft.length >= 24;
  }
  renderLucideIcons(container);
  showError(ui);
}

function openPanel(ui) {
  hasCurrentScope(ui);
  ui.generation += 1;
  ui.draft = getBusinessListFilters(ui.view.model, ui.type);
  ui.options.clear();
  ui.panel.innerHTML = trustedHTML(`<div class="business-filter-heading"><div><h3 id="${ui.type}-filter-title">Bộ lọc ${LABELS[ui.type]}</h3>
    <p>Thỏa mãn tất cả trường đã chọn. Trong mỗi trường, chỉ cần khớp một giá trị. Lọc trên phiên bản hiện hành.</p></div>
    <button type="button" class="btn btn-outline" data-filter-action="cancel" aria-label="Đóng bộ lọc">×</button></div>
    <div class="business-filter-body"><details class="business-filter-field-picker"><summary><i data-lucide="plus" aria-hidden="true"></i> Thêm trường lọc</summary>
      <div class="business-filter-field-body"><input type="search" data-filter-field-search placeholder="Tìm trường dữ liệu…" aria-label="Tìm trường dữ liệu">
        <div class="business-filter-field-list">${filterChoices(ui.type).map((choice) => `<label class="business-filter-option" data-field-choice-label="${esc(searchText(choice.label))}"><input type="checkbox" data-filter-field value="${esc(choice.id)}"><span>${esc(choice.label)}</span></label>`).join("")}</div></div></details>
    <div class="business-filter-conditions" data-filter-conditions></div>
    <p class="business-filter-error" data-filter-error role="alert" hidden></p></div>
    <div class="business-filter-footer"><button type="button" class="btn btn-outline" data-filter-action="clear">Xóa điều kiện</button>
      <span class="business-filter-hint">Chọn Áp dụng để cập nhật danh sách.</span><div>
      <button type="button" class="btn btn-outline" data-filter-action="cancel">Hủy</button>
      <button type="button" class="btn btn-primary" data-filter-action="apply">Áp dụng</button></div></div>`);
  ui.panel.hidden = false;
  renderConditions(ui);
  if (!ui.panel.open) ui.panel.showModal();
  updateFilterButton(ui);
  renderLucideIcons(ui.panel);
  ui.panel.querySelector("summary")?.focus();
}

async function loadAssigneeOptions(ui, index) {
  const model = ui.view.model;
  if (!model.useServerSidePagination) return;
  const state = businessListState(model, ui.type);
  const generation = ui.generation;
  const previous = ui.options.get("assigneeId");
  if (previous?.generation === generation && !previous.error) return;
  const entry = { generation, loading: true };
  ui.options.set("assigneeId", entry);
  const status = ui.panel.querySelector(`[data-filter-options-status="${index}"]`);
  if (status) status.textContent = "Đang tải người phụ trách…";
  const isCurrent = () => generation === ui.generation && state === businessListState(model, ui.type)
    && ui.options.get("assigneeId") === entry && ui.draft?.[index]?.field === "assigneeId";
  try {
    await loadWorkspaceEmployees(model, { shouldApply: isCurrent });
    if (!isCurrent()) return;
    entry.loading = false;
    const query = ui.panel.querySelector(`[data-filter-option-search="${index}"]`)?.value || "";
    ui.panel.querySelector(`[data-filter-option-list="${index}"]`).innerHTML = trustedHTML(optionMarkup(ui, ui.draft[index], index, query));
    if (status) status.textContent = "";
  } catch (error) {
    if (error?.name === "AbortError" || !isCurrent()) return;
    entry.loading = false;
    entry.error = true;
    if (status) status.textContent = "Chưa tải được người phụ trách. Mở lại danh sách để thử lại.";
  }
}

async function loadFilterOptions(ui, index, { more = false, query = "" } = {}) {
  const condition = ui.draft?.[index];
  const definition = condition && businessListFilterField(ui.type, condition.field);
  if (ui.type === "hopdong" && definition?.kind === "assignee") return loadAssigneeOptions(ui, index);
  if (definition?.kind !== "reference" || !ui.view.model.useServerSidePagination) return;
  const state = businessListState(ui.view.model, ui.type);
  const generation = ui.generation;
  const previous = ui.options.get(definition.key);
  if (more && (!previous || previous.loading || previous.query !== query || !previous.more)) return;
  const sequence = (previous?.sequence || 0) + 1;
  const page = more ? (previous?.page || 1) + 1 : 1;
  const entry = { sequence, query, generation, loading: true, page: more ? previous.page : 0, items: more ? previous.items : undefined };
  ui.options.set(definition.key, entry);
  const status = ui.panel.querySelector(`[data-filter-options-status="${index}"]`);
  if (status) status.textContent = "Đang tải lựa chọn…";
  const moreButton = ui.panel.querySelector(`[data-filter-load-more="${index}"]`);
  if (moreButton) { moreButton.disabled = true; if (!more) moreButton.hidden = true; }
  try {
    const result = await loadPaginatedRecords(ui.view.model, definition.table, { page, pageSize: 50, search: query }, { cancellationOwner: `ui:filter-options:${ui.type}:${definition.key}` });
    if (generation !== ui.generation || state !== businessListState(ui.view.model, ui.type) || ui.options.get(definition.key)?.sequence !== sequence || ui.draft?.[index]?.field !== definition.key
      || ui.panel.querySelector(`[data-filter-option-search="${index}"]`)?.value !== query) return;
    const options = new Map((more ? previous?.items || [] : []).map((item) => [item.value, item]));
    for (const option of referenceOptions(ui, definition, result.items)) options.set(option.value, option);
    entry.items = [...options.values()];
    entry.recordCount = (more ? previous.recordCount || 0 : 0) + result.items.length;
    entry.page = page;
    entry.loading = false;
    entry.more = page * 50 < result.totalItems;
    ui.panel.querySelector(`[data-filter-option-list="${index}"]`).innerHTML = trustedHTML(optionMarkup(ui, ui.draft[index], index, query));
    if (status) status.textContent = ui.type === "hopdong"
      ? `${entry.recordCount} / ${result.totalItems} bản ghi · ${entry.items.length} phiên bản`
      : `${entry.items.length} / ${result.totalItems} lựa chọn`;
    const next = ui.panel.querySelector(`[data-filter-load-more="${index}"]`);
    if (next) { next.hidden = !entry.more; next.disabled = false; }
  } catch (error) {
    if (error?.name === "AbortError" || generation !== ui.generation || state !== businessListState(ui.view.model, ui.type) || ui.options.get(definition.key)?.sequence !== sequence) return;
    entry.loading = false;
    entry.error = true;
    if (status) status.textContent = "Chưa tải được danh sách. Nhập từ khóa để thử lại.";
    const next = ui.panel.querySelector(`[data-filter-load-more="${index}"]`);
    if (next) next.disabled = false;
  }
}

function bindPanel(ui) {
  const isOutsideDialog = (event) => {
    if (event.target !== ui.panel) return false;
    const bounds = ui.panel.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  let backdropPointerDown = false;
  ui.panel.addEventListener("pointerdown", (event) => {
    backdropPointerDown = event.button === 0 && isOutsideDialog(event);
  });
  ui.panel.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePanel(ui);
  });
  ui.panel.addEventListener("close", () => {
    if (!ui.panel.open && !ui.panel.hidden) closePanel(ui);
  });
  ui.panel.addEventListener("click", async (event) => {
    if (!hasCurrentScope(ui)) return;
    const dismissBackdrop = backdropPointerDown && isOutsideDialog(event);
    backdropPointerDown = false;
    if (dismissBackdrop) { closePanel(ui); return; }
    const action = event.target.closest("[data-filter-action]")?.dataset.filterAction;
    if (action === "cancel") closePanel(ui);
    if (action === "clear") { ui.draft = []; ui.generation += 1; renderConditions(ui); }
    if (action === "apply") {
      try {
        const filters = normalizeBusinessListFilters(ui.type, ui.draft);
        const changed = JSON.stringify(filters) !== JSON.stringify(getBusinessListFilters(ui.view.model, ui.type));
        setBusinessListFilters(ui.view.model, ui.type, filters);
        if (changed) clearBusinessListSelection(ui.view.model, ui.type);
        ui.view.model.currentPage[ui.type] = 1;
        ui.view.model.savePage?.(ui.type);
        closePanel(ui);
        await ui.view[RENDERS[ui.type]]();
      } catch (error) {
        showError(ui, error.message || "Không thể áp dụng bộ lọc.");
      }
    }
    const remove = event.target.closest("[data-filter-remove]");
    if (remove) { ui.draft.splice(Number(remove.dataset.filterRemove), 1); ui.generation += 1; renderConditions(ui); ui.panel.querySelector("summary")?.focus(); }
    const more = event.target.closest("[data-filter-load-more]");
    if (more) {
      const index = Number(more.dataset.filterLoadMore);
      void loadFilterOptions(ui, index, { more: true, query: ui.panel.querySelector(`[data-filter-option-search="${index}"]`)?.value || "" });
    }
  });
  ui.panel.addEventListener("change", (event) => {
    if (!hasCurrentScope(ui) || !ui.draft) return;
    const target = event.target;
    if (target.matches("[data-filter-field]")) {
      if (target.checked) {
        const choice = filterChoices(ui.type).find((entry) => entry.id === target.value);
        if (choice && ui.draft.length < 24) ui.draft.push({ field: choice.key, operator: choice.operator, value: choice.operator === "range" ? { min: "", max: "" } : choice.operator === "contains" ? "" : [] });
      } else ui.draft = ui.draft.filter((condition) => keyOf(condition) !== target.value);
      ui.generation += 1;
      renderConditions(ui);
    }
    if (target.matches("[data-filter-operator]")) ui.draft[Number(target.dataset.filterOperator)].operator = target.value;
    if (target.matches("[data-filter-value]")) {
      const index = Number(target.dataset.filterValue);
      const condition = ui.draft[index];
      const values = new Set(Array.isArray(condition.value) ? condition.value : [condition.value].filter(Boolean));
      if (target.checked) values.add(target.value); else values.delete(target.value);
      condition.value = [...values];
      condition.operator = condition.operator === "month" ? "month" : "in";
      const summary = target.closest("details")?.querySelector("[data-filter-value-summary]");
      if (summary) summary.textContent = values.size ? `Đã chọn ${values.size} giá trị` : "Chọn một hoặc nhiều giá trị";
      showError(ui);
    }
  });
  ui.panel.addEventListener("input", (event) => {
    if (!hasCurrentScope(ui) || !ui.draft) return;
    const target = event.target;
    if (target.matches("[data-filter-field-search]")) {
      const query = searchText(target.value);
      for (const label of ui.panel.querySelectorAll("[data-field-choice-label]")) label.hidden = !label.dataset.fieldChoiceLabel.includes(query);
    }
    if (target.matches("[data-filter-index]")) {
      const condition = ui.draft[Number(target.dataset.filterIndex)];
      if (target.hasAttribute("data-filter-bound")) condition.value[target.dataset.filterBound] = target.value;
      else condition.value = target.hasAttribute("data-filter-years") ? target.value.split(/[,;\s]+/).filter(Boolean) : target.value;
      showError(ui);
    }
    if (target.matches("[data-filter-option-search]")) {
      const index = Number(target.dataset.filterOptionSearch);
      const query = target.value;
      ui.panel.querySelector(`[data-filter-option-list="${index}"]`).innerHTML = trustedHTML(optionMarkup(ui, ui.draft[index], index, query));
      const more = ui.panel.querySelector(`[data-filter-load-more="${index}"]`);
      if (more) { more.hidden = true; more.disabled = true; }
      clearTimeout(ui.searchTimers.get(index));
      const generation = ui.generation;
      const field = ui.draft[index].field;
      ui.searchTimers.set(index, setTimeout(() => {
        if (ui.generation === generation && ui.draft?.[index]?.field === field) void loadFilterOptions(ui, index, { query });
      }, 250));
    }
  });
  ui.panel.addEventListener("toggle", (event) => {
    const details = event.target;
    if (details.matches?.("[data-filter-options]") && details.open) {
      const index = Number(details.dataset.filterOptions);
      const cached = ui.options.get(ui.draft?.[index]?.field);
      const query = details.querySelector("[data-filter-option-search]")?.value || "";
      if (!cached || cached.generation !== ui.generation || cached.query !== query || cached.error) void loadFilterOptions(ui, index, { query });
    }
  }, true);
  ui.panel.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !event.defaultPrevented) {
      const controls = [...ui.panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((control) => control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation();
    const details = event.target.closest("details[open]");
    if (details) { details.open = false; details.querySelector("summary")?.focus(); }
    else closePanel(ui);
  });
}

function displayedItems(view, type) {
  const items = businessListState(view.model, type).selection.items;
  const records = view.model.state[type] || [];
  const versions = view.model.state[VERSION_MAPS[type]] || {};
  const ui = binding(view, type);
  return items.map((record) => {
    const root = String(record.rootId || record.id);
    const rendered = ui?.displayed.get(root);
    if (rendered) return { ...rendered, rootId: root };
    let id = versions[root];
    if (type === "goithau" && view.model.state.selectedPackageVersionIntent?.[root] !== "historical") id = record.id;
    const displayed = records.find((candidate) => String(candidate.id) === String(id)) || record;
    return { ...displayed, rootId: root };
  });
}

export function refreshBusinessListSelection(view, type) {
  const table = document.getElementById(`${type}-table`);
  if (!table) return;
  const page = displayedItems(view, type);
  const selectedCount = page.filter((record) => isBusinessListRowSelected(view.model, type, record)).length;
  const ui = binding(view, type);
  if (ui?.pendingBulkDelete && !pendingDeleteScopeIsCurrent(ui)) ui.pendingBulkDelete = null;
  const loading = Boolean(ui?.bulkDeleting || (ui?.loading && !ui?.pendingBulkDelete));
  for (const header of document.getElementById(`tab-${type}`)?.querySelectorAll("[data-list-select-page]") || []) {
    header.checked = page.length > 0 && selectedCount === page.length;
    header.indeterminate = selectedCount > 0 && selectedCount < page.length;
    header.disabled = !page.length || loading;
  }
  for (const checkbox of table.querySelectorAll("[data-list-select-row]")) {
    checkbox.disabled = loading;
    checkbox.checked = isBusinessListRowSelected(view.model, type, { id: checkbox.dataset.recordId }, checkbox.dataset.rootId);
    const row = checkbox.closest("tr");
    row?.classList.toggle("business-list-row-selected", checkbox.checked);
    row?.setAttribute("aria-selected", String(checkbox.checked));
  }
  const descriptor = getBusinessListSelection(view.model, type);
  const bar = document.getElementById(`${type}-row-selection`);
  if (!bar) return;
  bar.hidden = !descriptor.count && !ui?.pendingBulkDelete;
  const allowDelete = view.model.state.activerole !== "employee";
  const signature = JSON.stringify([descriptor.mode, descriptor.count, descriptor.totalItems, selectedCount === page.length, page.length, loading, allowDelete, ui?.pendingBulkDelete?.count]);
  if (bar.dataset.selectionSignature === signature) return;
  bar.dataset.selectionSignature = signature;
  bar.innerHTML = trustedHTML(`<strong>${ui?.pendingBulkDelete ? `Chưa xác định kết quả xóa ${ui.pendingBulkDelete.count.toLocaleString("vi-VN")} ${LABELS[type]}` : `Đã chọn ${descriptor.count.toLocaleString("vi-VN")} ${LABELS[type]}`}</strong>
    ${descriptor.mode === "query" ? '<span class="business-filter-hint">Theo kết quả của bộ lọc hiện tại</span>' : selectedCount === page.length && page.length && descriptor.totalItems > descriptor.count ? `<button type="button" class="btn btn-outline" data-list-selection-action="all" ${loading ? "disabled" : ""}>Chọn tất cả ${descriptor.totalItems.toLocaleString("vi-VN")} kết quả</button>` : '<span class="business-filter-hint">Lựa chọn được giữ khi chuyển trang.</span>'}
    ${allowDelete ? `<button type="button" class="btn btn-danger" data-list-selection-action="delete" ${loading ? "disabled" : ""}>${ui?.bulkDeleting ? "Đang xử lý…" : ui?.pendingBulkDelete ? "Kiểm tra kết quả xóa" : "Xóa dữ liệu đã chọn"}</button>` : ""}
    <button type="button" class="btn btn-outline" data-list-selection-action="clear" ${ui?.bulkDeleting ? "disabled" : ""}>Bỏ chọn</button>`);
}

export function updateBusinessListSelection(view, type, page) {
  const ui = binding(view, type);
  if (ui) ui.loading = false;
  ui?.displayed.clear();
  setBusinessListPage(view.model, type, page);
  refreshBusinessListSelection(view, type);
}

export function markBusinessListLoading(view, type) {
  const ui = binding(view, type);
  if (ui) ui.loading = true;
  refreshBusinessListSelection(view, type);
}

export function renderBusinessListSelectionCell(view, type, record, rootId) {
  const root = String(rootId || record.rootId || record.id);
  binding(view, type)?.displayed.set(root, record);
  reconcileBusinessListRowVersion(view.model, type, record, root);
  const selected = isBusinessListRowSelected(view.model, type, record, root);
  const label = record.maKeHoach || record.maGoiThau || record.soHopDong || record.id;
  return `<td class="business-list-selection-cell" data-label="Chọn"><label class="business-list-checkbox-target"><input type="checkbox" data-list-select-row="${type}" data-root-id="${esc(root)}" data-record-id="${esc(String(record.id))}" data-version="${esc(String(record.phienBan ?? ""))}" aria-label="Chọn ${esc(label)}${record.phienBan != null ? `, phiên bản ${esc(String(record.phienBan))}` : ""}" ${selected ? "checked" : ""}></label></td>`;
}

export function ensureBusinessListControls(view, type) {
  const tab = document.getElementById(`tab-${type}`);
  const panel = document.getElementById(`${type}-filter-panel`);
  const button = tab?.querySelector(`[data-list-filter="${type}"]`);
  if (!tab || !panel || !button) return;
  migrateLegacyFilters(view, type);
  if (!BINDINGS.has(view)) BINDINGS.set(view, new Map());
  let ui = binding(view, type);
  if (!ui || ui.tab !== tab) {
    ui = { view, type, tab, panel, button, draft: null, generation: 0, options: new Map(), searchTimers: new Map(), displayed: new Map(), state: businessListState(view.model, type) };
    BINDINGS.get(view).set(type, ui);
    const mobile = document.createElement("div");
    mobile.className = "business-list-mobile-selection";
    mobile.innerHTML = trustedHTML(`<label class="business-filter-option"><input type="checkbox" data-list-select-page="${type}" aria-label="Chọn các dòng ${LABELS[type]} trang hiện tại"><span>Chọn trang này</span></label>`);
    panel.insertAdjacentElement("afterend", mobile);
    button.addEventListener("click", () => panel.hidden ? openPanel(ui) : closePanel(ui));
    bindPanel(ui);
    tab.addEventListener("change", (event) => {
      const target = event.target;
      if (!hasCurrentScope(ui) || ui.loading || ui.bulkDeleting) return;
      if (target.matches("[data-list-select-page]")) selectBusinessListPage(view.model, type, displayedItems(view, type), target.checked);
      if (target.matches("[data-list-select-row]")) toggleBusinessListRow(view.model, type, { id: target.dataset.recordId, phienBan: target.dataset.version }, target.checked, target.dataset.rootId);
    });
    tab.addEventListener("input", (event) => {
      if (event.target.id !== `search-${type}`) return;
      const previous = getBusinessListSelection(view.model, type).query.search || "";
      if (String(event.target.value).toLocaleLowerCase("vi") !== previous) markBusinessListLoading(view, type);
    });
    tab.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-list-selection-action]")?.dataset.listSelectionAction;
      if (action && !hasCurrentScope(ui) && !(action === "delete" && pendingDeleteScopeIsCurrent(ui))) return;
      if (action && ui.bulkDeleting) return;
      if (action === "delete" && (!ui.loading || ui.pendingBulkDelete) && view.model.state.activerole !== "employee") {
        ui.bulkDeleting = true;
        refreshBusinessListSelection(view, type);
        try {
          const { deleteSelectedBusinessListRows } = await import("./BusinessListBulkDelete.js");
          if (hasCurrentScope(ui)) await deleteSelectedBusinessListRows(view, type);
        } catch (error) {
          if (hasCurrentScope(ui)) view.showToast?.("Không thể xóa", error?.message || "Chưa mở được thao tác xóa. Vui lòng thử lại.", "error");
        } finally {
          ui.bulkDeleting = false;
          if (hasCurrentScope(ui)) refreshBusinessListSelection(view, type);
        }
      }
      if (action === "clear") {
        clearBusinessListSelection(view.model, type);
        [...tab.querySelectorAll("[data-list-select-page]")].find((control) => control.getClientRects().length && !control.disabled)?.focus();
      }
      if (action === "all" && !ui.loading) {
        selectAllBusinessListResults(view.model, type, displayedItems(view, type));
        tab.querySelector('[data-list-selection-action="clear"]')?.focus();
      }
    });
    window.addEventListener("bf:business-list-selection-changed", (event) => {
      if (event.detail?.model === view.model && event.detail.type === type && tab.isConnected) refreshBusinessListSelection(view, type);
    });
    window.addEventListener("bf:business-list-delete-pending", (event) => {
      if (event.detail?.model !== view.model || event.detail.type !== type || !tab.isConnected) return;
      hasCurrentScope(ui);
      const pending = { count: event.detail.count, scope: event.detail.scope };
      ui.pendingBulkDelete = event.detail.pending && pendingDeleteScopeIsCurrent(ui, pending) ? pending : null;
      refreshBusinessListSelection(view, type);
    });
    window.addEventListener("bf:workspace-changed", () => {
      if (tab.isConnected) { closePanel(ui, false); ui.displayed.clear(); ui.pendingBulkDelete = null; refreshBusinessListSelection(view, type); }
    });
  }
  const state = businessListState(view.model, type);
  if (ui.state !== state) { ui.state = state; ui.displayed.clear(); if (!pendingDeleteScopeIsCurrent(ui)) ui.pendingBulkDelete = null; closePanel(ui, false); }
  updateFilterButton(ui);
  return loadStyleOnce(STYLESHEET_URL);
}
