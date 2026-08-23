import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { normalizeTaxCodeForCompare } from "../app/domUtils.js";
import { parseVietnamAddress } from "../shared/PartnerHelpers.js";
import { getPartnerLookupInput, lookupPartnerInfo } from "../partners/partnerTaxLookup.js";
import { getExactContractorVersion } from "../partners/contractorVersionBinding.js";
import { resolveOpeningLookupNames } from "./bidProcessOpeningData.js";
import { postJson } from "../shared/apiClient.js";

const OPENING_SAVE_LOOKUP_TIMEOUT_MS = 3000;
const OPENING_LOOKUP_CONCURRENCY = 3;
const OPENING_VIOLATION_CONCURRENCY = 3;
export const VIOLATION_CONFIRMED = "VIOLATION_CONFIRMED";
export const VIOLATION_NOT_CHECKED = "NOT_CHECKED";
export const VIOLATION_LOOKUP_FAILED = "LOOKUP_FAILED";

export function isViolationConfirmed(status) {
  return status === VIOLATION_CONFIRMED;
}

export function applyViolationNameClass(element, status) {
  const violationConfirmed = isViolationConfirmed(status);
  element?.classList?.toggle("bidder-name--violator", violationConfirmed);
  if (String(element?.tagName || "").toUpperCase() === "A") {
    element.classList.toggle("text-blue", !violationConfirmed);
  }
}

// A saved row is re-checked when its stored state carries no verdict.
// NOT_CHECKED is what the server writes when it invalidates a stale check (for
// example after the bid-closing time moves), and LOOKUP_FAILED means the
// previous attempt never reached the violation provider. Both must be retried,
// otherwise a real violator stays unmarked until someone edits the row.
// REVIEW_REQUIRED and IDENTITY_CONFLICT are deliberate verdicts that need a
// human decision, so they are not silently re-resolved.
const RETRYABLE_VIOLATION_STATUSES = new Set([
  VIOLATION_NOT_CHECKED,
  VIOLATION_LOOKUP_FAILED,
]);

export function shouldRefreshSavedOpeningViolationCheck(bidData, contractorCode = "") {
  return Boolean(
    bidData?.id
    && (!bidData?.violationStatus || RETRYABLE_VIOLATION_STATUSES.has(bidData.violationStatus))
    && (bidData?.maDinhDanh || contractorCode)
  );
}

export function updateOpeningViolationPresentation(row) {
  if (!row) return VIOLATION_NOT_CHECKED;
  const isJointVenture = String(row.querySelector?.(".mt-loai-nha-thau")?.value || "")
    .trim().toLocaleLowerCase("vi-VN") === "liên danh";
  const memberStatuses = [
    row._leadMemberViolationStatus,
    ...(row._thanhVienLienDanh || []).map((member) => member?.violationStatus)
  ];
  // A confirmed violation is never downgraded by a less specific status. The
  // per-member rows and the stored aggregate are both written by the server,
  // but they are loaded independently: joint-venture members rehydrated from
  // contractor master data carry NOT_CHECKED even when the saved bid is known
  // to be a violator. Ignoring the stored aggregate there hides the violation.
  const confirmedAnywhere = isViolationConfirmed(row._violationStatus)
    || (isJointVenture && memberStatuses.some(isViolationConfirmed));
  const aggregate = confirmedAnywhere
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

async function runWithConcurrency(items, concurrency, worker) {
  const queue = Array.from(items || []);
  if (queue.length === 0) return;
  let nextIndex = 0;
  const workerCount = Math.min(queue.length, Math.max(1, Number(concurrency) || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < queue.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(queue[index], index);
    }
  }));
}

