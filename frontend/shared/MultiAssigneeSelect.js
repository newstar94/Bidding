import { generateRecordId } from "./idUtils.js";

export function normalizeAssigneeIds(values) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function selectedAssigneeIds(select) {
  if (!select) return [];
  return normalizeAssigneeIds(
    Array.from(select.selectedOptions || []).map((option) => option.value),
  );
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

export function filterAvailableAssigneeOptions(options, selectedIds, query = "") {
  const selected = new Set(normalizeAssigneeIds(selectedIds));
  const normalizedQuery = normalizeSearchText(query);
  return (options || []).filter((option) => {
    const value = String(option?.value || "").trim();
    if (!value || option?.disabled || selected.has(value)) return false;
    const searchText = normalizeSearchText(
      `${option?.label || ""} ${option?.searchText || ""}`,
    );
    return !normalizedQuery || searchText.includes(normalizedQuery);
  });
}

export function assignmentRowsFor(assignments, targetId, type) {
  return (assignments || []).filter((assignment) => (
    String(assignment?.targetId || "") === String(targetId || "")
    && String(assignment?.type || "") === String(type || "")
  ));
}

const INACTIVE_ASSIGNEE_LABEL = "Nhân sự không còn hoạt động";

export function formatAssigneeSummary(labels, { compact = false } = {}) {
  const safeLabels = (labels || []).map((label) => String(label || "").trim()).filter(Boolean);
  if (!safeLabels.length) return "Chưa phân công";
  if (!compact || safeLabels.length === 1) return safeLabels.join(", ");
  return `${safeLabels[0]} +${safeLabels.length - 1}`;
}

export function assigneeLabelsForTarget(model, targetId, type) {
  const employees = [
    ...(model?.state?.employees || []),
    ...(model?.state?.activeuser ? [model.state.activeuser] : []),
  ];
  const byId = new Map(employees.map((employee) => [
    String(employee?.id || ""),
    String(
      employee?.name
      || employee?.tenNhanSu
      || employee?.organizationProfile?.name
      || employee?.email
      || INACTIVE_ASSIGNEE_LABEL,
    ).trim(),
  ]));
  return assignmentRowsFor(model?.state?.assignments, targetId, type)
    .map((assignment) => byId.get(String(assignment.empId)) || INACTIVE_ASSIGNEE_LABEL)
    .filter(Boolean);
}

export function computeAssignmentDelta(existingAssignments, selectedIds) {
  const selected = new Set(normalizeAssigneeIds(selectedIds));
  const existingByEmployee = new Map();
  for (const assignment of existingAssignments || []) {
    const employeeId = String(assignment?.empId || "").trim();
    if (employeeId && !existingByEmployee.has(employeeId)) {
      existingByEmployee.set(employeeId, assignment);
    }
  }
  return {
    addedIds: [...selected].filter((employeeId) => !existingByEmployee.has(employeeId)),
    removedAssignments: [...existingByEmployee]
      .filter(([employeeId]) => !selected.has(employeeId))
      .map(([, assignment]) => assignment),
    unchangedAssignments: [...existingByEmployee]
      .filter(([employeeId]) => selected.has(employeeId))
      .map(([, assignment]) => assignment),
  };
}

export async function applyAssignmentDelta(model, { targetId, type, selectedIds }) {
  const existing = assignmentRowsFor(model?.state?.assignments, targetId, type);
  const delta = computeAssignmentDelta(existing, selectedIds);
  for (const assignment of delta.removedAssignments) {
    await model.deleteRecord("assignments", assignment.id);
  }
  for (const employeeId of delta.addedIds) {
    await model.addRecord("assignments", {
      id: generateRecordId("assignments"),
      empId: employeeId,
      targetId,
      type,
    });
  }
  return delta;
}

function renderChips(select, chips) {
  chips.replaceChildren();
  const selectedOptions = Array.from(select.selectedOptions || [])
    .filter((option) => String(option.value || "").trim());
  chips.hidden = selectedOptions.length === 0;
  for (const option of selectedOptions) {
    const chip = document.createElement("span");
    chip.className = "multi-assignee-chip";
    chip.textContent = option.textContent || option.value;
    if (!select.disabled) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Bỏ ${option.textContent || option.value}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        option.selected = false;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.__bfMultiAssigneeSelect?.focus({ open: false });
      });
      chip.appendChild(remove);
    }
    chips.appendChild(chip);
  }
}

