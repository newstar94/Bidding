import { setRuntimeStyle } from "./runtimeStyles.js";
export {
  getAuthDownloadUrl,
  authFetchDownload,
  authFetchDownloadWithAlert,
} from "./workflow_helpers.js";
import { formatCurrency as formatVndCurrency, formatDate as formatDisplayDate, formatDateOnly as formatDisplayDateOnly } from "./formatters.js";
import { hasUnifiedSelectListener, markUnifiedSelectListenerRegistered } from "./runtimeState.js";
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
export function safeAttr(value) {
  return escapeHtml(value);
}
export const escapeAttribute = safeAttr;
export function htmlIcon(name, attrs = "") {
  const iconName = String(name || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(iconName)) return "";
  const extraAttrs = attrs ? ` ${String(attrs).trim()}` : "";
  return `<i data-lucide="${iconName}"${extraAttrs}></i>`;
}
export function renderEmptyRow(colspan, message, icon = "inbox") {
  const safeColspan = Math.max(1, parseInt(colspan, 10) || 1);
  return `
        <tr>
            <td colspan="${safeColspan}">
                <div class="empty-state">
                    ${htmlIcon(icon)}
                    <p>${escapeHtml(message)}</p>
                </div>
            </td>
        </tr>
    `;
}
export function safeImageSrc(value, cacheKey = "") {
  const src = String(value || "").trim();
  if (src.startsWith("/images/")) {
    try {
      const parsed = new URL(src, window.location.origin);
      if (
        parsed.origin !== window.location.origin
        || !/^\/images\/(?:chuyen_gia|nha_thau)\/[A-Za-z0-9_.-]+\.(?:png|jpg|webp)$/i.test(parsed.pathname)
      ) {
        return "";
      }
      const keys = [...new Set(parsed.searchParams.keys())];
      const hasSignedQuery = ["expires", "org", "sig"].every((key) => parsed.searchParams.has(key));
      if (hasSignedQuery) {
        if (
          keys.length !== 3
          || [...parsed.searchParams.keys()].length !== 3
          || !/^\d{9,12}$/.test(parsed.searchParams.get("expires") || "")
          || !/^[A-Za-z0-9._:-]{1,160}$/.test(parsed.searchParams.get("org") || "")
          || !/^[a-f0-9]{64}$/i.test(parsed.searchParams.get("sig") || "")
        ) {
          return "";
        }
        return `${parsed.pathname}${parsed.search}`;
      }
      if (keys.length > 0) return "";
      const token = String(cacheKey || "").trim();
      return token ? `${parsed.pathname}?v=${encodeURIComponent(token)}` : parsed.pathname;
    } catch (_) {
      return "";
    }
  }
  if (src.startsWith("https://")) {
    try {
      const parsed = new URL(src);
      if (
        parsed.protocol === "https:"
        && parsed.hostname === "lh3.googleusercontent.com"
        && !parsed.username
        && !parsed.password
      ) {
        return parsed.href;
      }
    } catch (_) {
      return "";
    }
  }
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src)) return src;
  return "";
}
export function formatCurrency(value) {
  return formatVndCurrency(value);
}
export function formatDate(dateStr) {
  return formatDisplayDate(dateStr);
}
export function formatDateOnly(dateStr) {
  return formatDisplayDateOnly(dateStr);
}

function customSelectOptionsSignature(options) {
  return JSON.stringify(options.map((option) => [
    String(option.value ?? ""),
    String(option.text ?? ""),
    Boolean(option.selected)
  ]));
}

