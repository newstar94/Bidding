export function calculateRankings(gt, bids) {
  const rankings = {};
  const scores = {};
  const isTuVan = gt.linhVuc === "Tư vấn";
  const method = gt.phuongPhapDanhGia || "";
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
    const lotBids = groups[lot];
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
    const getPriceG = (b) => {
      return parseFloat(b.giaSauGiamGia || b.giaDuThau || 0);
    };
    let eligibleBids = [];
    if (isTuVan) {
      if (method === "Giá thấp nhất") {
        eligibleBids = lotBids.filter((b) => {
          const kt = (b.danhGiaKyThuat || "").trim().toLowerCase();
          return kt !== "không đạt" && kt !== "";
        });
        eligibleBids.sort((x, y) => getPriceG(x) - getPriceG(y));
      } else if (method === "Giá cố định") {
        const packagePrice = parseFloat(gt.giaGoiThau || 0);
        eligibleBids = lotBids.filter((b) => {
          const price = getPriceG(b);
          return price > 0 && price <= packagePrice;
        });
        eligibleBids.sort((x, y) => getTechScore(y) - getTechScore(x));
      } else if (method === "Kết hợp giữa kỹ thuật và giá") {
        eligibleBids = lotBids.filter(isQualified);
        const prices = eligibleBids.map(getPriceG).filter((p) => p > 0);
        const gMin = prices.length > 0 ? Math.min(...prices) : 0;
        const techScores = eligibleBids.map(getTechScore);
        const maxTech = techScores.length > 0 ? Math.max(...techScores) : 0;
        const K = parseFloat(gt.trongSoKyThuat !== void 0 && gt.trongSoKyThuat !== null ? gt.trongSoKyThuat : 80);
        const T = 100 - K;
        eligibleBids.forEach((b) => {
          const gCurrent = getPriceG(b);
          const techCurrent = getTechScore(b);
          let score = 0;
          if (gCurrent > 0 && maxTech > 0) {
            score = gMin / gCurrent * T + techCurrent / maxTech * K;
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
        eligibleBids = lotBids.filter(isQualified);
        eligibleBids.sort((x, y) => getPriceG(x) - getPriceG(y));
      } else if (method === "Giá đánh giá") {
        eligibleBids = lotBids.filter(isQualified);
        eligibleBids.forEach((b) => {
          const basePrice = getPriceG(b);
          const convertedCost = parseFloat(b.chiPhiQuyDoi || 0);
          scores[b.id] = basePrice + convertedCost;
        });
        eligibleBids.sort((x, y) => (scores[x.id] || 0) - (scores[y.id] || 0));
      } else if (method === "Kết hợp giữa kỹ thuật và giá") {
        eligibleBids = lotBids.filter(isQualified);
        const prices = eligibleBids.map(getPriceG).filter((p) => p > 0);
        const gMin = prices.length > 0 ? Math.min(...prices) : 0;
        const techScores = eligibleBids.map(getTechScore);
        const maxTech = techScores.length > 0 ? Math.max(...techScores) : 0;
        const K = parseFloat(gt.trongSoKyThuat !== void 0 && gt.trongSoKyThuat !== null ? gt.trongSoKyThuat : 30);
        const T = 100 - K;
        eligibleBids.forEach((b) => {
          const gCurrent = getPriceG(b);
          const techCurrent = getTechScore(b);
          let score = 0;
          if (gCurrent > 0 && maxTech > 0) {
            score = gMin / gCurrent * T + techCurrent / maxTech * K;
          }
          scores[b.id] = score;
        });
        eligibleBids.sort((x, y) => (scores[y.id] || 0) - (scores[x.id] || 0));
      }
    }
    eligibleBids.forEach((b, index) => {
      rankings[b.id] = index + 1;
    });
  }
  return { rankings, scores };
}
