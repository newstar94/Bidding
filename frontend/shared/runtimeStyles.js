const rules = new Map();
const elementProperties = new WeakMap();
let nextRuleId = 0;

function getRuntimeSheet() {
  const link = document.querySelector('link[data-runtime-styles]');
  const sheet = link?.sheet;
  if (!sheet) throw new Error("Runtime stylesheet is not available");
  return sheet;
}

function normalizeProperty(property) {
  const value = String(property || "").trim();
  if (!/^(?:--[\w-]+|[A-Za-z][\w-]*)$/.test(value)) {
    throw new TypeError(`Invalid CSS property: ${value}`);
  }
  return value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

function classForDeclaration(property, value) {
  const declaration = property === "css-text"
    ? String(value || "").trim()
    : `${property}:${String(value || "").trim()}`;
  if (!declaration) return "";
  if (/[{}@]/.test(declaration) || /(?:expression|url)\s*\(/i.test(declaration)) {
    throw new TypeError("Unsafe runtime CSS declaration");
  }
  const cached = rules.get(declaration);
  if (cached) return cached;
  const className = `bf-runtime-style-${++nextRuleId}`;
  getRuntimeSheet().insertRule(`.${className}{${declaration}}`);
  rules.set(declaration, className);
  return className;
}

export function classForRuntimeDeclarations(value) {
  return classForDeclaration("css-text", value);
}

export function setRuntimeStyle(element, property, value) {
  if (!(element instanceof Element)) return value;
  const normalized = normalizeProperty(property);
  const key = normalized === "css-text" ? "css-text" : normalized;
  let applied = elementProperties.get(element);
  if (!applied) {
    applied = new Map();
    elementProperties.set(element, applied);
  }
  const previous = applied.get(key);
  if (previous) element.classList.remove(previous);
  const className = classForDeclaration(key, value);
  if (className) {
    element.classList.add(className);
    applied.set(key, className);
  } else {
    applied.delete(key);
  }
  return value;
}

export function getRuntimeStyle(element, property) {
  if (!(element instanceof Element)) return "";
  return getComputedStyle(element).getPropertyValue(normalizeProperty(property)).trim();
}
