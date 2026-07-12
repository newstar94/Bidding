export { getAuthDownloadUrl, authFetchDownload } from "../../controllers/utils/workflow_helpers.js";
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
export function safeImageSrc(value) {
  const src = String(value || "").trim();
  if (/^\/uploads\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/.test(src)) return src;
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return src;
  return "";
}
export function formatCurrency(value) {
  if (value === null || value === void 0 || value === "") return "--";
  const num = Number(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
}
export function formatDate(dateStr) {
  if (!dateStr) return "--";
  let year = null, month = null, day = null, hours = "00", minutes = "00";
  let hasTime = false;
  if (dateStr instanceof Date) {
    const d = dateStr;
    day = String(d.getDate()).padStart(2, "0");
    month = String(d.getMonth() + 1).padStart(2, "0");
    year = d.getFullYear();
    hours = String(d.getHours()).padStart(2, "0");
    minutes = String(d.getMinutes()).padStart(2, "0");
    hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  } else {
    const str = String(dateStr).trim();
    const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    let dmyMatch = null;
    if (!ymdMatch) {
      const resolvedDmy = str.replace(/\s*-\s*/, " ").trim();
      dmyMatch = resolvedDmy.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);
    }
    if (ymdMatch) {
      year = ymdMatch[1];
      month = ymdMatch[2];
      day = ymdMatch[3];
      if (ymdMatch[4] !== void 0) {
        hours = ymdMatch[4];
        minutes = ymdMatch[5];
        hasTime = true;
      }
    } else if (dmyMatch) {
      day = dmyMatch[1];
      month = dmyMatch[2];
      year = dmyMatch[3];
      if (dmyMatch[4] !== void 0) {
        hours = dmyMatch[4];
        minutes = dmyMatch[5];
        hasTime = true;
      }
    } else {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      day = String(d.getDate()).padStart(2, "0");
      month = String(d.getMonth() + 1).padStart(2, "0");
      year = d.getFullYear();
      hours = String(d.getHours()).padStart(2, "0");
      minutes = String(d.getMinutes()).padStart(2, "0");
      hasTime = /[T\s]\d{1,2}:\d{2}/.test(String(dateStr));
    }
  }
  if (hasTime) {
    return `${hours}:${minutes} ngày ${day}/${month}/${year}`;
  }
  return `${day}/${month}/${year}`;
}
export function formatDateOnly(dateStr) {
  if (!dateStr) return "--";
  const str = String(dateStr).trim();
  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) return `${ymdMatch[3]}/${ymdMatch[2]}/${ymdMatch[1]}`;
  const dmyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmyMatch) return `${dmyMatch[1]}/${dmyMatch[2]}/${dmyMatch[3]}`;
  const parsed = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return str;
  return `${String(parsed.getDate()).padStart(2, "0")}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${parsed.getFullYear()}`;
}
export function initCustomSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.setAttribute("style", "display: none !important;");
  if (!window._unifiedSelectClickListenerRegistered) {
    document.addEventListener("click", (e) => {
      document.querySelectorAll(".custom-select-container.open").forEach((w) => {
        const targetId = w.getAttribute("data-target");
        const absoluteDropdown = document.querySelector(`.custom-select-options[data-parent="${targetId}"]`) || w.querySelector(".custom-select-options");
        if (!w.contains(e.target) && !(absoluteDropdown && absoluteDropdown.contains(e.target))) {
          w.classList.remove("open");
          if (absoluteDropdown) {
            absoluteDropdown.style.display = "none";
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
          absoluteDropdown.style.display = "none";
          w.appendChild(absoluteDropdown);
        }
      });
    }, { capture: true, passive: true });
    window._unifiedSelectClickListenerRegistered = true;
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
  const safeSelectId = escapeHtml(selectId);
  const safeTriggerText = escapeHtml(triggerText);
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.className = "custom-select-container";
    if (select.closest("table")) wrapper.classList.add("table-select");
    if (isVersionSelect) wrapper.classList.add("version-select-container");
    if (select.classList.contains("page-version-select")) wrapper.classList.add("page-version-select");
    wrapper.setAttribute("data-target", selectId);
    wrapper.style.position = "relative";
    select.parentNode.insertBefore(wrapper, select.nextSibling);
    wrapper.innerHTML = `
            <div class="custom-select-trigger">
                <span>${safeTriggerText}</span>
                ${isVersionSelect ? "" : `
                <div class="custom-select-trigger-arrow">
                    <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                </div>
                `}
            </div>
            <ul class="custom-select-options" data-parent="${safeSelectId}" style="display: none; background-color: var(--bg-card); border: 1px solid var(--border-color); border-radius: ${isVersionSelect ? "4px" : "var(--radius-md)"}; box-shadow: var(--shadow-lg); z-index: 999999; list-style: none; padding: 6px 0; margin: 0; max-height: 220px; overflow-y: auto;">
                ${options.map((opt) => `
                    <li data-value="${escapeHtml(opt.value)}" class="custom-option-item ${opt.selected ? "selected" : ""}" style="padding: ${isVersionSelect ? "4px 14px" : "8px 14px"}; font-size: 0.85rem; cursor: pointer; white-space: nowrap; color: var(--text-main);">${escapeHtml(opt.text)}</li>
                `).join("")}
            </ul>
        `;
    if (select.disabled) {
      wrapper.classList.add("disabled");
    }
    const trigger = wrapper.querySelector(".custom-select-trigger");
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (select.disabled || wrapper.classList.contains("disabled")) return;
      const wasOpen = wrapper.classList.contains("open");
      const optionsList = document.querySelector(`.custom-select-options[data-parent="${selectId}"]`) || wrapper.querySelector(".custom-select-options");
      document.dispatchEvent(new Event("click"));
      if (!wasOpen && optionsList) {
        wrapper.classList.add("open");
        document.body.appendChild(optionsList);
        optionsList.style.display = "block";
        const rect = trigger.getBoundingClientRect();
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        optionsList.style.position = "absolute";
        optionsList.style.minWidth = rect.width + "px";
        optionsList.style.left = rect.left + scrollX + "px";
        const dropdownHeight = optionsList.offsetHeight || 200;
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
          wrapper.classList.add("drop-up");
          optionsList.style.top = rect.top + scrollY - dropdownHeight - 4 + "px";
        } else {
          wrapper.classList.remove("drop-up");
          optionsList.style.top = rect.bottom + scrollY + 4 + "px";
        }
      }
    });
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  } else {
    if (isVersionSelect && !wrapper.classList.contains("version-select-container")) wrapper.classList.add("version-select-container");
    if (select.classList.contains("page-version-select") && !wrapper.classList.contains("page-version-select")) wrapper.classList.add("page-version-select");
    wrapper.classList.toggle("disabled", !!select.disabled);
    const optionsList = document.querySelector(`.custom-select-options[data-parent="${selectId}"]`) || wrapper.querySelector(".custom-select-options");
    if (optionsList) {
      optionsList.innerHTML = options.map((opt) => `
                <li data-value="${escapeHtml(opt.value)}" class="custom-option-item ${opt.selected ? "selected" : ""}" style="padding: ${isVersionSelect ? "4px 14px" : "8px 14px"}; font-size: 0.85rem; cursor: pointer; white-space: nowrap; color: var(--text-main);">${escapeHtml(opt.text)}</li>
            `).join("");
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
    if (triggerSpan) triggerSpan.textContent = activeTriggerText;
  }
  const activeOptionsList = document.querySelector(`.custom-select-options[data-parent="${selectId}"]`) || wrapper.querySelector(".custom-select-options");
  if (activeOptionsList) {
    activeOptionsList.querySelectorAll(".custom-option-item").forEach((li) => {
      li.addEventListener("mouseover", () => {
        if (!li.classList.contains("selected")) {
          li.style.backgroundColor = "var(--neutral-soft)";
          li.style.color = "var(--primary)";
        }
      });
      li.addEventListener("mouseout", () => {
        if (!li.classList.contains("selected")) {
          li.style.backgroundColor = "";
          li.style.color = "var(--text-main)";
        }
      });
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        select.value = li.getAttribute("data-value");
        select.dispatchEvent(new Event("change", { bubbles: true }));
        wrapper.classList.remove("open");
        activeOptionsList.style.display = "none";
        wrapper.appendChild(activeOptionsList);
        initCustomSelect(selectId);
      });
    });
  }
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
      optionsList.style.display = "none";
      wrapper.appendChild(optionsList);
    }
  }
}