export async function refreshSavedOpeningViolationChecks(packageId, bids) {
  const tasks = [];
  const jointVentureBids = [];
  for (const bid of bids || []) {
    const isJointVenture = String(bid?.loaiNhaThau || "").trim().toLocaleLowerCase("vi-VN") === "liên danh";
    // A joint-venture bid whose member rows are not loaded locally still has to
    // be checked. Resolving it per member only would silently report
    // NO_ACTIVE_VIOLATION for an empty member list.
    if (!isJointVenture || (bid.thanhVienLienDanh || []).length === 0) {
      tasks.push(async () => {
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
      });
      continue;
    }
    jointVentureBids.push(bid);
    for (const member of bid.thanhVienLienDanh || []) {
      tasks.push(async () => {
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
      });
    }
  }
  await runWithConcurrency(tasks, OPENING_VIOLATION_CONCURRENCY, (task) => task());
  for (const bid of jointVentureBids) {
    bid.violationStatus = (bid.thanhVienLienDanh || []).some(
      (member) => isViolationConfirmed(member.violationStatus)
    ) ? VIOLATION_CONFIRMED : (
      (bid.thanhVienLienDanh || []).find(
        (member) => member.violationStatus && member.violationStatus !== "NO_ACTIVE_VIOLATION"
      )?.violationStatus || "NO_ACTIVE_VIOLATION"
    );
  }
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

async function lookupPartnerInfoBeforeSave(lookupInput, timeoutMs = OPENING_SAVE_LOOKUP_TIMEOUT_MS) {
  if (!(timeoutMs > 0)) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await lookupPartnerInfo({
      ...lookupInput,
      partnerRole: "NT",
      signal: controller.signal,
      throwOnError: true,
    });
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
  const pendingByCode = new Map();

  const completeMissingMemberFields = (member, lookupData) => {
    if (!member || !lookupData) return;
    for (const field of [
      "tenNhaThau",
      "maNhaThau",
      "maSoThue",
      "tenVietTat",
      "nguoiDaiDien",
      "chucVuDaiDien",
      "soDienThoai",
      "diaChi",
      "diaChiGoc",
    ]) {
      if (String(member[field] || "").trim()) continue;
      if (!String(lookupData[field] || "").trim()) continue;
      member[field] = lookupData[field];
    }
  };

  const queueLookup = (code, targetType, target) => {
    const lookupInput = getPartnerLookupInput(code);
    if (!lookupInput) return;
    const normalizedCode = normalizeContractorLookupCode(code);
    if (!pendingByCode.has(normalizedCode)) {
      pendingByCode.set(normalizedCode, { code, lookupInput, rows: [], members: [] });
    }
    pendingByCode.get(normalizedCode)[targetType].push(target);
  };

  const applyInfoToRow = async (row, code, info) => {
    const nameInput = row.querySelector(".mt-ten-nha-thau");
    row._leadMemberLookupData = await mapPartnerLookupToContractor(
      code,
      info,
      { normalizeAddress: false },
    );
    const names = resolveOpeningLookupNames(
      row.querySelector(".mt-loai-nha-thau")?.value,
      nameInput?.value,
      info.name || info.tenNhaThau,
      row._leadMemberName,
    );
    if (nameInput) nameInput.value = names.bidName;
    row._leadMemberName = names.leadMemberName;
  };

  for (const row of Array.from(rows || [])) {
    const codeInput = row.querySelector(".mt-ma-nha-thau");
    const code = codeInput?.value.trim() || "";
    if (!code) continue;
    const existing = findContractorByCode(latestContractors, code);
    if (existing) {
      await applyInfoToRow(row, code, existing);
      if (String(existing.nguoiDaiDien || "").trim()) continue;
    }
    queueLookup(code, "rows", row);
  }

  for (const row of Array.from(rows || [])) {
    for (const member of row._thanhVienLienDanh || []) {
      const code = member?.maNhaThau || member?.maSoThue || "";
      if (!code) continue;
      const existing = findContractorByCode(latestContractors, code);
      if (existing) {
        completeMissingMemberFields(member, existing);
        if (String(member.nguoiDaiDien || "").trim()) continue;
      }
      queueLookup(code, "members", member);
    }
  }

  const deadline = Date.now() + OPENING_SAVE_LOOKUP_TIMEOUT_MS;
  await runWithConcurrency(
    pendingByCode.values(),
    OPENING_LOOKUP_CONCURRENCY,
    async ({ code, lookupInput, rows: matchingRows, members: matchingMembers }) => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return;
      const codeInputs = matchingRows
        .map((row) => row.querySelector(".mt-ma-nha-thau"))
        .filter(Boolean);
      try {
        codeInputs.forEach((input) => setRuntimeStyle(input, "opacity", "0.7"));
        const info = await lookupPartnerInfoBeforeSave(lookupInput, remainingMs);
        if (!info?.name) return;
        await Promise.all(matchingRows.map((row) => applyInfoToRow(row, code, info)));
        const lookupData = await mapPartnerLookupToContractor(
          code,
          info,
          { normalizeAddress: false },
        );
        matchingMembers.forEach((member) => completeMissingMemberFields(member, lookupData));
      } catch (error) {
        console.error("Contractor lookup before saving bid opening failed:", error);
      } finally {
        codeInputs.forEach((input) => setRuntimeStyle(input, "opacity", "1"));
      }
    },
  );
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
