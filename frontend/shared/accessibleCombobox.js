import { setRuntimeStyles } from "./runtimeStyles.js";

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/gu, "d")
    .replace(/Đ/gu, "D")
    .toLocaleLowerCase("vi")
    .trim();
}

function selectedLabel(select, formatter = null) {
  const option = select.options[select.selectedIndex];
  const label = option?.value ? option.text.trim() : "";
  return typeof formatter === "function" ? formatter(label, option) : label;
}

function optionSearchText(option) {
  return normalizeSearchText(
    `${option.text || ""} ${option.getAttribute("data-search") || ""}`
  );
}

export function initAccessibleCombobox(select, initialConfig = {}) {
  if (!select?.id) return null;
  if (select.__bfAccessibleCombobox) {
    select.__bfAccessibleCombobox.configure(initialConfig);
    return select.__bfAccessibleCombobox;
  }

  const config = {
    searchable: true,
    includeEmptyOption: false,
    placeholder: "Chọn dữ liệu",
    noResultsText: "Không tìm thấy dữ liệu phù hợp",
    onQuery: null,
    compatibilityMode: "",
    portal: false,
    showToggle: true,
    formatSelectedLabel: null,
    ...initialConfig
  };
  const original = {
    ariaHidden: select.getAttribute("aria-hidden"),
    dataNoCustom: select.getAttribute("data-no-custom"),
    hidden: select.hidden,
    label: document.querySelector(`label[for="${select.id}"]`),
    tabIndex: select.tabIndex,
  };
  const wrapper = document.createElement("div");
  wrapper.className = "bf-combobox";
  wrapper.dataset.selectId = select.id;
  if (config.compatibilityMode === "custom-select") {
    wrapper.classList.add("custom-select-container");
    wrapper.dataset.target = select.id;
    if (select.closest("table")) wrapper.classList.add("table-select");
    const isVersionSelect = select.classList.contains("page-version-select")
      || select.classList.contains("version-select")
      || select.classList.contains("phienban-select")
      || select.classList.contains("modal-version-select")
      || select.classList.contains("version-droplist");
    if (isVersionSelect) wrapper.classList.add("version-select-container");
    if (select.classList.contains("page-version-select")) wrapper.classList.add("page-version-select");
  } else if (config.compatibilityMode === "searchable-select") {
    wrapper.classList.add("custom-select-wrapper");
  }

  const input = document.createElement("input");
  input.id = `${select.id}-combobox`;
  input.type = "text";
  input.className = "bf-combobox-input";
  if (config.compatibilityMode === "custom-select") input.classList.add("custom-select-trigger");
  if (config.compatibilityMode === "searchable-select") input.classList.add("custom-select-search");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-haspopup", "listbox");
  input.setAttribute("aria-expanded", "false");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "bf-combobox-toggle";
  if (config.compatibilityMode === "custom-select") toggle.classList.add("custom-select-trigger-arrow");
  if (config.compatibilityMode === "searchable-select") toggle.classList.add("custom-select-arrow");
  toggle.setAttribute("aria-label", "Mở danh sách lựa chọn");
  toggle.tabIndex = -1;
  toggle.hidden = config.showToggle === false;
  const chevron = document.createElement("span");
  chevron.className = "bf-combobox-chevron";
  chevron.setAttribute("aria-hidden", "true");
  toggle.appendChild(chevron);

  const list = document.createElement("ul");
  list.id = `${select.id}-listbox`;
  list.className = "bf-combobox-list";
  if (config.compatibilityMode) list.classList.add("custom-select-options");
  if (
    config.compatibilityMode === "custom-select"
    && wrapper.classList.contains("version-select-container")
  ) {
    list.classList.add("version-select-options");
  }
  if (config.compatibilityMode) list.dataset.parent = select.id;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  input.setAttribute("aria-controls", list.id);

  wrapper.append(input, toggle, list);
  select.classList.add("bf-combobox-native");
  select.hidden = true;
  select.setAttribute("data-no-custom", "true");
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;
  select.insertAdjacentElement("afterend", wrapper);

  const label = document.querySelector(`label[for="${select.id}"]`);
  if (label) label.htmlFor = input.id;

  let visibleOptions = [];
  let activeIndex = -1;

  const positionPortalList = () => {
    if (!config.portal) return;
    if (list.parentElement !== document.body) document.body.appendChild(list);
    const rect = input.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    const dropdownHeight = list.offsetHeight || 220;
    const placeAbove = window.innerHeight - rect.bottom < dropdownHeight
      && rect.top > dropdownHeight;
    wrapper.classList.toggle("drop-up", placeAbove);
    setRuntimeStyles(list, {
      position: "absolute",
      minWidth: `${rect.width}px`,
      left: `${rect.left + scrollX}px`,
      top: `${placeAbove ? rect.top + scrollY - dropdownHeight - 4 : rect.bottom + scrollY + 4}px`,
    });
  };

  const setOpen = (open, { restoreSelection = false } = {}) => {
    const nextOpen = Boolean(open) && !select.disabled;
    wrapper.classList.toggle("open", nextOpen);
    list.hidden = !nextOpen;
    setRuntimeStyles(list, { display: nextOpen ? "block" : "none" });
    input.setAttribute("aria-expanded", String(nextOpen));
    toggle.setAttribute(
      "aria-label",
      nextOpen ? "Đóng danh sách lựa chọn" : "Mở danh sách lựa chọn",
    );
    if (nextOpen) positionPortalList();
    if (!nextOpen) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      if (restoreSelection) input.value = selectedLabel(select, config.formatSelectedLabel);
      if (config.portal && list.parentElement !== wrapper) wrapper.appendChild(list);
    }
  };

  const setActiveIndex = (nextIndex) => {
    if (!visibleOptions.length) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    activeIndex = (nextIndex + visibleOptions.length) % visibleOptions.length;
    visibleOptions.forEach((item, index) => {
      item.classList.toggle("highlighted", index === activeIndex);
    });
    const active = visibleOptions[activeIndex];
    input.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  };

  const selectOption = (option) => {
    if (!option || option.disabled) return;
    select.value = option.value;
    input.value = selectedLabel(select, config.formatSelectedLabel);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(false);
  };

  const renderOptions = (query = "") => {
    const normalizedQuery = config.searchable ? normalizeSearchText(query) : "";
    const options = Array.from(select.options).filter((option) => (
      (config.includeEmptyOption || Boolean(option.value))
      && (!normalizedQuery || optionSearchText(option).includes(normalizedQuery))
    ));
    const fragment = document.createDocumentFragment();
    visibleOptions = [];
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");

    options.forEach((option, index) => {
      const item = document.createElement("li");
      item.id = `${select.id}-option-${index}`;
      item.className = "bf-combobox-option";
      if (config.compatibilityMode === "custom-select") item.classList.add("custom-option-item");
      item.dataset.value = option.value;
      item.option = option;
      item.textContent = option.text.trim();
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.value === select.value));
      if (option.value === select.value) item.classList.add("selected");
      fragment.appendChild(item);
      visibleOptions.push(item);
    });

    if (!options.length) {
      const empty = document.createElement("li");
      empty.className = "bf-combobox-empty";
      if (config.compatibilityMode) empty.classList.add("custom-select-no-results");
      empty.textContent = config.noResultsText;
      empty.setAttribute("role", "option");
      empty.setAttribute("aria-disabled", "true");
      fragment.appendChild(empty);
    }
    list.replaceChildren(fragment);
  };

  const refresh = ({ query, preserveQuery = false, keepOpen = false } = {}) => {
    input.disabled = select.disabled;
    input.readOnly = !config.searchable;
    input.setAttribute("aria-autocomplete", config.searchable ? "list" : "none");
    input.placeholder = config.placeholder;
    toggle.disabled = select.disabled;
    toggle.hidden = config.showToggle === false;
    wrapper.classList.toggle("disabled", select.disabled);
    wrapper.classList.toggle("is-searchable", config.searchable);
    for (const attribute of ["aria-describedby", "aria-invalid", "aria-label", "aria-labelledby", "aria-required"]) {
      const value = select.getAttribute(attribute);
      if (value === null) input.removeAttribute(attribute);
      else input.setAttribute(attribute, value);
    }
    if (select.required) input.setAttribute("aria-required", "true");
    input.setAttribute("aria-disabled", String(select.disabled));
    const renderedQuery = query === undefined
      ? preserveQuery ? input.value : ""
      : String(query || "");
    input.value = preserveQuery || query !== undefined
      ? renderedQuery
      : selectedLabel(select, config.formatSelectedLabel);
    renderOptions(renderedQuery);
    if (keepOpen && !select.disabled) setOpen(true);
    else if (select.disabled) setOpen(false);
  };

  const configure = (nextConfig = {}) => {
    Object.assign(config, nextConfig);
    refresh();
  };

  input.addEventListener("focus", () => {
    renderOptions(config.searchable ? "" : input.value);
    setOpen(true);
    if (config.searchable) input.select();
  });
  input.addEventListener("click", () => setOpen(true));
  input.addEventListener("input", () => {
    renderOptions(input.value);
    setOpen(true);
    config.onQuery?.(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(activeIndex < 0 ? visibleOptions.length - 1 : activeIndex - 1);
    } else if (event.key === "Home" && wrapper.classList.contains("open")) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && wrapper.classList.contains("open")) {
      event.preventDefault();
      setActiveIndex(visibleOptions.length - 1);
    } else if (event.key === "Enter" && wrapper.classList.contains("open")) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex >= 0 ? activeIndex : 0]?.option);
    } else if (event.key === " " && !config.searchable) {
      event.preventDefault();
      setOpen(!wrapper.classList.contains("open"));
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false, { restoreSelection: true });
    }
  });
  toggle.addEventListener("click", () => {
    if (wrapper.classList.contains("open")) {
      setOpen(false, { restoreSelection: true });
    } else {
      input.focus();
      setOpen(true);
    }
  });
  list.addEventListener("mousemove", (event) => {
    const item = event.target.closest(".bf-combobox-option");
    const index = visibleOptions.indexOf(item);
    if (index >= 0 && index !== activeIndex) setActiveIndex(index);
  });
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const item = event.target.closest(".bf-combobox-option");
    if (!item) return;
    const option = Array.from(select.options).find((entry) => entry.value === item.dataset.value);
    selectOption(option);
  });
  const onSelectChange = () => refresh();
  const onDocumentPointerDown = (event) => {
    if (!wrapper.contains(event.target) && !list.contains(event.target)) {
      setOpen(false, { restoreSelection: true });
    }
  };
  const onWrapperFocusOut = () => {
    setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) {
        setOpen(false, { restoreSelection: true });
      }
    }, 0);
  };
  select.addEventListener("change", onSelectChange);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  wrapper.addEventListener("focusout", onWrapperFocusOut);
  const onDocumentScroll = (event) => {
    if (event.target === list || list.contains(event.target)) return;
    if (wrapper.classList.contains("open")) setOpen(false, { restoreSelection: true });
  };
  document.addEventListener("scroll", onDocumentScroll, { capture: true, passive: true });
  const parentForm = select.closest("form");
  const onFormReset = () => setTimeout(() => refresh(), 0);
  parentForm?.addEventListener("reset", onFormReset);
  const observer = new MutationObserver(() => refresh({
    preserveQuery: config.searchable && document.activeElement === input,
    keepOpen: wrapper.classList.contains("open"),
  }));
  observer.observe(select, {
    attributes: true,
    attributeFilter: ["disabled", "required", "aria-describedby", "aria-invalid"],
    childList: true,
    subtree: true,
  });

  const api = {
    configure,
    refresh,
    close: () => setOpen(false, { restoreSelection: true }),
    destroy: () => {
      setOpen(false);
      select.removeEventListener("change", onSelectChange);
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("scroll", onDocumentScroll, { capture: true });
      wrapper.removeEventListener("focusout", onWrapperFocusOut);
      parentForm?.removeEventListener("reset", onFormReset);
      observer.disconnect();
      select.classList.remove("bf-combobox-native");
      select.hidden = original.hidden;
      select.tabIndex = original.tabIndex;
      if (original.ariaHidden === null) select.removeAttribute("aria-hidden");
      else select.setAttribute("aria-hidden", original.ariaHidden);
      if (original.dataNoCustom === null) select.removeAttribute("data-no-custom");
      else select.setAttribute("data-no-custom", original.dataNoCustom);
      if (original.label) original.label.htmlFor = select.id;
      wrapper.remove();
      if (select.__bfAccessibleCombobox === api) {
        select.__bfAccessibleCombobox = null;
      }
    }
  };
  select.__bfAccessibleCombobox = api;
  refresh();
  return api;
}
