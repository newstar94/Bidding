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
    element.addEventListener(eventName, handler, options);
    return element;
}

export function onAll(selector, eventName, handler, options) {
    const elements = Array.from(document.querySelectorAll(selector));
    elements.forEach(element => element.addEventListener(eventName, handler, options));
    return elements;
}

export function bindCurrencyInput(id, formatValue) {
    return bindCurrencyElement(document.getElementById(id), formatValue);
}

export function bindCurrencyElement(element, formatValue) {
    if (!element) return null;
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

export function bindCurrencyElements(elements, formatValue) {
    Array.from(elements || []).forEach(element => bindCurrencyElement(element, formatValue));
}

export function normalizeTaxCodeForLookup(value) {
    return String(value || '').trim().replace(/^(vnp|vnz|vn)[\s._-]*/i, '').trim();
}

export function normalizeTaxCodeForCompare(value) {
    return normalizeTaxCodeForLookup(value).replace(/[^0-9a-z]/gi, '').toLowerCase();
}
