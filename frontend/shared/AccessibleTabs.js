import { escapeHtml } from "./view_helpers.js";
import { trustedHTML } from "./trustedTypes.js";

function safeId(value) {
  return String(value || "tab").replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function resolveTabKeyboardTarget({ key, index, count, orientation = "horizontal" }) {
  if (!Number.isInteger(count) || count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const previousKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
  const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
  if (key === previousKey) return (index - 1 + count) % count;
  if (key === nextKey) return (index + 1) % count;
  return null;
}

export function tabButtonMarkup(tab, active, groupId) {
  const tabId = safeId(tab?.id);
  const group = safeId(groupId);
  return `<button type="button" role="tab" id="${group}-tab-${tabId}" aria-selected="${active ? "true" : "false"}" aria-controls="${group}-panel-${tabId}" tabindex="${active ? "0" : "-1"}" ${tab?.disabled ? 'aria-disabled="true" disabled' : ""} class="btn package-workflow-tab ${active ? "active" : ""}" data-workflow-tab="${escapeHtml(tab?.id || "")}"><i data-lucide="${escapeHtml(tab?.icon || "circle-dot")}" aria-hidden="true"></i><span>${escapeHtml(tab?.label || "")}</span></button>`;
}

export function renderAccessibleTabs(container, tabs, activeTab, onSelect, {
  groupId = "package-workflow",
  orientation = "horizontal",
  ariaLabel = "Các bước xử lý gói thầu",
} = {}) {
  if (!container) return () => {};
  container.__bfAccessibleTabsCleanup?.();
  container.setAttribute("role", "tablist");
  container.setAttribute("aria-orientation", orientation);
  container.setAttribute("aria-label", ariaLabel);
  container.innerHTML = trustedHTML((tabs || []).map((tab) => (
    tabButtonMarkup(tab, activeTab === tab.id, groupId)
  )).join(""));

  const buttons = () => [...container.querySelectorAll('[role="tab"]:not([disabled])')];
  const select = (button, { focus = false } = {}) => {
    if (!button) return;
    if (focus) button.focus();
    onSelect?.(button.getAttribute("data-workflow-tab"));
  };
  const onClick = (event) => select(event.target.closest?.('[role="tab"]'));
  const onKeyDown = (event) => {
    const button = event.target.closest?.('[role="tab"]');
    const available = buttons();
    const index = available.indexOf(button);
    if (index < 0) return;
    const targetIndex = resolveTabKeyboardTarget({
      key: event.key,
      index,
      count: available.length,
      orientation,
    });
    if (targetIndex === null) return;
    event.preventDefault();
    select(available[targetIndex], { focus: true });
  };
  container.addEventListener("click", onClick);
  container.addEventListener("keydown", onKeyDown);
  const cleanup = () => {
    container.removeEventListener("click", onClick);
    container.removeEventListener("keydown", onKeyDown);
    if (container.__bfAccessibleTabsCleanup === cleanup) {
      delete container.__bfAccessibleTabsCleanup;
    }
  };
  container.__bfAccessibleTabsCleanup = cleanup;
  return cleanup;
}
