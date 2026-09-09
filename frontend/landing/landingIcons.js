import { LANDING_ICON_NAMES, LANDING_ICON_NODES } from "./landingIconManifest.js";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

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
  const selected = LANDING_ICON_NAMES.includes(name) ? name : "info";
  LANDING_ICON_NODES[selected].forEach(([tag, attributes]) => {
    const node = document.createElementNS(SVG_NAMESPACE, tag);
    Object.entries(attributes).forEach(([attribute, value]) => {
      node.setAttribute(attribute, String(value));
    });
    icon.append(node);
  });
  return icon;
}

export function renderLandingIcons(root = document) {
  root?.querySelectorAll?.("i[data-lucide]").forEach((placeholder) => {
    const icon = createLandingSvgIcon(placeholder.dataset.lucide);
    icon.classList.add(...placeholder.classList);
    placeholder.replaceWith(icon);
  });
}
