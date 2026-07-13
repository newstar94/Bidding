import { escapeHtml, htmlIcon } from "../subviews/view_helpers.js";

export function renderEntityActions(actions, { visible = true } = {}) {
  if (!visible) return "";
  const buttons = (actions || []).filter(Boolean).map((action) => {
    const className = escapeHtml(action.className || "");
    const command = escapeHtml(action.command || "");
    const id = escapeHtml(action.id || "");
    const title = escapeHtml(action.title || "");
    const style = action.style ? ` style="${escapeHtml(action.style)}"` : "";
    const extra = action.attributes
      ? Object.entries(action.attributes).map(([key, value]) => ` data-${escapeHtml(key)}="${escapeHtml(value)}"`).join("")
      : "";
    return `<button class="action-btn ${className}" data-bf-action="${command}" data-id="${id}" title="${title}"${style}${extra}>${htmlIcon(action.icon || "circle")}</button>`;
  }).join("");
  return `<div class="action-btn-group">${buttons}</div>`;
}

export function standardEditDeleteActions({ id, editCommand, deleteCommand }) {
  return [
    { id, command: editCommand, className: "btn-edit", title: "Sửa", icon: "edit-2" },
    { id, command: deleteCommand, className: "btn-delete", title: "Xóa", icon: "trash-2" }
  ];
}
