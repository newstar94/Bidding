export function debounce(fn, delay = 300) {
  let timer;
  let pendingArgs = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    pendingArgs = args;
    timer = setTimeout(() => {
      timer = null;
      const callArgs = pendingArgs;
      pendingArgs = null;
      fn(...callArgs);
    }, delay);
  };
  debounced.flush = () => {
    if (!timer || !pendingArgs) return;
    clearTimeout(timer);
    timer = null;
    const callArgs = pendingArgs;
    pendingArgs = null;
    fn(...callArgs);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };
  return debounced;
}
export function onById(id, eventName, handler, options) {
  const element = document.getElementById(id);
  if (!element) return null;
  const key = getEventBindingKey(eventName, handler, id);
  element.__bfBoundEvents = element.__bfBoundEvents || /* @__PURE__ */ new Set();
  if (element.__bfBoundEvents.has(key)) return element;
  element.__bfBoundEvents.add(key);
  element.addEventListener(eventName, handler, options);
  return element;
}
export function onAll(selector, eventName, handler, options) {
  const elements = Array.from(document.querySelectorAll(selector));
  const key = getEventBindingKey(eventName, handler, selector);
  elements.forEach((element) => {
    element.__bfBoundEvents = element.__bfBoundEvents || /* @__PURE__ */ new Set();
    if (element.__bfBoundEvents.has(key)) return;
    element.__bfBoundEvents.add(key);
    element.addEventListener(eventName, handler, options);
  });
  return elements;
}
function getEventBindingKey(eventName, handler, scope = "") {
  const handlerKey = handler?.name || String(handler).replace(/\s+/g, " ").slice(0, 160);
  return `event:${eventName}:${scope}:${handlerKey}`;
}
export function bindCurrencyInput(id, formatValue) {
  return bindCurrencyElement(document.getElementById(id), formatValue);
}
export function bindCurrencyElement(element, formatValue) {
  if (!element) return null;
  element.__bfBoundEvents = element.__bfBoundEvents || /* @__PURE__ */ new Set();
  if (element.__bfBoundEvents.has("currency-input")) return element;
  element.__bfBoundEvents.add("currency-input");
  element.addEventListener("input", (event) => {
    const input = event.target;
    const cursorPosition = input.selectionStart;
    const originalLength = input.value.length;
    const formatted = formatValue(input.value);
    input.value = formatted;
    const newPosition = cursorPosition + (formatted.length - originalLength);
    input.setSelectionRange(newPosition, newPosition);
  });
  return element;
}
export function normalizeTaxCodeForLookup(value) {
  return String(value || "").trim().replace(/^(vnp|vnz|vn)[\s._-]*/i, "").trim();
}
export function normalizeVietnamTaxCode(value) {
  return String(value || "").trim().replace(/[\s._]/g, "");
}
export function isVietnamTaxCode(value) {
  return /^(?:\d{9,14}|\d{10}-\d{3})$/.test(normalizeVietnamTaxCode(value));
}
export function normalizeProcurementOrgCode(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s._-]+/g, "");
  return /^(?:vnp|vnz|vn)\d{9,14}$/.test(normalized) ? normalized : "";
}
export function normalizeTaxCodeForCompare(value) {
  return normalizeTaxCodeForLookup(value).replace(/[^0-9a-z]/gi, "").toLowerCase();
}
export function normalizePersonName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN").replace(
    /(^|[\s'-])(\p{L})/gu,
    (_match, separator, letter) => separator + letter.toLocaleUpperCase("vi-VN")
  );
}
const ORGANIZATION_ACRONYMS = /* @__PURE__ */ new Set([
  "tnhh",
  "mtv",
  "ubnd",
  "hđnd",
  "cp",
  "jsc",
  "llc",
  "fpt",
  "vnpt",
  "viettel",
  "evn",
  "bidv",
  "vietcombank",
  "vietinbank",
  "agribank",
  "pccc"
]);
const ADMIN_NAME_MARKERS = /* @__PURE__ */ new Set([
  "xã",
  "phường",
  "huyện",
  "quận",
  "tỉnh",
  "thành phố",
  "thị xã",
  "thị trấn"
]);
function upperFirstVietnamese(value) {
  return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("vi-VN"));
}
export function normalizeOrganizationName(value) {
  const compact = String(value || "").trim().replace(/\s+/g, " ");
  if (!compact) return "";
  const letters = compact.match(/\p{L}/gu) || [];
  const isAllUpper = letters.length > 0 && letters.every(
    (letter) => letter === letter.toLocaleUpperCase("vi-VN")
  );
  const isAllLower = letters.length > 0 && letters.every(
    (letter) => letter === letter.toLocaleLowerCase("vi-VN")
  );
  if (!isAllUpper && !isAllLower) return compact;
  const words = compact.toLocaleLowerCase("vi-VN").split(" ");
  let capitalizeAdministrativeName = false;
  return words.map((word, index) => {
    const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (ORGANIZATION_ACRONYMS.has(bare)) {
      return word.replace(bare, bare.toLocaleUpperCase("vi-VN"));
    }
    const twoWordMarker = index > 0 ? `${words[index - 1]} ${bare}` : "";
    const isMarker = ADMIN_NAME_MARKERS.has(bare) || ADMIN_NAME_MARKERS.has(twoWordMarker);
    const shouldCapitalize = index === 0 || capitalizeAdministrativeName;
    const normalized = shouldCapitalize ? upperFirstVietnamese(word) : word;
    if (isMarker) capitalizeAdministrativeName = true;
    if (/[,:;()]$/.test(word) && !isMarker) capitalizeAdministrativeName = false;
    return normalized;
  }).join(" ");
}
