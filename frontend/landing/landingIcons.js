import { LANDING_ICON_NAMES, LANDING_ICON_VERSION } from "./landingIconManifest.js";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ICON_SPRITE_URL = `/assets/landing-icons.svg?v=${LANDING_ICON_VERSION}`;

export function createLandingSvgIcon(name) {
  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "24");
  icon.setAttribute("height", "24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.classList.add("landing-icon");
  const use = document.createElementNS(SVG_NAMESPACE, "use");
  const selected = LANDING_ICON_NAMES.includes(name) ? name : "info";
  use.setAttribute("href", `${ICON_SPRITE_URL}#icon-${selected}`);
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
