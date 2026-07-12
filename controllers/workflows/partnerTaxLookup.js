import {
  isVietnamTaxCode,
  normalizeProcurementOrgCode,
  normalizeVietnamTaxCode
} from "../main_controller/domUtils.js";
const LOOKUP_DELAY_MS = 400;
export async function lookupPartnerInfo({ orgCode = "", taxCode = "", partnerRole = "NT", signal } = {}) {
  const normalizedOrgCode = normalizeProcurementOrgCode(orgCode);
  const normalizedTaxCode = normalizeVietnamTaxCode(taxCode);
  if (!normalizedOrgCode && !isVietnamTaxCode(normalizedTaxCode)) return null;
  const query = new URLSearchParams({ role: partnerRole });
  if (normalizedOrgCode) query.set("orgCode", normalizedOrgCode);
  if (isVietnamTaxCode(normalizedTaxCode)) query.set("code", normalizedTaxCode);
  const response = await fetch(`/api/lookup-tax-code?${query}`, { signal });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.name ? data : null;
}
export function getPartnerLookupInput(value) {
  const orgCode = normalizeProcurementOrgCode(value);
  if (orgCode) return { orgCode, taxCode: "" };
  const taxCode = normalizeVietnamTaxCode(value);
  return isVietnamTaxCode(taxCode) ? { orgCode: "", taxCode } : null;
}
export function bindPartnerTaxCodeLookup({
  codeInput,
  taxInput,
  applyLookupData,
  clearLookupData,
  partnerRole = "NT"
}) {
  if (!codeInput || !taxInput || typeof applyLookupData !== "function") return null;
  codeInput.__bfPartnerTaxLookupCleanup?.();
  taxInput.__bfPartnerTaxLookupCleanup?.();
  let lookupTimer = null;
  let requestController = null;
  let activeLookupKey = "";
  let lastSuccessfulKey = "";
  const setLoading = (isLoading) => {
    taxInput.style.opacity = isLoading ? "0.7" : "1";
  };
  const cancelPendingLookup = () => {
    clearTimeout(lookupTimer);
    lookupTimer = null;
    requestController?.abort();
    requestController = null;
    activeLookupKey = "";
    setLoading(false);
  };
  const runLookup = async ({ orgCode = "", taxCode = "" }) => {
    clearTimeout(lookupTimer);
    lookupTimer = null;
    const normalizedOrgCode = normalizeProcurementOrgCode(orgCode);
    const normalizedTaxCode = normalizeVietnamTaxCode(taxCode);
    if (!normalizedOrgCode && !isVietnamTaxCode(normalizedTaxCode)) return;
    const lookupKey = `${partnerRole}|${normalizedOrgCode}|${normalizedTaxCode}`;
    if (lookupKey === activeLookupKey || lookupKey === lastSuccessfulKey) return;
    requestController?.abort();
    const currentController = new AbortController();
    requestController = currentController;
    activeLookupKey = lookupKey;
    setLoading(true);
    try {
      const data = await lookupPartnerInfo({
        orgCode: normalizedOrgCode,
        taxCode: normalizedTaxCode,
        partnerRole,
        signal: currentController.signal
      });
      if (!data?.name || requestController !== currentController) return;
      taxInput.value = data.tax_code || (normalizedOrgCode ? "" : normalizedTaxCode);
      await applyLookupData(data);
      lastSuccessfulKey = lookupKey;
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Tax-code lookup failed:", error);
      }
    } finally {
      if (requestController === currentController) {
        requestController = null;
        activeLookupKey = "";
        setLoading(false);
      }
    }
  };
  const scheduleLookup = (lookupInput) => {
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(() => runLookup(lookupInput), LOOKUP_DELAY_MS);
  };
  const lookupFromPartnerCode = (lookupImmediately = false) => {
    const orgCode = normalizeProcurementOrgCode(codeInput.value);
    if (!orgCode) {
      cancelPendingLookup();
      lastSuccessfulKey = "";
      return;
    }
    const lookupKey = `${partnerRole}|${orgCode}|`;
    cancelPendingLookup();
    const partnerCodeChanged = lookupKey !== lastSuccessfulKey;
    if (partnerCodeChanged) {
      lastSuccessfulKey = "";
      taxInput.value = "";
    }
    if (lookupImmediately) {
      runLookup({ orgCode });
    } else {
      scheduleLookup({ orgCode });
    }
  };
  const handleCodeInput = () => {
    clearLookupData?.();
    lookupFromPartnerCode(false);
  };
  const handleCodeBlur = () => lookupFromPartnerCode(true);
  const handleTaxInput = () => {
    cancelPendingLookup();
    lastSuccessfulKey = "";
    clearLookupData?.();
  };
  const handleTaxBlur = () => {
    const taxCode = normalizeVietnamTaxCode(taxInput.value);
    const orgCode = normalizeProcurementOrgCode(codeInput.value);
    taxInput.value = taxCode;
    runLookup({ orgCode, taxCode });
  };
  codeInput.addEventListener("input", handleCodeInput);
  codeInput.addEventListener("blur", handleCodeBlur);
  taxInput.addEventListener("input", handleTaxInput);
  taxInput.addEventListener("blur", handleTaxBlur);
  const cleanup = () => {
    cancelPendingLookup();
    codeInput.removeEventListener("input", handleCodeInput);
    codeInput.removeEventListener("blur", handleCodeBlur);
    taxInput.removeEventListener("input", handleTaxInput);
    taxInput.removeEventListener("blur", handleTaxBlur);
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
