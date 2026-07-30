import { supportsGoodsWorkflow } from "./goodsWorkflowSupport.js";

export const BIDDER_GOODS_TAB = "bidder_goods";

export function shouldShowBidderGoodsTab(pkg, roundType, bid = null) {
  if (!supportsGoodsWorkflow(pkg)) return false;
  if (roundType === "technical") return false;
  if (roundType === "financial") return Boolean(bid);
  return roundType === "single";
}

export function getBidderGoodsRequirements(model, pkg, bid) {
  const lotCode = String(bid?.maPhanLo || "").trim().toLocaleLowerCase("vi");
  const lot = (pkg?.phanLoList || []).find((item) => String(item.maPhanLo || "").trim().toLocaleLowerCase("vi") === lotCode);
  return (model?.state?.goithauhanghoa || []).filter((item) => (
    String(item.goiThauId || "") === String(pkg?.id || "")
    && String(item.phanLoId || "") === String(lot?.id || "")
  ));
}

export function getBidderGoodsForBid(model, pkg, bid) {
  return (model?.state?.hanghoaduthaunhathau || []).filter((item) => (
    String(item.goiThauId || "") === String(pkg?.id || "")
    && String(item.thongTinMoThauId || "") === String(bid?.id || "")
  )).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}
