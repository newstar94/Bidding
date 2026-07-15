import { normalizeTaxCodeForCompare } from "../app/domUtils.js";
import { parseVietnamAddress } from "../shared/PartnerHelpers.js";
import { getPartnerLookupInput, lookupPartnerInfo } from "../partners/partnerTaxLookup.js";
import { getExactContractorVersion } from "../partners/contractorVersionBinding.js";
import { resolveOpeningLookupNames } from "./bidProcessOpeningData.js";

function normalizeContractorLookupCode(value) {
  return normalizeTaxCodeForCompare(value);
}
function findContractorByCode(list, code) {
  const normalizedCode = normalizeContractorLookupCode(code);
  if (!normalizedCode) return null;
  return (list || []).find(
    (n) => normalizeContractorLookupCode(n.maNhaThau) === normalizedCode || normalizeContractorLookupCode(n.maSoThue) === normalizedCode
  ) || null;
}
export function resolveOpeningLeadContractor(model, contractors, code, boundId = "") {
  const normalizedCode = normalizeContractorLookupCode(code);
  const bound = getExactContractorVersion(model, boundId);
  const boundCode = normalizeContractorLookupCode(bound?.maNhaThau || bound?.maSoThue);
  if (bound && normalizedCode && boundCode === normalizedCode) return bound;
  return findContractorByCode(contractors, code);
}
export async function mapPartnerLookupToContractor(code, info = {}) {
  const rawAddress = info.address || info.diaChiGoc || "";
  const parsedAddress = rawAddress ? await parseVietnamAddress(rawAddress) : null;
  return {
    tenNhaThau: info.name || info.tenNhaThau || "",
    maNhaThau: info.org_code || info.maNhaThau || code,
    maSoThue: info.tax_code || info.maSoThue || "",
    tenVietTat: info.short_name || info.tenVietTat || "",
    nguoiDaiDien: info.representative_name || info.nguoiDaiDien || "",
    chucVuDaiDien: info.representative_position || info.chucVuDaiDien || "",
    soDienThoai: info.phone || info.soDienThoai || "",
    diaChi: parsedAddress?.formattedAddress || info.diaChi || "",
    diaChiGoc: rawAddress
  };
}
async function enrichOpeningRowsWithPartnerInfo(rows, model) {
  const latestContractors = model.getLatestNhaThau();
  await Promise.all(Array.from(rows || []).map(async (row) => {
    const codeInput = row.querySelector(".mt-ma-nha-thau");
    const nameInput = row.querySelector(".mt-ten-nha-thau");
    const code = codeInput?.value.trim() || "";
    if (!code) return;
    const existing = findContractorByCode(latestContractors, code);
    if (existing) {
      row._leadMemberLookupData = await mapPartnerLookupToContractor(code, existing);
      const names = resolveOpeningLookupNames(
        row.querySelector(".mt-loai-nha-thau")?.value,
        nameInput?.value,
        existing.tenNhaThau,
        row._leadMemberName
      );
      if (nameInput) nameInput.value = names.bidName;
      row._leadMemberName = names.leadMemberName;
      return;
    }
    const lookupInput = getPartnerLookupInput(code);
    if (!lookupInput) return;
    try {
      if (codeInput) codeInput.style.opacity = "0.7";
      const info = await lookupPartnerInfo({ ...lookupInput, partnerRole: "NT" });
      if (!info?.name) return;
      row._leadMemberLookupData = await mapPartnerLookupToContractor(code, info);
      if (codeInput && info.org_code) codeInput.value = info.org_code;
      const names = resolveOpeningLookupNames(
        row.querySelector(".mt-loai-nha-thau")?.value,
        nameInput?.value,
        info.name,
        row._leadMemberName
      );
      if (nameInput) nameInput.value = names.bidName;
      row._leadMemberName = names.leadMemberName;
    } catch (error) {
      console.error("Contractor lookup before saving bid opening failed:", error);
    } finally {
      if (codeInput) codeInput.style.opacity = "1";
    }
  }));
}
function resolveLeadMemberName(contractor, leadCode) {
  if (!contractor) return "";
  const normalizedLeadCode = normalizeContractorLookupCode(leadCode);
  const leadMember = (contractor.thanhVienLienDanh || []).find((member) => {
    const role = String(member.vaiTro || "").toLowerCase();
    return role.includes("đứng") && role.includes("đầu") || normalizedLeadCode && normalizeContractorLookupCode(member.maNhaThau || member.maSoThue) === normalizedLeadCode;
  });
  if (leadMember?.tenNhaThau) return leadMember.tenNhaThau;
  if (String(contractor.loaiNhaThau || "").trim().toLowerCase() === "liên danh") return "";
  return contractor.tenNhaThau || "";
}
function getJointVentureSubMembers(members, leadCode) {
  const seenCodes = new Set([normalizeContractorLookupCode(leadCode)].filter(Boolean));
  return (members || []).filter((member) => {
    const normalizedCode = normalizeContractorLookupCode(member?.maNhaThau || member?.maSoThue);
    if (!normalizedCode || seenCodes.has(normalizedCode)) return false;
    const role = String(member?.vaiTro || "").trim().toLowerCase();
    if (role.includes("đứng") && role.includes("đầu")) return false;
    seenCodes.add(normalizedCode);
    return true;
  });
}
function findDuplicateJvMemberCodes({ leadCode, leadInput, rows }) {
  const seen = /* @__PURE__ */ new Map();
  const duplicateInputs = [];
  const remember = (code, input) => {
    const normalized = normalizeContractorLookupCode(code);
    if (!normalized) return;
    if (seen.has(normalized)) {
      if (input) duplicateInputs.push(input);
      return;
    }
    seen.set(normalized, input || null);
  };
  remember(leadCode, leadInput);
  rows.forEach((row) => {
    remember(row.querySelector(".jv-input-mst")?.value, row.querySelector(".jv-input-mst"));
  });
  return duplicateInputs;
}

export {
  enrichOpeningRowsWithPartnerInfo,
  findContractorByCode,
  findDuplicateJvMemberCodes,
  getJointVentureSubMembers,
  normalizeContractorLookupCode,
  resolveLeadMemberName
};

