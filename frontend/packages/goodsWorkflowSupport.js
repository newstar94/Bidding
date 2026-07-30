const GOODS_WORKFLOW_FIELDS = new Set(["Hàng hóa", "Hỗn hợp"]);

export function supportsGoodsWorkflow(pkgOrField) {
  const field = typeof pkgOrField === "object" && pkgOrField !== null
    ? pkgOrField.linhVuc
    : pkgOrField;
  return GOODS_WORKFLOW_FIELDS.has(String(field || "").trim());
}
