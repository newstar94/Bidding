const BUTTON_ICON_RULES = [
  [/(^|\s)(xoa|delete|remove)(\s|$)/, "trash-2"],
  [/(^|\s)(huy thau|cancel package)(\s|$)/, "circle-x"],
  [/(^|\s)(luu|save|ghi nhan)(\s|$)/, "save"],
  [/(^|\s)(phat hanh|gui di|send)(\s|$)/, "send"],
  [/(^|\s)(tai|download|export|xuat)(\s|$)/, "download"],
  [/(^|\s)(nhap|upload|import)(\s|$)/, "upload"],
  [/(^|\s)(them|add|new|tao ban moi)(\s|$)/, "plus"],
  [/(^|\s)(bo qua|close|dong)(\s|$)/, "x"],
  [/(^|\s)(chinh sua|sua|edit)(\s|$)/, "pencil"],
  [/(^|\s)(xem|view|show)(\s|$)/, "eye"],
  [/(^|\s)(xac nhan|phe duyet|approve|confirm|dong y)(\s|$)/, "circle-check"],
  [/(^|\s)(tiep tuc|xu ly|continue)(\s|$)/, "arrow-right"],
  [/(^|\s)(thu lai|lam moi|retry|refresh)(\s|$)/, "refresh-cw"],
  [/(^|\s)(sao chep|copy)(\s|$)/, "copy"],
  [/(^|\s)(khoi phuc|restore)(\s|$)/, "rotate-ccw"],
  [/(^|\s)(mo khoa|unlock)(\s|$)/, "unlock"],
  [/(^|\s)(khoa|lock)(\s|$)/, "lock"],
  [/(^|\s)(gia han|renew)(\s|$)/, "calendar-plus"],
  [/(^|\s)(dang xuat|logout)(\s|$)/, "log-out"],
  [/(^|\s)(dang nhap|login)(\s|$)/, "log-in"],
  [/(^|\s)(quay lai|tro lai|back)(\s|$)/, "arrow-left"],
  [/(^|\s)(su dung|use)(\s|$)/, "check"],
];

function normalizeActionText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/giu, "d")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function inferButtonIcon({ id = "", text = "", title = "" } = {}) {
  const signature = normalizeActionText(`${id} ${text} ${title}`);
  if (!signature) return "";
  const normalizedText = normalizeActionText(text);
  if (/^(hoat dong|active)$/.test(normalizedText)) {
    return "circle-check";
  }
  if (
    /^(huy|cancel)(\s|$)/.test(normalizedText)
    && !/^(huy thau|cancel package)(\s|$)/.test(normalizedText)
  ) {
    return "";
  }
  return BUTTON_ICON_RULES.find(([pattern]) => pattern.test(signature))?.[1] || "";
}

export function inferButtonVariant(text = "") {
  const action = normalizeActionText(text);
  if (/^(xoa|huy thau|cancel package)(\s|$)/.test(action) || action.includes("xac nhan huy thau")) return "danger";
  if (/^(huy|cancel)(\s|$)/.test(action)) return "cancel";
  if (/^(bo qua|dong|quay lai|tro lai)$/.test(action)) return "secondary";
  return "";
}

function getButtons(root) {
  const selector = "button.btn, button.btn-excel-action, button.btn-add-row, button.btn-text";
  const descendants = root?.querySelectorAll?.(selector) || [];
  return root?.matches?.(selector) ? [root, ...descendants] : [...descendants];
}

function hasVisualIcon(button) {
  return Boolean(button.querySelector("svg, i, img, [data-lucide]"));
}

function renderLucideIcon(button) {
  if (window.lucide?.__bfLucideShim === true || typeof window.lucide?.createIcons !== "function") return;
  queueMicrotask(() => {
    if (button.isConnected) window.lucide.createIcons({ root: button });
  });
}

export function enhanceButtonSystem(root = document) {
  getButtons(root).forEach((button) => {
    const inventory = globalThis.__BIDDINGFLOW_LEGACY_UI__ ||= { customSelect: {}, inferredButtons: {} };
    const inventoryKey = button.id || button.getAttribute("data-action") || "anonymous";
    inventory.inferredButtons[inventoryKey] = (inventory.inferredButtons[inventoryKey] || 0) + 1;
    if (inventory.inferredButtons[inventoryKey] === 1 && globalThis.location?.hostname === "localhost") {
      console.warn(`[BiddingFlow legacy UI] inferred button action: ${inventoryKey}`);
    }
    const variant = inferButtonVariant(button.textContent);
    if (variant === "danger" && button.classList.contains("btn")) {
      button.classList.remove("btn-primary", "btn-emerald", "btn-purple", "btn-outline", "btn-secondary", "btn-outline-secondary");
      button.classList.add("btn-danger");
    } else if (variant === "cancel" && button.classList.contains("btn")) {
      button.classList.remove("btn-primary", "btn-emerald", "btn-purple", "btn-danger", "btn-warning", "btn-secondary", "btn-outline-secondary");
      button.classList.add("btn-outline", "btn-cancel");
    } else if (variant === "secondary" && button.classList.contains("btn")) {
      button.classList.remove("btn-primary", "btn-emerald", "btn-purple", "btn-danger", "btn-warning");
      button.classList.add("btn-outline");
    }
    if (variant === "cancel") {
      button.querySelectorAll("svg, i[data-lucide], [data-button-icon]").forEach((icon) => icon.remove());
      delete button.dataset.buttonIcon;
      return;
    }
    if (button.hasAttribute("data-no-icon") || button.classList.contains("btn-no-icon")) return;
    if (hasVisualIcon(button)) {
      renderLucideIcon(button);
      return;
    }
    const iconName = inferButtonIcon({
      id: button.id,
      text: button.textContent,
      title: button.getAttribute("title"),
    });
    if (!iconName) return;
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", iconName);
    icon.setAttribute("aria-hidden", "true");
    button.prepend(icon);
    button.dataset.buttonIcon = iconName;
    renderLucideIcon(button);
  });
}
