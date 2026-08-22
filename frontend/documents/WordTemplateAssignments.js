import { canManageWorkspaceWordVariables } from "../auth/accessContext.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import {
  loadWordPublicationTemplateConfig,
  saveWordPublicationTemplateAssignments,
} from "./WordPublicationTemplateConfig.js";
import { WORD_PUBLICATION_DOCUMENTS } from "./WordPublicationPolicy.js";

const WORD_TEMPLATE_ASSIGNMENTS_STYLESHEET_URL = new URL(
  "./WordTemplateAssignments.css?no-inline", import.meta.url,
).pathname;
const PICKER_PAGE_SIZE = 20;

export function loadWordTemplateAssignmentStyles() {
  return loadStyleOnce(WORD_TEMPLATE_ASSIGNMENTS_STYLESHEET_URL);
}

function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent !== undefined) element.textContent = textContent;
  return element;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/gu, "d")
    .replace(/Đ/gu, "D")
    .toLocaleLowerCase("vi")
    .trim();
}

function normalizeAssignments(config) {
  const source = config?.assignmentSets || config?.assignments || {};
  return Object.fromEntries(Object.entries(source).flatMap(([documentType, value]) => {
    const candidates = Array.isArray(value) ? value : [value];
    const selected = candidates.map((item) => String(item || "").trim()).filter(Boolean);
    return selected.length ? [[documentType, selected]] : [];
  }));
}

function fallbackTemplate(config, documentType) {
  const resolved = config?.resolvedTemplateSets?.[documentType.id]
    || (config?.resolvedTemplates?.[documentType.id]
      ? [config.resolvedTemplates[documentType.id]]
      : []);
  return resolved.find((item) => item?.source === "legacy-active")?.filename || "";
}

function assignmentStatus(config, documentType, selected) {
  if (selected.length) {
    return { label: `Đã gán ${selected.length} biểu mẫu`, className: "is-configured" };
  }
  if (fallbackTemplate(config, documentType)) {
    return { label: "Theo mẫu tương thích", className: "is-fallback" };
  }
  return { label: "Chưa cấu hình", className: "is-missing" };
}

function orderedSelection(templates, selected) {
  const identities = new Set([...selected].map((item) => String(item).toLocaleLowerCase("vi")));
  return templates.map((template) => String(template.filename || "")).filter((filename) => (
    identities.has(filename.toLocaleLowerCase("vi"))
  ));
}

function collectAssignments(controller) {
  const state = controller._wordTemplateAssignmentState;
  if (!state) return {};
  return Object.fromEntries(Object.entries(state.draft).flatMap(([documentType, filenames]) => (
    filenames.length ? [[documentType, [...filenames]]] : []
  )));
}

function renderSelectionPreview(container, filenames, fallback = "") {
  container.replaceChildren();
  const values = filenames.length ? filenames : fallback ? [fallback] : [];
  if (!values.length) {
    container.appendChild(createElement(
      "span",
      "word-template-assignment-preview-empty",
      "Chưa chọn biểu mẫu",
    ));
    return;
  }
  values.slice(0, 3).forEach((filename) => {
    const chip = createElement("span", "word-template-assignment-chip", filename);
    chip.title = filename;
    container.appendChild(chip);
  });
  if (values.length > 3) {
    container.appendChild(createElement(
      "span",
      "word-template-assignment-chip is-count",
      `+${values.length - 3}`,
    ));
  }
  if (!filenames.length && fallback) {
    container.appendChild(createElement(
      "span",
      "word-template-assignment-fallback-note",
      "Mẫu tương thích",
    ));
  }
}

function updateAssignmentRow(controller, documentType) {
  const state = controller._wordTemplateAssignmentState;
  const root = document.getElementById("word-template-assignment-list");
  const row = root?.querySelector(`[data-document-type="${documentType.id}"]`);
  if (!state || !row) return;
  const selected = state.draft[documentType.id] || [];
  const status = assignmentStatus(state.config, documentType, selected);
  const badge = row.querySelector(".word-template-assignment-badge");
  if (badge) {
    badge.textContent = status.label;
    badge.className = `word-template-assignment-badge ${status.className}`;
  }
  renderSelectionPreview(
    row.querySelector(".word-template-assignment-preview"),
    selected,
    fallbackTemplate(state.config, documentType),
  );
  const count = row.querySelector(".word-template-assignment-trigger-count");
  if (count) count.textContent = String(selected.length);
}

