const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ICON_SPRITE_URL = "/assets/landing-icons.svg?v=20260904";

export function createLandingSvgIcon(name) {
  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.classList.add("landing-icon");
  const use = document.createElementNS(SVG_NAMESPACE, "use");
  use.setAttribute("href", `${ICON_SPRITE_URL}#icon-${String(name || "info")}`);
  icon.append(use);
  return icon;
}

export function renderLandingIcons(root = document) {
  root?.querySelectorAll?.("i[data-lucide]").forEach((placeholder) => {
    const icon = createLandingSvgIcon(placeholder.dataset.lucide);
    icon.classList.add(...placeholder.classList);
    placeholder.replaceWith(icon);
  });
}
