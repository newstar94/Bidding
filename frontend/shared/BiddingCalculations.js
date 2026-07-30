import { parseVND } from "./formatters.js";
import { isLowPriceBidRejected } from "../packages/bidEvaluationLowPriceRules.js";
import { supportsGoodsWorkflow } from "../packages/goodsWorkflowSupport.js";

function moneyBigInt(value) {
  const parsed = parseVND(value);
  return BigInt(parsed === null ? 0 : parsed);
}

function compareMoney(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function goodsPreferenceRankingBlockReason(pkg = {}, bid = {}) {
  const method = String(pkg.phuongPhapDanhGia || "");
  if (
    supportsGoodsWorkflow(pkg)
    && ["Giá thấp nhất", "Giá đánh giá"].includes(method)
    && (
      bid.trangThaiTinhUuDai !== "ready"
      || (method === "Giá đánh giá"
        ? bid.giaDanhGiaSauUuDai
        : bid.giaSoSanhSauUuDai) == null
    )
  ) {
    return "Chưa đủ dữ liệu ưu đãi để xếp hạng";
  }
  return "";
}

export function calculateRankings(gt, bids) {
  const rankings = {};
  const scores = {};
  const isTuVan = gt.linhVuc === "Tư vấn";
  const method = gt.phuongPhapDanhGia || "";
  const requiresGoodsPreference = supportsGoodsWorkflow(gt)
    && ["Giá thấp nhất", "Giá đánh giá"].includes(method);
  const hasLots = gt.phanLo === "Có";
  const groups = {};
  if (hasLots) {
    bids.forEach((b) => {
      const lot = b.maPhanLo || "default";
      if (!groups[lot]) groups[lot] = [];
      groups[lot].push(b);
    });
  } else {
    groups["default"] = bids;
  }
  for (const lot in groups) {
    const lotBids = groups[lot].filter((bid) => !isLowPriceBidRejected(gt, bid));
    const isQualified = (b) => {
      if (b.danhGiaKetLuan) {
        return b.danhGiaKetLuan === "Đạt" || b.danhGiaKetLuan.startsWith("Đạt");
      }
      const hl = (b.danhGiaHopLe || "").trim().toLowerCase() === "đạt";
      const nl = (b.danhGiaNangLuc || "").trim().toLowerCase() === "đạt";
      const kt = (b.danhGiaKyThuat || "").trim().toLowerCase();
      const isKtOk = kt !== "không đạt" && kt !== "";
      return hl && nl && isKtOk;
    };
    const getTechScore = (b) => {
      const val = (b.danhGiaKyThuat || "").trim().replace(/,/g, ".");
      return parseFloat(val) || 0;
    };
    const getPriceG = (b) => moneyBigInt(b.giaSauGiamGia || b.giaDuThau);
    const hasReadyGoodsPreference = (b) => !goodsPreferenceRankingBlockReason(gt, b);
    const getRankingPrice = (b) => moneyBigInt(
      requiresGoodsPreference
        ? method === "Giá đánh giá" ? b.giaDanhGiaSauUuDai : b.giaSoSanhSauUuDai
        : b.giaXepHang || b.giaSauGiamGia || b.giaDuThau,
    );
    let eligibleBids = [];
    if (isTuVan) {
      if (method === "Giá thấp nhất") {
        eligibleBids = lotBids.filter((b) => {
          const kt = (b.danhGiaKyThuat || "").trim().toLowerCase();
          return kt !== "không đạt" && kt !== "";
        });
        eligibleBids.sort((x, y) => compareMoney(getRankingPrice(x), getRankingPrice(y)));
      } else if (method === "Giá cố định") {
        const packagePrice = moneyBigInt(gt.giaGoiThau);
        eligibleBids = lotBids.filter((b) => {
          const price = getPriceG(b);
          return price > 0n && price <= packagePrice;
        });
        eligibleBids.sort((x, y) => getTechScore(y) - getTechScore(x));
      } else if (method === "Kết hợp giữa kỹ thuật và giá") {
        eligibleBids = lotBids.filter((bid) => isQualified(bid) && hasReadyGoodsPreference(bid));
        const prices = eligibleBids.map(getRankingPrice).filter((p) => p > 0n);
        const gMin = prices.reduce((minimum, price) => price < minimum ? price : minimum, prices[0] || 0n);
        const techScores = eligibleBids.map(getTechScore);
        const maxTech = techScores.length > 0 ? Math.max(...techScores) : 0;
        const K = parseFloat(gt.trongSoKyThuat !== void 0 && gt.trongSoKyThuat !== null ? gt.trongSoKyThuat : 80);
        const T = 100 - K;
        eligibleBids.forEach((b) => {
          const gCurrent = getRankingPrice(b);
          const techCurrent = getTechScore(b);
          let score = 0;
          if (gCurrent > 0n && maxTech > 0) {
            score = Number(gMin) / Number(gCurrent) * T + techCurrent / maxTech * K;
          }
          scores[b.id] = score;
        });
        eligibleBids.sort((x, y) => (scores[y.id] || 0) - (scores[x.id] || 0));
      } else if (method === "Dựa trên kỹ thuật") {
        eligibleBids = [...lotBids];
        eligibleBids.sort((x, y) => getTechScore(y) - getTechScore(x));
      }
    } else {
      if (method === "Giá thấp nhất") {
        eligibleBids = lotBids.filter((bid) => isQualified(bid) && hasReadyGoodsPreference(bid));
        eligibleBids.sort((x, y) => compareMoney(getRankingPrice(x), getRankingPrice(y)));
      } else if (method === "Giá đánh giá") {
        eligibleBids = lotBids.filter((bid) => isQualified(bid) && hasReadyGoodsPreference(bid));
        eligibleBids.forEach((b) => {
          const preferencePrice = requiresGoodsPreference ? moneyBigInt(b.giaDanhGiaSauUuDai) : 0n;
          const explicitRankingPrice = moneyBigInt(b.giaXepHang);
          const basePrice = getPriceG(b);
          const evaluationPrice = preferencePrice > 0n
            ? preferencePrice
            : explicitRankingPrice > 0n ? explicitRankingPrice : basePrice + moneyBigInt(b.chiPhiQuyDoi);
          scores[b.id] = Number(evaluationPrice);
          b.__evaluationPrice = evaluationPrice;
        });
        eligibleBids.sort((x, y) => compareMoney(x.__evaluationPrice, y.__evaluationPrice));
        eligibleBids.forEach((bid) => delete bid.__evaluationPrice);
      } else if (method === "Kết hợp giữa kỹ thuật và giá") {
        eligibleBids = lotBids.filter(isQualified);
        const prices = eligibleBids.map(getRankingPrice).filter((p) => p > 0n);
        const gMin = prices.reduce((minimum, price) => price < minimum ? price : minimum, prices[0] || 0n);
        const techScores = eligibleBids.map(getTechScore);
        const maxTech = techScores.length > 0 ? Math.max(...techScores) : 0;
        const K = parseFloat(gt.trongSoKyThuat !== void 0 && gt.trongSoKyThuat !== null ? gt.trongSoKyThuat : 30);
        const T = 100 - K;
        eligibleBids.forEach((b) => {
          const gCurrent = getRankingPrice(b);
          const techCurrent = getTechScore(b);
          let score = 0;
          if (gCurrent > 0n && maxTech > 0) {
            score = Number(gMin) / Number(gCurrent) * T + techCurrent / maxTech * K;
          }
          scores[b.id] = score;
        });
        eligibleBids.sort((x, y) => (scores[y.id] || 0) - (scores[x.id] || 0));
      } else if (method === "Dựa trên kỹ thuật") {
        eligibleBids = lotBids.filter(isQualified);
        eligibleBids.sort((x, y) => getTechScore(y) - getTechScore(x));
      }
    }
    eligibleBids.forEach((b, index) => {
      rankings[b.id] = index + 1;
    });
  }
  return { rankings, scores };
}
