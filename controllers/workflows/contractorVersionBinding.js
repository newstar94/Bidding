export function isJointVentureBid(bid) {
  return String(bid?.loaiNhaThau || "").trim().toLowerCase() === "liên danh";
}

export function getExactContractorVersion(model, contractorVersionId) {
  if (!contractorVersionId) return null;
  return (model?.state?.nhathau || []).find(
    (contractor) => String(contractor.id) === String(contractorVersionId)
  ) || null;
}

function dateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : "";
}

export function selectPartnerVersionForDate(records, partnerVersionId, businessDate) {
  const selected = (records || []).find((item) => String(item.id) === String(partnerVersionId));
  if (!selected) return null;
  const rootId = selected.rootId || selected.id;
  const family = (records || []).filter((item) => String(item.rootId || item.id) === String(rootId));
  if (!family.length) return selected;
  const target = dateOnly(businessDate);
  if (!target) return selected;
  const ranked = family.map((item) => ({
    item,
    effectiveDate: dateOnly(item.ngayApDung) || dateOnly(item.createdAt) || dateOnly(item.updatedAt),
    version: Number.parseInt(item.phienBan || "0", 10) || 0
  }));
  const applicable = ranked.filter((entry) => entry.effectiveDate && entry.effectiveDate <= target);
  if (applicable.length) {
    applicable.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.version - a.version);
    return applicable[0].item;
  }
  ranked.sort((a, b) => a.version - b.version || a.effectiveDate.localeCompare(b.effectiveDate));
  return ranked[0].item;
}

export function selectContractorVersionForDate(model, contractorVersionId, businessDate) {
  return selectPartnerVersionForDate(model?.state?.nhathau || [], contractorVersionId, businessDate);
}

export function resolveBidContractorName(model, bid) {
  if (!bid) return "";
  if (isJointVentureBid(bid)) return bid.tenNhaThau || "";
  return getExactContractorVersion(model, bid.nhaThauId)?.tenNhaThau || bid.tenNhaThau || "";
}

export function resolveBidJointVentureMembers(model, bid) {
  return (bid?.thanhVienLienDanh || []).map((member) => {
    const contractor = getExactContractorVersion(model, member.thanhVienNhaThauId);
    if (!contractor) return member;
    return {
      ...member,
      tenNhaThau: contractor.tenNhaThau || "",
      maNhaThau: contractor.maNhaThau || "",
      maSoThue: contractor.maSoThue || "",
      nguoiDaiDien: contractor.nguoiDaiDien || "",
      danhXung: contractor.danhXung || "",
      soDienThoai: contractor.soDienThoai || "",
      email: contractor.email || "",
      diaChi: contractor.diaChi || "",
      diaChiGoc: contractor.diaChiGoc || "",
      soTaiKhoan: contractor.soTaiKhoan || "",
      noiMoTaiKhoan: contractor.noiMoTaiKhoan || "",
      maNganHang: contractor.maNganHang || ""
    };
  });
}
