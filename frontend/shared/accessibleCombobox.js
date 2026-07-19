function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/gu, "d")
    .replace(/Đ/gu, "D")
    .toLocaleLowerCase("vi")
    .trim();
}

function selectedLabel(select) {
  const option = select.options[select.selectedIndex];
  return option?.value ? option.text.trim() : "";
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
    ...initialConfig
  };
  const wrapper = document.createElement("div");
  wrapper.className = "bf-combobox";
  wrapper.dataset.selectId = select.id;

  const input = document.createElement("input");
  input.id = `${select.id}-combobox`;
  input.type = "text";
  input.className = "bf-combobox-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-haspopup", "listbox");
  input.setAttribute("aria-expanded", "false");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "bf-combobox-toggle";
  toggle.setAttribute("aria-label", "Mở danh sách lựa chọn");
  toggle.tabIndex = -1;
  const chevron = document.createElement("span");
  chevron.className = "bf-combobox-chevron";
  chevron.setAttribute("aria-hidden", "true");
  toggle.appendChild(chevron);

  const list = document.createElement("ul");
  list.id = `${select.id}-listbox`;
  list.className = "bf-combobox-list";
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

  const setOpen = (open, { restoreSelection = false } = {}) => {
    const nextOpen = Boolean(open) && !select.disabled;
    wrapper.classList.toggle("open", nextOpen);
    list.hidden = !nextOpen;
    input.setAttribute("aria-expanded", String(nextOpen));
    if (!nextOpen) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      if (restoreSelection) input.value = selectedLabel(select);
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
    if (!option) return;
    select.value = option.value;
    input.value = option.value ? option.text.trim() : "";
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
      item.dataset.value = option.value;
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
    wrapper.classList.toggle("disabled", select.disabled);
    wrapper.classList.toggle("is-searchable", config.searchable);
    const renderedQuery = query === undefined
      ? preserveQuery ? input.value : ""
      : String(query || "");
    input.value = preserveQuery || query !== undefined
      ? renderedQuery
      : selectedLabel(select);
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
    } else if (event.key === "Enter" && wrapper.classList.contains("open")) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex >= 0 ? activeIndex : 0]);
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
  select.addEventListener("change", () => refresh());
  document.addEventListener("pointerdown", (event) => {
    if (!wrapper.contains(event.target)) setOpen(false, { restoreSelection: true });
  });
  wrapper.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) {
        setOpen(false, { restoreSelection: true });
      }
    }, 0);
  });

  const api = { configure, refresh, close: () => setOpen(false, { restoreSelection: true }) };
  select.__bfAccessibleCombobox = api;
  refresh();
  return api;
}
