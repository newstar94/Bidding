import { normalizeTaxCodeForCompare } from "../app/domUtils.js";

export function isJointVentureBid(bid) {
  return String(bid?.loaiNhaThau || "").trim().toLowerCase() === "liên danh";
}

export function getExactContractorVersion(model, contractorVersionId) {
  if (!contractorVersionId) return null;
  return (model?.state?.nhathau || []).find(
    (contractor) => String(contractor.id) === String(contractorVersionId)
  ) || null;
}

export function findContractorVersionByCode(model, code) {
  const normalizedCode = normalizeTaxCodeForCompare(code);
  if (!normalizedCode) return null;
  const matches = (model?.state?.nhathau || []).filter((contractor) =>
    normalizeTaxCodeForCompare(contractor.maNhaThau) === normalizedCode
    || normalizeTaxCodeForCompare(contractor.maSoThue) === normalizedCode
  );
  if (!matches.length) return null;
  return matches.sort((a, b) => {
    const latestDiff = Number(b.isLatest || 0) - Number(a.isLatest || 0);
    if (latestDiff) return latestDiff;
    return (Number.parseInt(b.phienBan || "0", 10) || 0) - (Number.parseInt(a.phienBan || "0", 10) || 0);
  })[0];
}

export function resolveContractorVersion(model, contractor = {}) {
  return getExactContractorVersion(model, contractor.contractorVersionId || contractor.thanhVienNhaThauId || contractor.nhaThauId)
    || findContractorVersionByCode(model, contractor.maNhaThau || contractor.maSoThue || contractor.code);
}

function dateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : "";
}

export function resolvePartnerVersionForDate(records, partnerVersionId, businessDate) {
  const selected = (records || []).find((item) => String(item.id) === String(partnerVersionId));
  if (!selected) {
    return { status: "partner_not_found", record: null, firstEffectiveDate: "" };
  }
  const rootId = selected.rootId || selected.id;
  const family = (records || []).filter((item) => String(item.rootId || item.id) === String(rootId));
  if (!family.length) {
    return { status: "matched", record: selected, firstEffectiveDate: "" };
  }
  const target = dateOnly(businessDate);
  if (!target) {
    return { status: "business_date_unavailable", record: selected, firstEffectiveDate: "" };
  }
  const ranked = family.map((item) => ({
    item,
    effectiveDate: dateOnly(item.ngayApDung) || dateOnly(item.createdAt) || dateOnly(item.updatedAt),
    version: Number.parseInt(item.phienBan || "0", 10) || 0
  }));
  const applicable = ranked.filter((entry) => entry.effectiveDate && entry.effectiveDate <= target);
  if (applicable.length) {
    applicable.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.version - a.version);
    return {
      status: "matched",
      record: applicable[0].item,
      firstEffectiveDate: applicable[0].effectiveDate,
    };
  }
  const dated = ranked.filter((entry) => entry.effectiveDate)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.version - b.version);
  if (dated.length) {
    return {
      status: "no_effective_version",
      record: null,
      firstEffectiveDate: dated[0].effectiveDate,
    };
  }
  return { status: "effective_date_unavailable", record: selected, firstEffectiveDate: "" };
}

export function selectPartnerVersionForDate(records, partnerVersionId, businessDate) {
  return resolvePartnerVersionForDate(records, partnerVersionId, businessDate).record;
}

export function resolveBidContractorName(model, bid) {
  if (!bid) return "";
  return bid.tenNhaThau || getExactContractorVersion(model, bid.nhaThauId)?.tenNhaThau || "";
}

export function resolveBidJointVentureMembers(model, bid) {
  return (bid?.thanhVienLienDanh || []).map((member) => {
    const contractor = getExactContractorVersion(model, member.thanhVienNhaThauId);
    if (!contractor) return member;
    return {
      ...member,
      tenNhaThau: member.tenNhaThau || contractor.tenNhaThau || "",
      maNhaThau: member.maNhaThau || contractor.maNhaThau || "",
      maSoThue: member.maSoThue || contractor.maSoThue || "",
      nguoiDaiDien: member.nguoiDaiDien || contractor.nguoiDaiDien || "",
      danhXung: member.danhXung || contractor.danhXung || "",
      soDienThoai: member.soDienThoai || contractor.soDienThoai || "",
      email: member.email || contractor.email || "",
      diaChi: member.diaChi || contractor.diaChi || "",
      diaChiGoc: member.diaChiGoc || contractor.diaChiGoc || "",
      soTaiKhoan: member.soTaiKhoan || contractor.soTaiKhoan || "",
      noiMoTaiKhoan: member.noiMoTaiKhoan || contractor.noiMoTaiKhoan || "",
      maNganHang: member.maNganHang || contractor.maNganHang || ""
    };
  });
}
