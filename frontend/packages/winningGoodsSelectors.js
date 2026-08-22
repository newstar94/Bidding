import { supportsGoodsWorkflow } from "./goodsWorkflowSupport.js";

function id(value) {
  return String(value ?? "").trim();
}

export function hasWinningGoodsExportScope(pkg) {
  if (!supportsGoodsWorkflow(pkg)) return false;
  if (id(pkg?.phanLo) === "Có") {
    return (pkg?.phanLoList || []).some((lot) => id(lot?.nhaThauTrungThauId));
  }
  return Boolean(id(pkg?.nhaThauTrungThauId));
}
