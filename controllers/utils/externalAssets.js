const SCRIPT_LOADERS = new Map();
const STYLE_LOADERS = new Map();

export function loadScriptOnce(src, globalName) {
    if (globalName && window[globalName]) {
        return Promise.resolve(window[globalName]);
    }

    if (SCRIPT_LOADERS.has(src)) {
        return SCRIPT_LOADERS.get(src);
    }

    const promise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Không thể tải thư viện: ${src}`)), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve(globalName ? window[globalName] : true);
        script.onerror = () => reject(new Error(`Không thể tải thư viện: ${src}`));
        document.head.appendChild(script);
    });

    SCRIPT_LOADERS.set(src, promise);
    return promise;
}

export function ensureXlsxLoaded() {
    return loadScriptOnce('/vendor/xlsx/xlsx.full.min.js?v=0.18.5', 'XLSX');
}

export function loadStyleOnce(href) {
    if (document.querySelector(`link[href="${href}"]`)) {
        return Promise.resolve(true);
    }

    if (STYLE_LOADERS.has(href)) {
        return STYLE_LOADERS.get(href);
    }

    const promise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => resolve(true);
        link.onerror = () => reject(new Error(`Khong the tai stylesheet: ${href}`));
        document.head.appendChild(link);
    });

    STYLE_LOADERS.set(href, promise);
    return promise;
}

export async function ensureFlatpickrLoaded() {
    await loadStyleOnce('/vendor/flatpickr/flatpickr.min.css?v=4');
    await loadScriptOnce('/vendor/flatpickr/flatpickr.min.js?v=4', 'flatpickr');
    await loadScriptOnce('/vendor/flatpickr/l10n/vn.js?v=4');
    return window.flatpickr;
}
