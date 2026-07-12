export function isCompetitiveQuotationPackage(pkg) {
  return String(pkg?.hinhThucLuaChon || "").trim().toLowerCase() === "chào hàng cạnh tranh";
}

export function clearCompetitiveQuotationAppraisal(pkg) {
  if (!pkg || !isCompetitiveQuotationPackage(pkg)) return pkg;
  pkg.yeuCauThamDinhHsmt = "Không";
  pkg.soBaoCaoThamDinhHsmt = "";
  pkg.ngayBaoCaoThamDinhHsmt = "";
  pkg.toThamDinh = [];
  const rawMetadata = pkg.danhGiaHsdtMetadata;
  let metadata = rawMetadata;
  if (typeof rawMetadata === "string" && rawMetadata.trim()) {
    try {
      metadata = JSON.parse(rawMetadata);
    } catch {
      metadata = null;
    }
  }
  if (metadata && typeof metadata === "object") {
    if (metadata.technical) {
      delete metadata.technical.soBctdKt;
      delete metadata.technical.ngayBctdKt;
    }
    if (metadata.result) {
      delete metadata.result.soBctdKetQua;
      delete metadata.result.ngayBctdKetQua;
    }
    pkg.danhGiaHsdtMetadata = typeof rawMetadata === "string" ? JSON.stringify(metadata) : metadata;
  }
  return pkg;
}
