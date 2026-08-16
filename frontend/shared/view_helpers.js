export {
  getAuthDownloadUrl,
  authFetchDownload,
  authFetchDownloadWithAlert,
} from "./workflow_helpers.js";
import { formatCurrency as formatVndCurrency, formatDate as formatDisplayDate, formatDateOnly as formatDisplayDateOnly } from "./formatters.js";
import { initAccessibleCombobox } from "./accessibleCombobox.js";
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

function compactMonthLabel(label) {
  if (!label.startsWith("Tháng ")) return label;
  let coreText = label.substring(6).trim();
  const monthMap = {
    "một": "1", "hai": "2", "ba": "3", "bốn": "4", "năm": "5", "sáu": "6",
    "bảy": "7", "tám": "8", "chín": "9", "mười": "10", "mười một": "11", "mười hai": "12",
  };
  coreText = monthMap[coreText.toLowerCase()] || coreText;
  return `Th${coreText}`;
}

export function initCustomSelect(selectId) {
  const inventory = globalThis.__BIDDINGFLOW_LEGACY_UI__ ||= { customSelect: {}, inferredButtons: {} };
  inventory.customSelect[selectId] = (inventory.customSelect[selectId] || 0) + 1;
  if (inventory.customSelect[selectId] === 1 && globalThis.location?.hostname === "localhost") {
    console.warn(`[BiddingFlow legacy UI] initCustomSelect(${selectId})`);
  }
  const select = document.getElementById(selectId);
  if (!select) return null;
  const activeWrapper = select.parentElement?.querySelector(
    `.bf-combobox[data-select-id="${selectId}"]`,
  );
  if (activeWrapper && !activeWrapper.classList.contains("custom-select-container")) {
    select.__bfAccessibleCombobox?.destroy();
  }
  if (!select.__bfAccessibleCombobox) {
    const staleWrapper = select.parentElement?.querySelector(
      `.custom-select-container[data-target="${selectId}"]:not(.bf-combobox)`,
    );
    staleWrapper?.remove();
    document.querySelectorAll(`body > .custom-select-options[data-parent="${selectId}"]`).forEach((stale) => stale.remove());
  }
  const isVersionSelect = select.classList.contains("page-version-select")
    || select.classList.contains("version-select")
    || select.classList.contains("phienban-select")
    || select.classList.contains("modal-version-select")
    || select.classList.contains("version-droplist");
  const isFullDateFilter = /^filter-(?:goithau|kehoach|hopdong)-(?:nam|thang)$/u.test(selectId);
  const emptyOptionLabel = Array.from(select.options)
    .find((option) => option.value === "")
    ?.text.trim();
  return initAccessibleCombobox(select, {
    compatibilityMode: "custom-select",
    displayEmptyOptionLabel: true,
    fitContent: select.dataset.dropdownFitContent === "true",
    formatSelectedLabel: isFullDateFilter ? null : compactMonthLabel,
    includeEmptyOption: true,
    placeholder: emptyOptionLabel || "Chọn dữ liệu",
    portal: select.dataset.dropdownInline !== "true",
    searchable: false,
    showToggle: !isVersionSelect,
  });
}

export function syncCustomSelectDisabled(selectEl) {
  if (!selectEl || !selectEl.id) return;
  selectEl.__bfAccessibleCombobox?.refresh();
}
