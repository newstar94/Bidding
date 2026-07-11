import {
    extractTaxCodeFromPartnerCode,
    isVietnamTaxCode,
    normalizeVietnamTaxCode
} from '../main_controller/domUtils.js';

const LOOKUP_DELAY_MS = 400;

export function bindPartnerTaxCodeLookup({
    codeInput,
    taxInput,
    applyLookupData,
    partnerRole = 'NT'
}) {
    if (!codeInput || !taxInput || typeof applyLookupData !== 'function') return null;

    codeInput.__bfPartnerTaxLookupCleanup?.();
    taxInput.__bfPartnerTaxLookupCleanup?.();

    let lookupTimer = null;
    let requestController = null;
    let activeLookupKey = '';
    let lastSuccessfulKey = '';
    let autoFilledTaxCode = '';

    const setLoading = (isLoading) => {
        taxInput.style.opacity = isLoading ? '0.7' : '1';
    };

    const cancelPendingLookup = () => {
        clearTimeout(lookupTimer);
        lookupTimer = null;
        requestController?.abort();
        requestController = null;
        activeLookupKey = '';
        setLoading(false);
    };

    const lookupTaxCode = async (value, orgCode = '') => {
        clearTimeout(lookupTimer);
        lookupTimer = null;

        const taxCode = normalizeVietnamTaxCode(value);
        if (!isVietnamTaxCode(taxCode)) return;

        const normalizedOrgCode = extractTaxCodeFromPartnerCode(orgCode)
            ? String(orgCode).trim()
            : '';
        const lookupKey = `${normalizedOrgCode.toLowerCase()}|${taxCode}`;

        taxInput.value = taxCode;
        if (lookupKey === activeLookupKey || lookupKey === lastSuccessfulKey) return;

        requestController?.abort();
        const currentController = new AbortController();
        requestController = currentController;
        activeLookupKey = lookupKey;
        setLoading(true);

        try {
            const query = new URLSearchParams({ code: taxCode, role: partnerRole });
            if (normalizedOrgCode) query.set('orgCode', normalizedOrgCode);
            const response = await fetch(`/api/lookup-tax-code?${query}`, {
                signal: currentController.signal
            });
            if (!response.ok || requestController !== currentController) return;

            const data = await response.json();
            if (!data?.name || requestController !== currentController) return;

            await applyLookupData(data);
            lastSuccessfulKey = lookupKey;
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Loi tra cuu ma so thue:', error);
            }
        } finally {
            if (requestController === currentController) {
                requestController = null;
                activeLookupKey = '';
                setLoading(false);
            }
        }
    };

    const scheduleLookup = (taxCode, orgCode) => {
        clearTimeout(lookupTimer);
        lookupTimer = setTimeout(() => lookupTaxCode(taxCode, orgCode), LOOKUP_DELAY_MS);
    };

    const syncTaxCodeFromPartnerCode = (lookupImmediately = false) => {
        const taxCode = extractTaxCodeFromPartnerCode(codeInput.value);
        if (!taxCode) {
            cancelPendingLookup();
            lastSuccessfulKey = '';
            if (autoFilledTaxCode && taxInput.value === autoFilledTaxCode) {
                taxInput.value = '';
            }
            autoFilledTaxCode = '';
            return;
        }

        const orgCode = codeInput.value.trim();
        const lookupKey = `${orgCode.toLowerCase()}|${taxCode}`;
        cancelPendingLookup();
        if (lookupKey !== lastSuccessfulKey) lastSuccessfulKey = '';
        taxInput.value = taxCode;
        autoFilledTaxCode = taxCode;
        if (lookupImmediately) {
            lookupTaxCode(taxCode, orgCode);
        } else {
            scheduleLookup(taxCode, orgCode);
        }
    };

    const handleCodeInput = () => syncTaxCodeFromPartnerCode(false);
    const handleCodeBlur = () => syncTaxCodeFromPartnerCode(true);
    const handleTaxInput = () => {
        cancelPendingLookup();
        lastSuccessfulKey = '';
        autoFilledTaxCode = '';
    };
    const handleTaxBlur = () => {
        const taxCode = normalizeVietnamTaxCode(taxInput.value);
        const orgCode = extractTaxCodeFromPartnerCode(codeInput.value) === taxCode
            ? codeInput.value.trim()
            : '';
        taxInput.value = taxCode;
        lookupTaxCode(taxCode, orgCode);
    };

    codeInput.addEventListener('input', handleCodeInput);
    codeInput.addEventListener('blur', handleCodeBlur);
    taxInput.addEventListener('input', handleTaxInput);
    taxInput.addEventListener('blur', handleTaxBlur);

    const cleanup = () => {
        cancelPendingLookup();
        codeInput.removeEventListener('input', handleCodeInput);
        codeInput.removeEventListener('blur', handleCodeBlur);
        taxInput.removeEventListener('input', handleTaxInput);
        taxInput.removeEventListener('blur', handleTaxBlur);
        if (codeInput.__bfPartnerTaxLookupCleanup === cleanup) {
            delete codeInput.__bfPartnerTaxLookupCleanup;
        }
        if (taxInput.__bfPartnerTaxLookupCleanup === cleanup) {
            delete taxInput.__bfPartnerTaxLookupCleanup;
        }
    };

    codeInput.__bfPartnerTaxLookupCleanup = cleanup;
    taxInput.__bfPartnerTaxLookupCleanup = cleanup;
    return cleanup;
}
