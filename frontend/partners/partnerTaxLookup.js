import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import {
  isVietnamTaxCode,
  normalizeProcurementOrgCode,
  normalizeVietnamTaxCode
} from "../app/domUtils.js";
import { getJson } from "../shared/apiClient.js";
const LOOKUP_DELAY_MS = 400;
export async function lookupPartnerInfo({
  orgCode = "",
  taxCode = "",
  partnerRole = "NT",
  signal,
  throwOnError = false,
} = {}) {
  const normalizedOrgCode = normalizeProcurementOrgCode(orgCode);
  const normalizedTaxCode = normalizeVietnamTaxCode(taxCode);
  if (!normalizedOrgCode && !isVietnamTaxCode(normalizedTaxCode)) return null;
  const query = new URLSearchParams({ role: partnerRole });
  if (normalizedOrgCode) query.set("orgCode", normalizedOrgCode);
  if (isVietnamTaxCode(normalizedTaxCode)) query.set("code", normalizedTaxCode);
  try {
    const data = await getJson(`/api/lookup-tax-code?${query}`, { signal });
    return data?.found !== false && data?.name ? data : null;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    if (throwOnError) throw error;
    return null;
  }
}
export function getPartnerLookupInput(value) {
  const orgCode = normalizeProcurementOrgCode(value);
  if (orgCode) return { orgCode, taxCode: "" };
  const taxCode = normalizeVietnamTaxCode(value);
  return isVietnamTaxCode(taxCode) ? { orgCode: "", taxCode } : null;
}
export function findStoredPartnerLookupData(records, { orgCode = "", taxCode = "", partnerRole = "NT" } = {}) {
  const normalizedOrgCode = normalizeProcurementOrgCode(orgCode);
  const normalizedTaxCode = normalizeVietnamTaxCode(taxCode);
  const isContractor = partnerRole === "NT";
  const record = (records || []).find((item) => {
    const recordOrgCode = normalizeProcurementOrgCode(isContractor ? item.maNhaThau : item.maChuDauTu);
    const recordTaxCode = normalizeVietnamTaxCode(item.maSoThue);
    return normalizedOrgCode && recordOrgCode === normalizedOrgCode
      || isVietnamTaxCode(normalizedTaxCode) && recordTaxCode === normalizedTaxCode;
  });
  if (!record) return null;
  const internalAddress = String(record.diaChi || "").replace(/\s*\|\s*/gu, ", ");
  return {
    source: "DB",
    org_code: isContractor ? record.maNhaThau || "" : record.maChuDauTu || "",
    tax_code: record.maSoThue || "",
    name: isContractor ? record.tenNhaThau || "" : record.tenChuDauTu || "",
    short_name: record.tenVietTat || "",
    representative_name: isContractor ? record.nguoiDaiDien || "" : record.daiDienCdt || "",
    representative_position: record.chucVuDaiDien || "",
    phone: record.soDienThoai || "",
    email: record.email || "",
    address: record.diaChiGoc || internalAddress,
    bank_account: record.soTaiKhoan || "",
    bank_name: record.noiMoTaiKhoan || "",
    bank_code: record.maNganHang || "",
    head_position: record.chucVuNguoiDungDau || "",
    budget_code: record.maQHNS || "",
    parent_agency: record.coQuanChuQuan || ""
  };
}
export function bindPartnerTaxCodeLookup({
  codeInput,
  taxInput,
  applyLookupData,
  clearLookupData,
  resolveLocalData,
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
    setRuntimeStyle(taxInput, "opacity", isLoading ? "0.7" : "1");
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
      const localData = typeof resolveLocalData === "function"
        ? await resolveLocalData({ orgCode: normalizedOrgCode, taxCode: normalizedTaxCode, partnerRole })
        : null;
      if (localData?.name && requestController === currentController) {
        taxInput.value = localData.tax_code || (normalizedOrgCode ? "" : normalizedTaxCode);
        await applyLookupData(localData);
        lastSuccessfulKey = lookupKey;
        return;
      }
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
