import { trustedHTML } from "../../shared/trustedTypes.js";
import { setRuntimeStyle } from "../../shared/runtimeStyles.js";
import { escapeHtml } from "../../shared/view_helpers.js";

export function renderPackageTabHeaders(container, tabs, activeTab, onSelect) {
  if (!container) return;
  setRuntimeStyle(container, "display", "flex");
  container.innerHTML = trustedHTML((tabs || []).map((tab) => {
    const active = activeTab === tab.id;
    return `<button type="button" role="tab" aria-selected="${active ? "true" : "false"}" class="btn package-workflow-tab ${active ? "active" : ""}" data-workflow-tab="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`;
  }).join(""));
  container.querySelectorAll("[data-workflow-tab]").forEach((button) => {
    button.addEventListener("click", () => onSelect?.(button.getAttribute("data-workflow-tab")));
  });
}
