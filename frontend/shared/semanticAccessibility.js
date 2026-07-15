function readableName(value) {
  return String(value || "")
    .replace(/^bf-|^(input|select|textarea|btn)-/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function nearestSectionName(element) {
  const section = element.closest("section, .tab-content, .modal-card, .card") || element.parentElement;
  const heading = section?.querySelector("h1, h2, h3, h4, h5, .modal-title, [data-table-title]");
  return heading?.textContent?.trim() || "Danh sách dữ liệu";
}

export function enhanceSemanticAccessibility(root = document) {
  root.querySelectorAll?.("table:not(:has(caption))").forEach((table) => {
    const caption = document.createElement("caption");
    caption.className = "visually-hidden";
    caption.textContent = nearestSectionName(table);
    table.prepend(caption);
  });
  root.querySelectorAll?.("thead th:not([scope])").forEach((header) => header.setAttribute("scope", "col"));
  root.querySelectorAll?.("input, select, textarea").forEach((control) => {
    if (control.type === "hidden" || control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby")) return;
    const escapedId = globalThis.CSS?.escape && control.id ? CSS.escape(control.id) : "";
    if (control.closest("label") || (escapedId && document.querySelector(`label[for="${escapedId}"]`))) return;
    const name = control.getAttribute("placeholder") || control.getAttribute("title") || readableName(control.name || control.id);
    if (name) control.setAttribute("aria-label", name);
  });
  root.querySelectorAll?.("button:not([aria-label])").forEach((button) => {
    if (button.textContent?.trim()) return;
    const name = button.getAttribute("title") || readableName(button.id);
    if (name) button.setAttribute("aria-label", name);
  });
}

export function installSemanticAccessibility(root = document) {
  enhanceSemanticAccessibility(root);
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) enhanceSemanticAccessibility(node);
    }));
  });
  observer.observe(root.body || root, { childList: true, subtree: true });
  return observer;
}