function renderCustomSelectOptions(optionsList, options, isVersionSelect) {
  const signature = customSelectOptionsSignature(options);
  if (optionsList.dataset.optionsSignature === signature) return false;
  const fragment = document.createDocumentFragment();
  options.forEach((option) => {
    const item = document.createElement("li");
    item.dataset.value = String(option.value ?? "");
    item.className = `custom-option-item${option.selected ? " selected" : ""}`;
    item.textContent = String(option.text ?? "");
    setRuntimeStyle(item, "padding", isVersionSelect ? "4px 14px" : "8px 14px");
    setRuntimeStyle(item, "fontSize", "0.85rem");
    setRuntimeStyle(item, "cursor", "pointer");
    setRuntimeStyle(item, "whiteSpace", "nowrap");
    setRuntimeStyle(item, "color", "var(--text-main)");
    fragment.appendChild(item);
  });
  optionsList.replaceChildren(fragment);
  optionsList.dataset.optionsSignature = signature;
  return true;
}

function bindCustomSelectOptions(optionsList) {
  if (optionsList.__bfCustomSelectEventsBound) return;
  optionsList.__bfCustomSelectEventsBound = true;
  optionsList.addEventListener("mouseover", (event) => {
    const item = event.target.closest?.(".custom-option-item");
    if (!item || !optionsList.contains(item) || item.classList.contains("selected")) return;
    setRuntimeStyle(item, "backgroundColor", "var(--neutral-soft)");
    setRuntimeStyle(item, "color", "var(--primary)");
  });
  optionsList.addEventListener("mouseout", (event) => {
    const item = event.target.closest?.(".custom-option-item");
    if (!item || !optionsList.contains(item) || item.classList.contains("selected")) return;
    setRuntimeStyle(item, "backgroundColor", "");
    setRuntimeStyle(item, "color", "var(--text-main)");
  });
  optionsList.addEventListener("click", (event) => {
    const item = event.target.closest?.(".custom-option-item");
    if (!item || !optionsList.contains(item)) return;
    event.stopPropagation();
    const targetId = optionsList.dataset.parent;
    const targetSelect = document.getElementById(targetId);
    const targetWrapper = document.querySelector(`.custom-select-container[data-target="${targetId}"]`);
    if (!targetSelect || !targetWrapper) return;
    targetSelect.value = item.dataset.value || "";
    targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    targetWrapper.classList.remove("open");
    setRuntimeStyle(optionsList, "display", "none");
    targetWrapper.appendChild(optionsList);
    initCustomSelect(targetId);
  });
}

