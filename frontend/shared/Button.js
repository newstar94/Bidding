import { escapeHtml } from "./view_helpers.js";

const VARIANTS = new Set([
  "primary", "secondary", "outline", "danger", "warning", "success", "text",
]);

function normalizeButtonSpec(spec = {}) {
  const variant = VARIANTS.has(spec.variant) ? spec.variant : "primary";
  const label = String(spec.label || "").trim();
  const ariaLabel = String(spec.ariaLabel || label).trim();
  if (!ariaLabel) throw new TypeError("An icon-only button requires an accessible name");
  return {
    variant,
    icon: String(spec.icon || "").trim(),
    label,
    loading: Boolean(spec.loading),
    disabled: Boolean(spec.disabled),
    ariaLabel,
    type: ["button", "submit", "reset"].includes(spec.type) ? spec.type : "button",
    id: String(spec.id || "").trim(),
    className: String(spec.className || "").trim(),
    attributes: spec.attributes || {},
    onAction: spec.onAction,
  };
}

export function buttonMarkup(spec) {
  const value = normalizeButtonSpec(spec);
  const attributes = Object.entries(value.attributes)
    .filter(([, item]) => item !== null && item !== undefined && item !== false)
    .map(([key, item]) => ` ${escapeHtml(key)}="${escapeHtml(item === true ? "" : String(item))}"`)
    .join("");
  const icon = value.icon
    ? `<i data-lucide="${escapeHtml(value.icon)}" aria-hidden="true"></i>`
    : "";
  return `<button${value.id ? ` id="${escapeHtml(value.id)}"` : ""} type="${value.type}" class="btn btn-${value.variant}${value.className ? ` ${escapeHtml(value.className)}` : ""}" aria-label="${escapeHtml(value.ariaLabel)}" aria-busy="${value.loading ? "true" : "false"}"${value.disabled || value.loading ? " disabled" : ""}${attributes}>${icon}${value.label ? `<span>${escapeHtml(value.label)}</span>` : ""}</button>`;
}

export function Button(spec, documentAdapter = globalThis.document) {
  const value = normalizeButtonSpec(spec);
  const button = documentAdapter.createElement("button");
  button.type = value.type;
  button.className = `btn btn-${value.variant}${value.className ? ` ${value.className}` : ""}`;
  button.disabled = value.disabled || value.loading;
  button.setAttribute("aria-label", value.ariaLabel);
  button.setAttribute("aria-busy", String(value.loading));
  if (value.id) button.id = value.id;
  Object.entries(value.attributes).forEach(([name, item]) => {
    if (item !== null && item !== undefined && item !== false) {
      button.setAttribute(name, item === true ? "" : String(item));
    }
  });
  if (value.icon) {
    const icon = documentAdapter.createElement("i");
    icon.dataset.lucide = value.icon;
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
  }
  if (value.label) {
    const label = documentAdapter.createElement("span");
    label.textContent = value.label;
    button.appendChild(label);
  }
  let acting = false;
  button.addEventListener("click", async (event) => {
    if (acting || button.disabled || typeof value.onAction !== "function") return;
    acting = true;
    button.disabled = true;
    try {
      await value.onAction(event);
    } finally {
      acting = false;
      button.disabled = value.disabled || value.loading;
    }
  });
  return button;
}
