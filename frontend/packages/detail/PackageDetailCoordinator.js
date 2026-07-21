import { trustedHTML } from "../../shared/trustedTypes.js";
import { setRuntimeStyle } from "../../shared/runtimeStyles.js";
import { escapeHtml } from "../../shared/view_helpers.js";

export function renderPackageTabHeaders(container, tabs, activeTab, onSelect) {
  if (!container) return;
  setRuntimeStyle(container, "display", "flex");
  container.innerHTML = trustedHTML((tabs || []).map((tab) => {
    const active = activeTab === tab.id;
    const style = active
      ? "background: var(--bg-card); color: var(--primary); border: 1px solid var(--border-color); border-bottom: 2px solid var(--primary); font-weight: 700;"
      : "background: transparent; color: var(--text-muted); border: 1px solid transparent; cursor: pointer;";
    return `<button type="button" class="btn ${active ? "active" : ""}" data-workflow-tab="${escapeHtml(tab.id)}" style="padding: 10px 18px; border-radius: var(--radius-md) var(--radius-md) 0 0; font-size: 0.82rem; transition: color 0.2s, background-color 0.2s, border-color 0.2s, box-shadow 0.2s; ${style}">${escapeHtml(tab.label)}</button>`;
  }).join(""));
  container.querySelectorAll("[data-workflow-tab]").forEach((button) => {
    button.addEventListener("click", () => onSelect?.(button.getAttribute("data-workflow-tab")));
  });
}
