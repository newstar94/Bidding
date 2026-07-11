export function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

export function onById(id, eventName, handler, options) {
    const element = document.getElementById(id);
    if (!element) return null;
    const key = getEventBindingKey(eventName, handler, id);
    element.__bfBoundEvents = element.__bfBoundEvents || new Set();
    if (element.__bfBoundEvents.has(key)) return element;
    element.__bfBoundEvents.add(key);
    element.addEventListener(eventName, handler, options);
    return element;
}

export function onAll(selector, eventName, handler, options) {
    const elements = Array.from(document.querySelectorAll(selector));
    const key = getEventBindingKey(eventName, handler, selector);
    elements.forEach(element => {
        element.__bfBoundEvents = element.__bfBoundEvents || new Set();
        if (element.__bfBoundEvents.has(key)) return;
        element.__bfBoundEvents.add(key);
        element.addEventListener(eventName, handler, options);
    });
    return elements;
}

function getEventBindingKey(eventName, handler, scope = '') {
    const handlerKey = handler?.name || String(handler).replace(/\s+/g, ' ').slice(0, 160);
    return `event:${eventName}:${scope}:${handlerKey}`;
}

export function bindCurrencyInput(id, formatValue) {
    return bindCurrencyElement(document.getElementById(id), formatValue);
}

export function bindCurrencyElement(element, formatValue) {
    if (!element) return null;
    element.__bfBoundEvents = element.__bfBoundEvents || new Set();
    if (element.__bfBoundEvents.has('currency-input')) return element;
    element.__bfBoundEvents.add('currency-input');
    element.addEventListener('input', (event) => {
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
    return String(value || '').trim().replace(/^(vnp|vnz|vn)[\s._-]*/i, '').trim();
}

export function normalizeVietnamTaxCode(value) {
    return String(value || '').trim().replace(/[\s._]/g, '');
}

export function isVietnamTaxCode(value) {
    return /^(?:\d{9,14}|\d{10}-\d{3})$/.test(normalizeVietnamTaxCode(value));
}

export function normalizeProcurementOrgCode(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s._-]+/g, '');
    return /^(?:vnp|vnz|vn)\d{9,14}$/.test(normalized) ? normalized : '';
}

export function normalizeTaxCodeForCompare(value) {
    return normalizeTaxCodeForLookup(value).replace(/[^0-9a-z]/gi, '').toLowerCase();
}

export function normalizePersonName(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('vi-VN')
        .replace(/(^|[\s'-])(\p{L})/gu, (_match, separator, letter) =>
            separator + letter.toLocaleUpperCase('vi-VN')
        );
}
