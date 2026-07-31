export function isCompetitiveQuotationPackage(pkg) {
  return String(pkg?.hinhThucLuaChon || "").trim().toLowerCase() === "chào hàng cạnh tranh";
}

export function clearCompetitiveQuotationAppraisal(pkg) {
  if (!pkg || !isCompetitiveQuotationPackage(pkg)) return pkg;
  pkg.yeuCauThamDinhHsmt = "Không";
  pkg.yeuCauThamDinhHsmtCode = "NOT_REQUIRED";
  // Evidence is intentionally retained. Applicability hides it for competitive
  // offering packages and restores it if the package facts change later.
  return pkg;
}