export function initCustomSelect(selectId) {
  const inventory = globalThis.__BIDDINGFLOW_LEGACY_UI__ ||= { customSelect: {}, inferredButtons: {} };
  inventory.customSelect[selectId] = (inventory.customSelect[selectId] || 0) + 1;
  if (inventory.customSelect[selectId] === 1 && globalThis.location?.hostname === "localhost") {
    console.warn(`[BiddingFlow legacy UI] initCustomSelect(${selectId})`);
  }
  const select = document.getElementById(selectId);
  if (!select) return;
  setRuntimeStyle(select, "display", "none");
  if (!hasUnifiedSelectListener()) {
    document.addEventListener("click", (e) => {
      document.querySelectorAll(".custom-select-container.open").forEach((w) => {
        const targetId = w.getAttribute("data-target");
        const absoluteDropdown = document.querySelector(`.custom-select-options[data-parent="${targetId}"]`) || w.querySelector(".custom-select-options");
        if (!w.contains(e.target) && !(absoluteDropdown && absoluteDropdown.contains(e.target))) {
          w.classList.remove("open");
          if (absoluteDropdown) {
            setRuntimeStyle(absoluteDropdown, "display", "none");
            w.appendChild(absoluteDropdown);
          }
        }
      });
    });
    document.addEventListener("scroll", (e) => {
      if (e.target && e.target.classList && e.target.classList.contains("custom-select-options")) return;
      document.querySelectorAll(".custom-select-container.open").forEach((w) => {
        const targetId = w.getAttribute("data-target");
        const absoluteDropdown = document.querySelector(`.custom-select-options[data-parent="${targetId}"]`);
        w.classList.remove("open");
        if (absoluteDropdown) {
          setRuntimeStyle(absoluteDropdown, "display", "none");
          w.appendChild(absoluteDropdown);
        }
      });
    }, { capture: true, passive: true });
    markUnifiedSelectListenerRegistered();
  }
  let wrapper = select.parentElement.querySelector(`.custom-select-container[data-target="${selectId}"]`);
  const options = Array.from(select.options);
  const selectedOption = select.options[select.selectedIndex] || select.options[0] || { text: "", value: "" };
  let triggerText = selectedOption.text.trim();
  if (triggerText.startsWith("Tháng ")) {
    let coreText = triggerText.substring(6).trim();
    const monthMap = { "một": "1", "hai": "2", "ba": "3", "bốn": "4", "năm": "5", "sáu": "6", "bảy": "7", "tám": "8", "chín": "9", "mười": "10", "mười một": "11", "mười hai": "12" };
    if (monthMap[coreText.toLowerCase()]) coreText = monthMap[coreText.toLowerCase()];
    triggerText = "Th" + coreText;
  }
  const isVersionSelect = select.classList.contains("page-version-select") || select.classList.contains("version-select") || select.classList.contains("phienban-select") || select.classList.contains("modal-version-select") || select.classList.contains("version-droplist");
  const keepDropdownInline = select.dataset.dropdownInline === "true";
  if (!wrapper) {
    document.querySelectorAll(`body > .custom-select-options[data-parent="${selectId}"]`).forEach((stale) => stale.remove());
    wrapper = document.createElement("div");
    wrapper.className = "custom-select-container";
    if (select.closest("table")) wrapper.classList.add("table-select");
    if (isVersionSelect) wrapper.classList.add("version-select-container");
    if (select.classList.contains("page-version-select")) wrapper.classList.add("page-version-select");
    wrapper.setAttribute("data-target", selectId);
    setRuntimeStyle(wrapper, "position", "relative");
    select.parentNode.insertBefore(wrapper, select.nextSibling);
    const trigger = document.createElement("div");
    trigger.className = "custom-select-trigger";
    const triggerLabel = document.createElement("span");
    triggerLabel.textContent = triggerText;
    trigger.appendChild(triggerLabel);
    if (!isVersionSelect) {
      const arrow = document.createElement("div");
      arrow.className = "custom-select-trigger-arrow";
      const icon = document.createElement("i");
      icon.dataset.lucide = "chevron-down";
      icon.className = "bf-s-58050124fc";
      arrow.appendChild(icon);
      trigger.appendChild(arrow);
    }
    const optionsList = document.createElement("ul");
    optionsList.className = "custom-select-options";
    optionsList.dataset.parent = selectId;
    setRuntimeStyle(optionsList, "display", "none");
    setRuntimeStyle(optionsList, "backgroundColor", "var(--bg-card)");
    setRuntimeStyle(optionsList, "border", "1px solid var(--border-color)");
    setRuntimeStyle(optionsList, "borderRadius", isVersionSelect ? "4px" : "var(--radius-md)");
    setRuntimeStyle(optionsList, "boxShadow", "var(--shadow-lg)");
    setRuntimeStyle(optionsList, "zIndex", "999999");
    setRuntimeStyle(optionsList, "listStyle", "none");
    setRuntimeStyle(optionsList, "padding", "6px 0");
    setRuntimeStyle(optionsList, "margin", "0");
    setRuntimeStyle(optionsList, "maxHeight", "220px");
    setRuntimeStyle(optionsList, "overflowY", "auto");
    renderCustomSelectOptions(optionsList, options, isVersionSelect);
    bindCustomSelectOptions(optionsList);
    wrapper.append(trigger, optionsList);
    if (select.disabled) {
      wrapper.classList.add("disabled");
    }
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (select.disabled || wrapper.classList.contains("disabled")) return;
      const wasOpen = wrapper.classList.contains("open");
      const optionsList = document.querySelector(`.custom-select-options[data-parent="${selectId}"]`) || wrapper.querySelector(".custom-select-options");
      document.dispatchEvent(new Event("click"));
      if (!wasOpen && optionsList) {
        wrapper.classList.add("open");
        setRuntimeStyle(optionsList, "display", "block");
        if (keepDropdownInline) {
          if (optionsList.parentElement !== wrapper) wrapper.appendChild(optionsList);
          return;
        }
        document.body.appendChild(optionsList);
        const rect = trigger.getBoundingClientRect();
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        setRuntimeStyle(optionsList, "position", "absolute");
        setRuntimeStyle(optionsList, "minWidth", rect.width + "px");
        setRuntimeStyle(optionsList, "left", rect.left + scrollX + "px");
        const dropdownHeight = optionsList.offsetHeight || 200;
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
          wrapper.classList.add("drop-up");
          setRuntimeStyle(optionsList, "top", rect.top + scrollY - dropdownHeight - 4 + "px");
        } else {
          wrapper.classList.remove("drop-up");
        setRuntimeStyle(optionsList, "top", rect.bottom + scrollY + 4 + "px");
        }
      }
    });
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({ root: wrapper });
    }
  } else {
    const existingTrigger = wrapper.querySelector(".custom-select-trigger");
    if (!existingTrigger) {
      wrapper.remove();
      setRuntimeStyle(select, "display", "");
      return initCustomSelect(selectId);
    }
    if (isVersionSelect && !wrapper.classList.contains("version-select-container")) wrapper.classList.add("version-select-container");
    if (select.classList.contains("page-version-select") && !wrapper.classList.contains("page-version-select")) wrapper.classList.add("page-version-select");
    wrapper.classList.toggle("disabled", !!select.disabled);
    const optionsList = document.querySelector(`.custom-select-options[data-parent="${selectId}"]`) || wrapper.querySelector(".custom-select-options");
    if (optionsList) {
      renderCustomSelectOptions(optionsList, options, isVersionSelect);
      bindCustomSelectOptions(optionsList);
    }
    const activeSelectedOption = select.options[select.selectedIndex] || select.options[0] || { text: "", value: "" };
    let activeTriggerText = activeSelectedOption.text.trim();
    if (activeTriggerText.startsWith("Tháng ")) {
      let coreText = activeTriggerText.substring(6).trim();
      const monthMap = { "một": "1", "hai": "2", "ba": "3", "bốn": "4", "năm": "5", "sáu": "6", "bảy": "7", "tám": "8", "chín": "9", "mười": "10", "mười một": "11", "mười hai": "12" };
      if (monthMap[coreText.toLowerCase()]) coreText = monthMap[coreText.toLowerCase()];
      activeTriggerText = "Th" + coreText;
    }
    const triggerSpan = wrapper.querySelector(".custom-select-trigger span");
    if (triggerSpan && triggerSpan.textContent !== activeTriggerText) {
      triggerSpan.textContent = activeTriggerText;
    }
  }
  const activeOptionsList = document.querySelector(`.custom-select-options[data-parent="${selectId}"]`) || wrapper.querySelector(".custom-select-options");
  if (activeOptionsList) bindCustomSelectOptions(activeOptionsList);
}
export function syncCustomSelectDisabled(selectEl) {
  if (!selectEl || !selectEl.id) return;
  const wrapper = selectEl.closest(".custom-select-container") || selectEl.parentNode && selectEl.parentNode.querySelector(`.custom-select-container[data-target="${selectEl.id}"]`);
  if (!wrapper) return;
  wrapper.classList.toggle("disabled", !!selectEl.disabled);
  if (selectEl.disabled && wrapper.classList.contains("open")) {
    wrapper.classList.remove("open");
    const optionsList = document.body.querySelector(`.custom-select-options[data-parent="${selectEl.id}"]`) || wrapper.querySelector(".custom-select-options");
    if (optionsList) {
      setRuntimeStyle(optionsList, "display", "none");
      wrapper.appendChild(optionsList);
    }
  }
}
