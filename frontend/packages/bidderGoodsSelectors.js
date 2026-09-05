export const BIDDER_GOODS_TAB = "bidder_goods";

export function isOfficialBidderGoodsRow(row) {
  return [false, 0, "0", "false", "False"].includes(row?.isDraft);
}

export function getBidderGoodsRequirements(model, pkg, bid) {
  const lotCode = String(bid?.maPhanLo || "").trim().toLocaleLowerCase("vi");
  const lot = (pkg?.phanLoList || []).find((item) => String(item.maPhanLo || "").trim().toLocaleLowerCase("vi") === lotCode);
  return (model?.state?.goithauhanghoa || []).filter((item) => (
    String(item.goiThauId || "") === String(pkg?.id || "")
    && String(item.phanLoId || "") === String(lot?.id || "")
  )).sort((left, right) => (
    Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
    || String(left.id || "").localeCompare(String(right.id || ""))
  ));
}

export function getBidderGoodsForBid(model, pkg, bid) {
  return (model?.state?.hanghoaduthaunhathau || []).filter((item) => (
    String(item.goiThauId || "") === String(pkg?.id || "")
    && String(item.thongTinMoThauId || "") === String(bid?.id || "")
  )).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}
