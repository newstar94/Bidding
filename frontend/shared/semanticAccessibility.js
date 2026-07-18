function readableName(value) {
  return String(value || "")
    .replace(/^bf-|^(input|select|textarea|btn)-/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

const ICON_BUTTON_NAMES = {
  edit: "Chỉnh sửa",
  eye: "Xem chi tiết",
  "eye-off": "Ẩn nội dung",
  plus: "Thêm mới",
  search: "Tìm kiếm",
  trash: "Xóa",
  "trash-2": "Xóa",
  x: "Đóng",
  "x-circle": "Đóng"
};

const CLASS_BUTTON_NAMES = [
  ["btn-edit", "Chỉnh sửa"],
  ["btn-delete", "Xóa"],
  ["btn-view", "Xem chi tiết"],
  ["modal-close", "Đóng hộp thoại"],
  ["toggle-password", "Hiện hoặc ẩn mật khẩu"]
];

export function inferIconButtonName(button) {
  const explicit = button?.getAttribute?.("title") || button?.getAttribute?.("data-tooltip");
  if (explicit?.trim()) return explicit.trim();
  for (const [className, name] of CLASS_BUTTON_NAMES) {
    if (button?.classList?.contains?.(className)) return name;
  }
  const iconName = button?.querySelector?.("[data-lucide]")?.getAttribute?.("data-lucide");
  return ICON_BUTTON_NAMES[iconName] || readableName(button?.id);
}

function nearestSectionName(element) {
  const section = element.closest("section, .tab-content, .modal-card, .card") || element.parentElement;
  const heading = section?.querySelector("h1, h2, h3, h4, h5, .modal-title, [data-table-title]");
  return heading?.textContent?.trim() || "Danh sách dữ liệu";
}

function matchingElements(root, selector) {
  const descendants = root?.querySelectorAll?.(selector) || [];
  return root?.matches?.(selector) ? [root, ...descendants] : [...descendants];
}

export function enhanceSemanticAccessibility(root = document) {
  matchingElements(root, "table:not(:has(caption))").forEach((table) => {
    const caption = document.createElement("caption");
    caption.className = "visually-hidden";
    caption.textContent = nearestSectionName(table);
    table.prepend(caption);
  });
  matchingElements(root, "thead th:not([scope])").forEach((header) => header.setAttribute("scope", "col"));
  matchingElements(root, "input, select, textarea").forEach((control) => {
    const error = control.closest?.(".form-group")?.querySelector?.(".error-text");
    if (error && control.id) {
      if (!error.id) error.id = `${control.id}-error`;
      const descriptions = new Set((control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      descriptions.add(error.id);
      control.setAttribute("aria-describedby", [...descriptions].join(" "));
    }
    if (control.type === "hidden" || control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby")) return;
    const escapedId = globalThis.CSS?.escape && control.id ? CSS.escape(control.id) : "";
    if (control.closest("label") || (escapedId && document.querySelector(`label[for="${escapedId}"]`))) return;
    const name = control.getAttribute("placeholder") || control.getAttribute("title") || readableName(control.name || control.id);
    if (name) control.setAttribute("aria-label", name);
  });
  matchingElements(root, "button:not([aria-label])").forEach((button) => {
    if (button.textContent?.trim()) return;
    const name = inferIconButtonName(button);
    if (name) button.setAttribute("aria-label", name);
  });
  matchingElements(root, "#profile-dropdown-menu button").forEach((button) => button.setAttribute("role", "menuitem"));
  matchingElements(root, ".error-text, .auth-error-msg").forEach((error) => {
    error.setAttribute("role", "alert");
    error.setAttribute("aria-live", "assertive");
    error.setAttribute("aria-atomic", "true");
  });
  matchingElements(root, ".auth-success-msg").forEach((status) => {
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
  });
}

export function installSemanticAccessibility(root = document) {
  enhanceSemanticAccessibility(root);
  root.addEventListener?.("invalid", (event) => {
    if (event.target?.matches?.("input, select, textarea")) event.target.setAttribute("aria-invalid", "true");
  }, true);
  root.addEventListener?.("input", (event) => {
    if (event.target?.matches?.("input, select, textarea") && event.target.validity?.valid) {
      event.target.setAttribute("aria-invalid", "false");
    }
  });
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) enhanceSemanticAccessibility(node);
    }));
  });
  observer.observe(root.body || root, { childList: true, subtree: true });
  return observer;
}
