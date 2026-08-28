const PENDING_ICON_SELECTOR = "[data-lucide]:not(svg)";
const RENDERED_ICON_SELECTOR = "svg[data-lucide]";
const RENDERED_ICON_ATTRIBUTE = "data-bf-lucide-rendered";

function defaultIconLibrary() {
  return globalThis.window?.lucide || globalThis.lucide;
}

function isUnboundedRoot(root) {
  const documentRef = globalThis.document;
  return !root
    || root.nodeType === 9
    || root === documentRef
    || root === documentRef?.body
    || root === documentRef?.documentElement;
}

function readDataValue(element, attribute, datasetKey) {
  if (typeof element?.getAttribute === "function") {
    const value = element.getAttribute(attribute);
    if (value !== null) return value;
  }
  return element?.dataset?.[datasetKey] ?? null;
}

function iconName(element) {
  return readDataValue(element, "data-lucide", "lucide");
}

function renderedIconName(element) {
  return readDataValue(element, RENDERED_ICON_ATTRIBUTE, "bfLucideRendered");
}

function setRenderedIconName(element, name) {
  if (!name) return;
  if (typeof element?.setAttribute === "function") {
    element.setAttribute(RENDERED_ICON_ATTRIBUTE, name);
  } else if (element?.dataset) {
    element.dataset.bfLucideRendered = name;
  }
}

function descendantRenderedIcons(root) {
  if (typeof root?.querySelectorAll !== "function") return [];
  return Array.from(root.querySelectorAll(RENDERED_ICON_SELECTOR));
}

function hasExpectedLucideClass(element, name) {
  const expectedClass = `lucide-${name}`;
  if (typeof element?.classList?.contains === "function") {
    return element.classList.contains(expectedClass);
  }
  const className = typeof element?.getAttribute === "function"
    ? element.getAttribute("class")
    : element?.className;
  return typeof className === "string"
    && className.split(/\s+/u).includes(expectedClass);
}

function hasPendingIcons(root) {
  if (root.querySelector?.(PENDING_ICON_SELECTOR)) return true;
  return descendantRenderedIcons(root).some((element) => {
    const name = iconName(element);
    if (!name) return false;
    const renderedName = renderedIconName(element);
    if (renderedName === name) return false;
    // SVGs created by an earlier release do not have our marker yet. If
    // Lucide's own class is already present, adopt that SVG without a
    // redundant render; a changed marker remains stale and is re-rendered.
    if (renderedName === null && hasExpectedLucideClass(element, name)) {
      setRenderedIconName(element, name);
      return false;
    }
    return true;
  });
}

function markRenderedIcons(root, previousIcons) {
  descendantRenderedIcons(root).forEach((element) => {
    const name = iconName(element);
    if (!name) return;
    if (!previousIcons.has(element) || hasExpectedLucideClass(element, name)) {
      setRenderedIconName(element, name);
    }
  });
}

/**
 * Render only the icon placeholders inside a caller-owned DOM region.
 *
 * Lucide defaults to `document` when no root is supplied. That turns a small
 * icon refresh into a scan of browser-extension DOM as well as application
 * DOM, so this boundary deliberately rejects document-sized roots and never
 * retries without the requested root.
 */
export function renderLucideIcons(root, iconLibrary = defaultIconLibrary()) {
  if (isUnboundedRoot(root)) return false;
  if (iconLibrary?.__bfLucideShim === true || typeof iconLibrary?.createIcons !== "function") return false;
  if (!hasPendingIcons(root)) return false;
  const previousIcons = new Set(descendantRenderedIcons(root));
  try {
    iconLibrary.createIcons({ root });
    markRenderedIcons(root, previousIcons);
    return true;
  } catch (error) {
    console.warn("Lucide icons could not be rendered in the requested region:", error);
    return false;
  }
}