function appendIconButton({ className, icon, label }) {
  const button = createElement("button", className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  const iconElement = document.createElement("i");
  iconElement.dataset.lucide = icon;
  iconElement.setAttribute("aria-hidden", "true");
  button.appendChild(iconElement);
  return button;
}

function createPickerDialog() {
  const dialog = createElement("dialog", "word-template-assignment-dialog");
  dialog.id = "word-template-assignment-dialog";
  dialog.setAttribute("aria-labelledby", "word-template-assignment-dialog-title");
  dialog.setAttribute("aria-describedby", "word-template-assignment-dialog-description");

  const panel = createElement("div", "word-template-assignment-dialog-panel");
  const header = createElement("header", "word-template-assignment-dialog-header");
  const headingGroup = createElement("div", "word-template-assignment-dialog-heading");
  const eyebrow = createElement("span", "word-template-assignment-dialog-eyebrow", "Cài đặt chức năng");
  const title = createElement("h3", "", "Chọn biểu mẫu");
  title.id = "word-template-assignment-dialog-title";
  const description = createElement(
    "p",
    "",
    "Tìm và chọn nhiều file Word. Lựa chọn được giữ khi đổi trang hoặc tìm kiếm.",
  );
  description.id = "word-template-assignment-dialog-description";
  headingGroup.append(eyebrow, title, description);
  const close = appendIconButton({
    className: "word-template-assignment-dialog-close",
    icon: "x",
    label: "Đóng bộ chọn biểu mẫu",
  });
  close.dataset.assignmentPickerClose = "";
  header.append(headingGroup, close);

  const controls = createElement("div", "word-template-assignment-picker-controls");
  const searchGroup = createElement("div", "word-template-assignment-picker-search-group");
  const searchLabel = createElement("label", "", "Tìm biểu mẫu");
  searchLabel.htmlFor = "word-template-assignment-picker-search";
  const searchWrap = createElement("div", "word-template-assignment-picker-search-wrap");
  const searchIcon = document.createElement("i");
  searchIcon.dataset.lucide = "search";
  searchIcon.setAttribute("aria-hidden", "true");
  const search = document.createElement("input");
  search.id = "word-template-assignment-picker-search";
  search.type = "search";
  search.placeholder = "Tên hoặc file biểu mẫu...";
  search.autocomplete = "off";
  search.setAttribute("aria-label", "Tìm biểu mẫu Word");
  searchWrap.append(searchIcon, search);
  searchGroup.append(searchLabel, searchWrap);

  const filters = createElement("div", "word-template-assignment-picker-filters");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Lọc danh sách biểu mẫu");
  const allFilter = createElement("button", "is-active", "Tất cả");
  allFilter.type = "button";
  allFilter.dataset.assignmentPickerFilter = "all";
  allFilter.setAttribute("aria-pressed", "true");
  const selectedFilter = createElement("button", "", "Đã chọn");
  selectedFilter.type = "button";
  selectedFilter.dataset.assignmentPickerFilter = "selected";
  selectedFilter.setAttribute("aria-pressed", "false");
  filters.append(allFilter, selectedFilter);
  controls.append(searchGroup, filters);

  const resultsHeader = createElement("div", "word-template-assignment-picker-results-header");
  const resultCount = createElement("p", "", "0 biểu mẫu");
  resultCount.dataset.assignmentPickerResultCount = "";
  resultCount.setAttribute("role", "status");
  resultCount.setAttribute("aria-live", "polite");
  const bulkActions = createElement("div", "word-template-assignment-picker-bulk-actions");
  const selectResults = createElement("button", "", "Chọn tất cả kết quả");
  selectResults.type = "button";
  selectResults.dataset.assignmentPickerSelectResults = "";
  const clearResults = createElement("button", "", "Bỏ chọn kết quả");
  clearResults.type = "button";
  clearResults.dataset.assignmentPickerClearResults = "";
  bulkActions.append(selectResults, clearResults);
  resultsHeader.append(resultCount, bulkActions);

  const list = createElement("fieldset", "word-template-assignment-picker-list");
  const legend = createElement("legend", "sr-only", "Danh sách biểu mẫu Word");
  const options = createElement("div", "word-template-assignment-picker-options");
  options.dataset.assignmentPickerOptions = "";
  const empty = createElement("p", "word-template-assignment-picker-empty", "Không tìm thấy biểu mẫu phù hợp.");
  empty.hidden = true;
  list.append(legend, options, empty);

  const footer = createElement("footer", "word-template-assignment-dialog-footer");
  const pagination = createElement("div", "word-template-assignment-picker-pagination");
  const previous = appendIconButton({ className: "", icon: "chevron-left", label: "Trang trước" });
  previous.dataset.assignmentPickerPrevious = "";
  const pageStatus = createElement("span", "", "Trang 1/1");
  pageStatus.dataset.assignmentPickerPageStatus = "";
  const next = appendIconButton({ className: "", icon: "chevron-right", label: "Trang sau" });
  next.dataset.assignmentPickerNext = "";
  pagination.append(previous, pageStatus, next);
  const actions = createElement("div", "word-template-assignment-dialog-actions");
  const cancel = createElement("button", "btn btn-outline", "Hủy");
  cancel.type = "button";
  cancel.dataset.assignmentPickerClose = "";
  const apply = createElement("button", "btn btn-primary", "Áp dụng");
  apply.type = "button";
  apply.dataset.assignmentPickerApply = "";
  actions.append(cancel, apply);
  footer.append(pagination, actions);

  panel.append(header, controls, resultsHeader, list, footer);
  dialog.appendChild(panel);
  document.body.appendChild(dialog);
  return dialog;
}

function pickerMatches(context) {
  const query = normalizeSearchText(context.search);
  return context.templates.filter((template) => {
    const filename = String(template.filename || "");
    const matchesSearch = !query || normalizeSearchText(
      `${template.name || ""} ${filename}`,
    ).includes(query);
    const matchesFilter = context.filter !== "selected" || context.working.has(filename);
    return matchesSearch && matchesFilter;
  });
}

function renderPicker(dialog) {
  const context = dialog.__assignmentPickerContext;
  if (!context) return;
  const matches = pickerMatches(context);
  const totalPages = Math.max(1, Math.ceil(matches.length / PICKER_PAGE_SIZE));
  context.page = Math.min(Math.max(1, context.page), totalPages);
  const start = (context.page - 1) * PICKER_PAGE_SIZE;
  const pageItems = matches.slice(start, start + PICKER_PAGE_SIZE);

  const allFilter = dialog.querySelector('[data-assignment-picker-filter="all"]');
  const selectedFilter = dialog.querySelector('[data-assignment-picker-filter="selected"]');
  allFilter.textContent = `Tất cả (${context.templates.length})`;
  selectedFilter.textContent = `Đã chọn (${context.working.size})`;
  [allFilter, selectedFilter].forEach((button) => {
    const active = button.dataset.assignmentPickerFilter === context.filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  dialog.querySelector("[data-assignment-picker-result-count]").textContent = (
    `${matches.length} biểu mẫu · ${context.working.size} đã chọn`
  );
  dialog.querySelector("[data-assignment-picker-page-status]").textContent = (
    `Trang ${context.page}/${totalPages}`
  );
  dialog.querySelector("[data-assignment-picker-previous]").disabled = context.page <= 1;
  dialog.querySelector("[data-assignment-picker-next]").disabled = context.page >= totalPages;

  const options = dialog.querySelector("[data-assignment-picker-options]");
  options.replaceChildren(...pageItems.map((template, index) => {
    const filename = String(template.filename || "");
    const option = createElement("label", "word-template-assignment-picker-option");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = filename;
    checkbox.checked = context.working.has(filename);
    checkbox.disabled = !context.canManage;
    checkbox.id = `word-template-picker-option-${start + index}`;
    const copy = createElement("span", "word-template-assignment-picker-option-copy");
    const displayName = String(template.name || filename);
    const name = createElement("strong", "", displayName);
    copy.appendChild(name);
    if (displayName !== filename) {
      copy.appendChild(createElement("small", "", filename));
    }
    option.append(checkbox, copy);
    return option;
  }));
  dialog.querySelector(".word-template-assignment-picker-empty").hidden = matches.length > 0;
  dialog.querySelector("[data-assignment-picker-select-results]").disabled = (
    !context.canManage || matches.length === 0
  );
  dialog.querySelector("[data-assignment-picker-clear-results]").disabled = (
    !context.canManage || !matches.some((item) => context.working.has(String(item.filename || "")))
  );
  context.controller.view?.createIconsScoped?.(dialog);
}

function bindPickerDialog(dialog) {
  if (dialog.dataset.bound === "true") return;
  dialog.dataset.bound = "true";
  dialog.addEventListener("close", () => {
    const trigger = dialog.__assignmentPickerContext?.trigger;
    dialog.__assignmentPickerContext = null;
    trigger?.focus?.();
  });
  dialog.addEventListener("click", (event) => {
    const context = dialog.__assignmentPickerContext;
    if (!context) return;
    if (event.target.closest?.("[data-assignment-picker-close]")) {
      dialog.close("cancel");
      return;
    }
    const filter = event.target.closest?.("[data-assignment-picker-filter]");
    if (filter) {
      context.filter = filter.dataset.assignmentPickerFilter;
      context.page = 1;
      renderPicker(dialog);
      return;
    }
    if (event.target.closest?.("[data-assignment-picker-previous]")) {
      context.page -= 1;
      renderPicker(dialog);
      return;
    }
    if (event.target.closest?.("[data-assignment-picker-next]")) {
      context.page += 1;
      renderPicker(dialog);
      return;
    }
    if (event.target.closest?.("[data-assignment-picker-select-results]")) {
      pickerMatches(context).forEach((template) => {
        context.working.add(String(template.filename || ""));
      });
      renderPicker(dialog);
      return;
    }
    if (event.target.closest?.("[data-assignment-picker-clear-results]")) {
      pickerMatches(context).forEach((template) => {
        context.working.delete(String(template.filename || ""));
      });
      context.page = 1;
      renderPicker(dialog);
      return;
    }
    if (event.target.closest?.("[data-assignment-picker-apply]")) {
      context.state.draft[context.documentType.id] = orderedSelection(
        context.templates,
        context.working,
      );
      updateAssignmentRow(context.controller, context.documentType);
      const saveButton = document.getElementById("word-template-assignment-save");
      const liveStatus = document.getElementById("word-template-assignment-status");
      if (saveButton) saveButton.disabled = false;
      if (liveStatus) liveStatus.textContent = "Có thay đổi cài đặt chưa lưu.";
      dialog.close("apply");
    }
  });
  dialog.addEventListener("input", (event) => {
    if (!event.target.matches?.("#word-template-assignment-picker-search")) return;
    const context = dialog.__assignmentPickerContext;
    if (!context) return;
    context.search = event.target.value;
    context.page = 1;
    renderPicker(dialog);
  });
  dialog.addEventListener("change", (event) => {
    if (!event.target.matches?.('.word-template-assignment-picker-option input[type="checkbox"]')) return;
    const context = dialog.__assignmentPickerContext;
    if (!context?.canManage) return;
    const checkboxId = event.target.id;
    if (event.target.checked) context.working.add(event.target.value);
    else context.working.delete(event.target.value);
    renderPicker(dialog);
    dialog.querySelector(`#${checkboxId}`)?.focus();
  });
}

function openAssignmentPicker(controller, documentType, trigger) {
  const state = controller._wordTemplateAssignmentState;
  if (!state) return;
  const dialog = document.getElementById("word-template-assignment-dialog")
    || createPickerDialog();
  bindPickerDialog(dialog);
  dialog.querySelector("#word-template-assignment-dialog-title").textContent = state.canManage
    ? `Chọn biểu mẫu cho ${documentType.label}`
    : `Xem biểu mẫu của ${documentType.label}`;
  dialog.querySelector("[data-assignment-picker-apply]").hidden = !state.canManage;
  const cancel = dialog.querySelector('[data-assignment-picker-close].btn');
  cancel.textContent = state.canManage ? "Hủy" : "Đóng";
  const search = dialog.querySelector("#word-template-assignment-picker-search");
  search.value = "";
  dialog.__assignmentPickerContext = {
    controller,
    state,
    documentType,
    templates: state.templates,
    working: new Set(state.draft[documentType.id] || []),
    canManage: state.canManage,
    filter: "all",
    search: "",
    page: 1,
    trigger,
  };
  renderPicker(dialog);
  dialog.showModal();
  search.focus();
}

export function renderWordTemplateAssignments(
  controller,
  templates,
  config,
  { error = "", loading = false } = {},
) {
  const root = document.getElementById("word-template-assignment-list");
  const saveButton = document.getElementById("word-template-assignment-save");
  const liveStatus = document.getElementById("word-template-assignment-status");
  if (!root || !saveButton || !liveStatus) return;

  const canManage = canManageWorkspaceWordVariables(
    controller.model.state.activeuser || {},
    controller.model.state.activerole,
  );
  const availableTemplates = (templates || []).filter((item) => (
    item?.is_available !== false && item?.is_enabled !== false
  ));
  const assignments = normalizeAssignments(config);
  controller._wordTemplateAssignmentState = {
    templates: availableTemplates,
    config: config || {},
    draft: Object.fromEntries(WORD_PUBLICATION_DOCUMENTS.map((documentType) => (
      [documentType.id, assignments[documentType.id] || []]
    ))),
    canManage,
  };

  saveButton.hidden = !canManage;
  saveButton.disabled = true;
  root.setAttribute("aria-busy", String(loading));
  root.replaceChildren();
  if (loading) {
    root.appendChild(createElement(
      "p",
      "word-template-assignment-empty",
      "Đang tải cài đặt biểu mẫu theo chức năng...",
    ));
    liveStatus.textContent = "Đang tải cài đặt biểu mẫu.";
    return;
  }
  if (error) {
    const message = createElement(
      "p",
      "word-template-assignment-empty is-error",
      `Không tải được cài đặt: ${error}`,
    );
    message.setAttribute("role", "alert");
    root.appendChild(message);
    liveStatus.textContent = "Không tải được cài đặt biểu mẫu.";
    return;
  }

  WORD_PUBLICATION_DOCUMENTS.forEach((documentType) => {
    const selected = controller._wordTemplateAssignmentState.draft[documentType.id];
    const row = createElement("article", "word-template-assignment-row");
    row.dataset.documentType = documentType.id;
    const copy = createElement("div", "word-template-assignment-copy");
    const heading = createElement("div", "word-template-assignment-heading");
    const label = createElement("div", "word-template-assignment-label", documentType.label);
    label.id = `word-template-assignment-${documentType.id}-label`;
    const status = assignmentStatus(config, documentType, selected);
    const badge = createElement(
      "span",
      `word-template-assignment-badge ${status.className}`,
      status.label,
    );
    heading.append(label, badge);
    const description = createElement("p", "word-template-assignment-description", documentType.description);
    copy.append(heading, description);

    const selection = createElement("div", "word-template-assignment-selection");
    const preview = createElement("div", "word-template-assignment-preview");
    preview.setAttribute("aria-label", `Biểu mẫu đã gán cho ${documentType.label}`);
    renderSelectionPreview(preview, selected, fallbackTemplate(config, documentType));
    const trigger = createElement("button", "btn btn-outline word-template-assignment-picker-trigger");
    trigger.type = "button";
    trigger.setAttribute(
      "aria-label",
      `${canManage ? "Chọn" : "Xem"} biểu mẫu cho ${documentType.label}`,
    );
    const triggerIcon = document.createElement("i");
    triggerIcon.dataset.lucide = canManage ? "list-filter" : "eye";
    triggerIcon.setAttribute("aria-hidden", "true");
    const triggerText = createElement("span", "", canManage ? "Chọn biểu mẫu" : "Xem biểu mẫu");
    const triggerCount = createElement("span", "word-template-assignment-trigger-count", String(selected.length));
    trigger.append(triggerIcon, triggerText, triggerCount);
    trigger.addEventListener("click", () => openAssignmentPicker(controller, documentType, trigger));
    selection.append(preview, trigger);
    row.append(copy, selection);
    root.appendChild(row);
  });

  liveStatus.textContent = canManage
    ? `${availableTemplates.length} biểu mẫu sẵn sàng để gán theo chức năng.`
    : "Đang hiển thị cài đặt biểu mẫu chỉ đọc.";
  controller.view?.createIconsScoped?.(root.closest(".dashboard-card"));
}

export async function loadAndRenderWordTemplateAssignments(controller, templates) {
  await loadWordTemplateAssignmentStyles();
  controller._wordPublicationTemplates = Array.isArray(templates) ? templates : [];
  renderWordTemplateAssignments(controller, templates, {}, { loading: true });
  try {
    const config = await loadWordPublicationTemplateConfig(controller);
    renderWordTemplateAssignments(controller, templates, config);
    return config;
  } catch (error) {
    renderWordTemplateAssignments(controller, templates, {}, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function setupWordTemplateAssignmentEvents(controller) {
  const saveButton = document.getElementById("word-template-assignment-save");
  const liveStatus = document.getElementById("word-template-assignment-status");
  if (!saveButton || !liveStatus || saveButton.dataset.bound === "true") return;
  saveButton.dataset.bound = "true";
  saveButton.addEventListener("click", async () => {
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    saveButton.setAttribute("aria-busy", "true");
    liveStatus.textContent = "Đang lưu cài đặt biểu mẫu...";
    try {
      const config = await saveWordPublicationTemplateAssignments(
        controller,
        collectAssignments(controller),
      );
      renderWordTemplateAssignments(controller, controller._wordPublicationTemplates || [], config);
      controller.view?.showToast?.(
        "Đã lưu cài đặt",
        "Biểu mẫu Word đã được gán cho các chức năng đã chọn.",
        "success",
      );
    } catch (error) {
      saveButton.disabled = false;
      const message = error instanceof Error ? error.message : String(error);
      liveStatus.textContent = `Không thể lưu cài đặt: ${message}`;
      await controller.view?.customAlert?.("Không thể lưu cài đặt", message, "x-circle");
    } finally {
      saveButton.removeAttribute("aria-busy");
    }
  });
}
