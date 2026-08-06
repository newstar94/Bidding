import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { normalizeTaxCodeForCompare } from "../app/domUtils.js";
import { parseVietnamAddress } from "../shared/PartnerHelpers.js";
import { getPartnerLookupInput, lookupPartnerInfo } from "../partners/partnerTaxLookup.js";
import { getExactContractorVersion } from "../partners/contractorVersionBinding.js";
import { resolveOpeningLookupNames } from "./bidProcessOpeningData.js";
import { postJson } from "../shared/apiClient.js";

const OPENING_SAVE_LOOKUP_TIMEOUT_MS = 3000;
export const VIOLATION_CONFIRMED = "VIOLATION_CONFIRMED";
export const VIOLATION_NOT_CHECKED = "NOT_CHECKED";
export const VIOLATION_LOOKUP_FAILED = "LOOKUP_FAILED";

export function isViolationConfirmed(status) {
  return status === VIOLATION_CONFIRMED;
}

export function applyViolationNameClass(element, status) {
  element?.classList?.toggle("bidder-name--violator", isViolationConfirmed(status));
}

export function updateOpeningViolationPresentation(row) {
  if (!row) return VIOLATION_NOT_CHECKED;
  const isJointVenture = String(row.querySelector?.(".mt-loai-nha-thau")?.value || "")
    .trim().toLocaleLowerCase("vi-VN") === "liên danh";
  const memberStatuses = [
    row._leadMemberViolationStatus,
    ...(row._thanhVienLienDanh || []).map((member) => member?.violationStatus)
  ];
  const aggregate = isJointVenture && memberStatuses.some(isViolationConfirmed)
    ? VIOLATION_CONFIRMED
    : isJointVenture && memberStatuses.some(Boolean)
      ? memberStatuses.find((status) => status && status !== "NO_ACTIVE_VIOLATION") || "NO_ACTIVE_VIOLATION"
      : row._violationStatus || VIOLATION_NOT_CHECKED;
  row._violationStatus = aggregate;
  applyViolationNameClass(row.querySelector?.(".mt-ten-nha-thau"), aggregate);
  return aggregate;
}

export async function resolveBidOpeningContractor({
  packageId,
  contractorIdentifier,
  lotId = null,
  bidOpeningRecordId = null,
  jointVentureMemberId = null,
  signal
}) {
  if (!packageId || !contractorIdentifier) return null;
  return postJson(
    `/api/packages/${encodeURIComponent(packageId)}/bid-opening/contractors/resolve`,
    {
      contractorIdentifier,
      lotId,
      bidOpeningRecordId,
      jointVentureId: null,
      jointVentureMemberId
    },
    { signal, timeoutMs: 20_000 }
  );
}

export async function refreshSavedOpeningViolationChecks(packageId, bids) {
  await Promise.all((bids || []).map(async (bid) => {
    if (String(bid?.loaiNhaThau || "").trim().toLocaleLowerCase("vi-VN") !== "liên danh") {
      try {
        const result = await resolveBidOpeningContractor({
          packageId,
          contractorIdentifier: bid.maDinhDanh || bid.maNhaThau || "",
          lotId: bid.phanLoId || null,
          bidOpeningRecordId: bid.id
        });
        bid.violationStatus = result?.violationStatus || VIOLATION_LOOKUP_FAILED;
        bid.violationBidClosingAt = result?.bidClosingAt || null;
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("Stored bid-opening violation lookup failed:", error);
        }
        bid.violationStatus = VIOLATION_LOOKUP_FAILED;
      }
      return;
    }
    await Promise.all((bid.thanhVienLienDanh || []).map(async (member) => {
      try {
        const result = await resolveBidOpeningContractor({
          packageId,
          contractorIdentifier: member.maNhaThau || member.maSoThue || "",
          lotId: bid.phanLoId || null,
          bidOpeningRecordId: bid.id,
          jointVentureMemberId: member.id
        });
        member.violationStatus = result?.violationStatus || VIOLATION_LOOKUP_FAILED;
        member.violationBidClosingAt = result?.bidClosingAt || null;
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("Stored joint-venture member violation lookup failed:", error);
        }
        member.violationStatus = VIOLATION_LOOKUP_FAILED;
      }
    }));
    bid.violationStatus = (bid.thanhVienLienDanh || []).some(
      (member) => isViolationConfirmed(member.violationStatus)
    ) ? VIOLATION_CONFIRMED : (
      (bid.thanhVienLienDanh || []).find(
        (member) => member.violationStatus && member.violationStatus !== "NO_ACTIVE_VIOLATION"
      )?.violationStatus || "NO_ACTIVE_VIOLATION"
    );
  }));
}

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

async function lookupPartnerInfoBeforeSave(lookupInput) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENING_SAVE_LOOKUP_TIMEOUT_MS);
  try {
    return await lookupPartnerInfo({ ...lookupInput, partnerRole: "NT", signal: controller.signal });
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error("Contractor lookup before saving bid opening failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
export function resolveOpeningLeadContractor(model, contractors, code, boundId = "") {
  const normalizedCode = normalizeContractorLookupCode(code);
  const bound = getExactContractorVersion(model, boundId);
  const boundCode = normalizeContractorLookupCode(bound?.maNhaThau || bound?.maSoThue);
  if (bound && normalizedCode && boundCode === normalizedCode) return bound;
  return findContractorByCode(contractors, code);
}
export async function mapPartnerLookupToContractor(code, info = {}, { normalizeAddress = true } = {}) {
  const rawAddress = info.address || info.diaChiGoc || "";
  const parsedAddress = normalizeAddress && rawAddress ? await parseVietnamAddress(rawAddress) : null;
  return {
    tenNhaThau: info.name || info.tenNhaThau || "",
    maNhaThau: info.org_code || info.maNhaThau || code,
    maSoThue: info.tax_code || info.maSoThue || "",
    tenVietTat: info.short_name || info.tenVietTat || "",
    nguoiDaiDien: info.representative_name || info.nguoiDaiDien || "",
    chucVuDaiDien: info.representative_position || info.chucVuDaiDien || "",
    soDienThoai: info.phone || info.soDienThoai || "",
    diaChi: parsedAddress?.formattedAddress || info.diaChi || rawAddress,
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
      row._leadMemberLookupData = await mapPartnerLookupToContractor(
        code,
        existing,
        { normalizeAddress: false },
      );
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
      if (codeInput) setRuntimeStyle(codeInput, "opacity", "0.7");
      const info = await lookupPartnerInfoBeforeSave(lookupInput);
      if (!info?.name) return;
      row._leadMemberLookupData = await mapPartnerLookupToContractor(
        code,
        info,
        { normalizeAddress: false },
      );
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
      if (codeInput) setRuntimeStyle(codeInput, "opacity", "1");
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
