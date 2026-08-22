import {
  normalizeOrganizationName,
  normalizePersonName,
  normalizeProcurementOrgCode,
  normalizeVietnamTaxCode,
} from "../app/domUtils.js";
import { generateRecordId } from "../shared/idUtils.js";
import {
  buildInitialPartnerVersion,
  PARTNER_FORM_CONFIGS,
  sanitizePartnerLookupData,
} from "../partners/PartnerFormController.js";

function sourceCode(value) {
  return normalizeProcurementOrgCode(String(value || "").split("-", 1)[0]);
}

export function deriveInvestorShortName(approvalDecisionNo) {
  const normalized = String(approvalDecisionNo || "").normalize("NFKC").trim();
  const match = normalized.match(
    /(?:^|[-/])\s*QĐ\s*[-/]\s*([\p{L}\p{N}]+)\s*$/iu,
  );
  return match ? match[1].toLocaleUpperCase("vi") : "";
}

function normalizedInvestorName(value) {
  return normalizeOrganizationName(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function findExisting(records, code, taxCode, name = "") {
  const direct = (records || []).find((record) => (
    code && normalizeProcurementOrgCode(record?.maChuDauTu) === code
  ) || (
    taxCode && normalizeVietnamTaxCode(record?.maSoThue) === taxCode
  ));
  if (direct) return direct;
  const normalizedName = normalizedInvestorName(name);
  if (!normalizedName) return null;
  const nameMatches = (records || []).filter((record) => (
    normalizedInvestorName(
      record?.tenChuDauTu || record?.investorName || record?.name,
    ) === normalizedName
  ));
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function buildPendingInvestor(info, { createId, timestamp, effectiveDate, records }) {
  info = sanitizePartnerLookupData(info);
  const code = sourceCode(info?.org_code);
  const name = normalizeOrganizationName(info?.name || "");
  const representative = normalizePersonName(info?.representative_name || "");
  const position = String(info?.representative_position || "").trim();
  const address = String(info?.address || "").trim();
  if (!code || !name || !representative || !position || !address) {
    throw new Error("PROCUREMENT_INVESTOR_RESOLUTION_FAILED");
  }
  const id = createId("chudautu");
  return buildInitialPartnerVersion({
    maChuDauTu: code,
    maSoThue: info.tax_code,
    tenChuDauTu: name,
    tenVietTat: String(info?.short_name || "").trim(),
    ngayApDung: effectiveDate,
    daiDienCdt: representative,
    chucVuDaiDien: position,
    chucVuNguoiDungDau: String(info?.head_position || position).trim(),
    danhXung: String(info?.salutation || "Ông/Bà").trim(),
    diaChi: address,
    diaChiGoc: address,
    soDienThoai: info.phone,
    email: info.email,
    soTaiKhoan: String(info?.bank_account || "").trim(),
    noiMoTaiKhoan: String(info?.bank_name || "").trim(),
    maQHNS: String(info?.budget_code || "").trim(),
    coQuanChuQuan: String(info?.parent_agency || "").trim(),
  }, {
    id,
    timestamp,
    records,
    config: PARTNER_FORM_CONFIGS.chudautu,
    validationErrorCode: "PROCUREMENT_INVESTOR_RESOLUTION_FAILED",
  });
}

export async function resolveImportedInvestorDraft({
  source,
  records,
  lookup,
  createId = generateRecordId,
  timestamp = new Date().toISOString(),
  effectiveDate = String(new Date().toISOString()).slice(0, 10),
} = {}) {
  const code = sourceCode(source?.code);
  const taxCode = normalizeVietnamTaxCode(source?.taxCode);
  const name = source?.name || source?.investorName || source?.tenChuDauTu;
  const existing = findExisting(records, code, taxCode, name);
  if (existing) return { status: "EXISTING", investor: existing };
  if (!code && !taxCode) throw new Error("PROCUREMENT_INVESTOR_RESOLUTION_FAILED");
  const info = await lookup?.({ orgCode: code, taxCode, partnerRole: "CDT" });
  const resolvedCode = sourceCode(info?.org_code || code);
  const resolvedTax = normalizeVietnamTaxCode(info?.tax_code || taxCode);
  const raced = findExisting(
    records,
    resolvedCode,
    resolvedTax,
    info?.name || info?.investorName || info?.tenChuDauTu || name,
  );
  if (raced) return { status: "EXISTING", investor: raced };
  const shortName = deriveInvestorShortName(source?.approvalDecisionNo);
  const investor = buildPendingInvestor(
    {
      ...info,
      org_code: resolvedCode,
      tax_code: resolvedTax,
      short_name: shortName,
    },
    { createId, timestamp, effectiveDate, records },
  );
  return { status: "NEW", investor };
}