export function initializeMultiAssigneeSelect(select, {
  selectedIds = [],
  disabled = false,
  searchPlaceholder = "Chọn hoặc tìm chuyên viên phụ trách...",
} = {}) {
  if (!select) return;
  select.__bfMultiAssigneeSelect?.destroy();
  select.multiple = true;
  select.dataset.noCustom = "true";
  select.disabled = Boolean(disabled);
  const selected = new Set(normalizeAssigneeIds(selectedIds));
  Array.from(select.options).forEach((option) => {
    option.selected = selected.has(String(option.value || "").trim());
  });

  select.parentElement
    ?.querySelector(`.multi-assignee-tools[data-select-id="${select.id}"]`)
    ?.remove();
  const tools = document.createElement("div");
  tools.className = "multi-assignee-tools";
  tools.dataset.selectId = select.id;

  const combobox = document.createElement("div");
  combobox.className = "multi-assignee-combobox";
  const search = document.createElement("input");
  search.id = `${select.id}-search`;
  search.type = "text";
  search.className = "multi-assignee-search";
  search.placeholder = searchPlaceholder;
  search.autocomplete = "off";
  search.spellcheck = false;
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-haspopup", "listbox");
  search.setAttribute("aria-expanded", "false");
  if (select.getAttribute("aria-describedby")) {
    search.setAttribute("aria-describedby", select.getAttribute("aria-describedby"));
  }
  search.disabled = select.disabled;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "multi-assignee-toggle";
  toggle.tabIndex = -1;
  toggle.disabled = select.disabled;
  toggle.setAttribute("aria-label", "Mở danh sách chuyên viên");
  const chevron = document.createElement("span");
  chevron.className = "multi-assignee-chevron";
  chevron.setAttribute("aria-hidden", "true");
  toggle.appendChild(chevron);

  const list = document.createElement("ul");
  list.id = `${select.id}-listbox`;
  list.className = "multi-assignee-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-multiselectable", "true");
  list.hidden = true;
  search.setAttribute("aria-controls", list.id);

  const chips = document.createElement("div");
  chips.className = "multi-assignee-chips";
  chips.setAttribute("aria-live", "polite");
  chips.setAttribute("aria-label", "Chuyên viên đã chọn");
  combobox.append(search, toggle, list);
  tools.append(combobox, chips);
  select.insertAdjacentElement("afterend", tools);

  select.classList.add("multi-assignee-native");
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;

  const label = document.querySelector(
    `label[for="${select.id}"], label[for="${search.id}"]`,
  );
  if (label) label.htmlFor = search.id;

  let visibleItems = [];
  let activeIndex = -1;

  const setOpen = (open) => {
    const nextOpen = Boolean(open) && !select.disabled;
    combobox.classList.toggle("open", nextOpen);
    list.hidden = !nextOpen;
    search.setAttribute("aria-expanded", String(nextOpen));
    toggle.setAttribute(
      "aria-label",
      nextOpen ? "Đóng danh sách chuyên viên" : "Mở danh sách chuyên viên",
    );
    if (!nextOpen) {
      activeIndex = -1;
      search.removeAttribute("aria-activedescendant");
    }
  };

  const setActiveIndex = (nextIndex) => {
    if (!visibleItems.length) {
      activeIndex = -1;
      search.removeAttribute("aria-activedescendant");
      return;
    }
    activeIndex = (nextIndex + visibleItems.length) % visibleItems.length;
    visibleItems.forEach(({ element }, index) => {
      element.classList.toggle("highlighted", index === activeIndex);
    });
    const active = visibleItems[activeIndex].element;
    search.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  };

  const renderOptions = () => {
    const optionData = Array.from(select.options).map((option) => ({
      value: option.value,
      label: String(option.textContent || option.value).trim(),
      searchText: option.dataset.search || "",
      disabled: option.disabled,
      option,
    }));
    const available = filterAvailableAssigneeOptions(
      optionData,
      selectedAssigneeIds(select),
      search.value,
    );
    const fragment = document.createDocumentFragment();
    visibleItems = [];
    activeIndex = -1;
    search.removeAttribute("aria-activedescendant");

    available.forEach((item, index) => {
      const listItem = document.createElement("li");
      listItem.id = `${select.id}-option-${index}`;
      listItem.className = "multi-assignee-option";
      listItem.dataset.value = item.value;
      listItem.textContent = item.label;
      listItem.setAttribute("role", "option");
      listItem.setAttribute("aria-selected", "false");
      fragment.appendChild(listItem);
      visibleItems.push({ element: listItem, option: item.option });
    });

    if (!available.length) {
      const empty = document.createElement("li");
      empty.className = "multi-assignee-empty";
      empty.setAttribute("role", "option");
      empty.setAttribute("aria-disabled", "true");
      const selectableCount = optionData.filter((option) => option.value && !option.disabled).length;
      empty.textContent = search.value.trim()
        ? "Không tìm thấy chuyên viên phù hợp"
        : selectedAssigneeIds(select).length >= selectableCount && selectableCount > 0
          ? "Đã chọn tất cả chuyên viên"
          : "Không còn chuyên viên để chọn";
      fragment.appendChild(empty);
    }
    list.replaceChildren(fragment);
  };

  const chooseOption = (option) => {
    if (!option || option.disabled) return;
    option.selected = true;
    search.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    renderOptions();
    setOpen(false);
  };

  const onSearchFocus = () => {
    renderOptions();
    setOpen(true);
  };
  const onSearchClick = () => {
    renderOptions();
    setOpen(true);
  };
  const onSearchInput = () => {
    renderOptions();
    setOpen(true);
  };
  const onSearchKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(activeIndex < 0 ? visibleItems.length - 1 : activeIndex - 1);
    } else if (event.key === "Enter" && combobox.classList.contains("open")) {
      event.preventDefault();
      chooseOption(visibleItems[activeIndex >= 0 ? activeIndex : 0]?.option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      search.value = "";
      setOpen(false);
    }
  };
  const onToggleClick = () => {
    if (combobox.classList.contains("open")) {
      setOpen(false);
    } else {
      search.focus();
      renderOptions();
      setOpen(true);
    }
  };
  const onListMouseMove = (event) => {
    const item = event.target.closest(".multi-assignee-option");
    const index = visibleItems.findIndex(({ element }) => element === item);
    if (index >= 0 && index !== activeIndex) setActiveIndex(index);
  };
  const onListMouseDown = (event) => event.preventDefault();
  const onListClick = (event) => {
    const item = event.target.closest(".multi-assignee-option");
    const match = visibleItems.find(({ element }) => element === item);
    chooseOption(match?.option);
  };
  const onSelectChange = () => {
    select.closest(".form-group")?.classList.remove("invalid");
    search.removeAttribute("aria-invalid");
    renderChips(select, chips);
    renderOptions();
  };
  const onSelectInvalid = (event) => {
    event.preventDefault();
    select.closest(".form-group")?.classList.add("invalid");
    search.setAttribute("aria-invalid", "true");
    search.focus();
  };
  const onDocumentPointerDown = (event) => {
    if (!tools.contains(event.target)) setOpen(false);
  };
  const onFocusOut = () => {
    setTimeout(() => {
      if (!tools.contains(document.activeElement)) setOpen(false);
    }, 0);
  };

  search.addEventListener("focus", onSearchFocus);
  search.addEventListener("click", onSearchClick);
  search.addEventListener("input", onSearchInput);
  search.addEventListener("keydown", onSearchKeyDown);
  toggle.addEventListener("click", onToggleClick);
  list.addEventListener("mousemove", onListMouseMove);
  list.addEventListener("mousedown", onListMouseDown);
  list.addEventListener("click", onListClick);
  select.addEventListener("change", onSelectChange);
  select.addEventListener("invalid", onSelectInvalid);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  tools.addEventListener("focusout", onFocusOut);

  const api = {
    focus: ({ open = true } = {}) => {
      search.focus();
      if (!open) setOpen(false);
    },
    refresh: onSelectChange,
    destroy: () => {
      setOpen(false);
      select.removeEventListener("change", onSelectChange);
      select.removeEventListener("invalid", onSelectInvalid);
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      tools.removeEventListener("focusout", onFocusOut);
      tools.remove();
      select.classList.remove("multi-assignee-native");
      select.removeAttribute("aria-hidden");
      select.removeAttribute("tabindex");
      if (label) label.htmlFor = select.id;
      if (select.__bfMultiAssigneeSelect === api) select.__bfMultiAssigneeSelect = null;
    },
  };
  select.__bfMultiAssigneeSelect = api;
  renderChips(select, chips);
  renderOptions();
}
