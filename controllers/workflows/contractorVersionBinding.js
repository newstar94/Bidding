export function isJointVentureBid(bid) {
  return String(bid?.loaiNhaThau || "").trim().toLowerCase() === "liên danh";
}

export function getExactContractorVersion(model, contractorVersionId) {
  if (!contractorVersionId) return null;
  return (model?.state?.nhathau || []).find(
    (contractor) => String(contractor.id) === String(contractorVersionId)
  ) || null;
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
