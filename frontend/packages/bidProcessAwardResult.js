import { isLowPriceBidRejected } from "./bidEvaluationLowPriceRules.js";
import {
  parseEvaluationMetadataStrict,
  serializeEvaluationMetadata,
} from "./evaluationMetadata.js";
import { parseLotListStrict } from "./lotJsonParser.js";

export function getWinnerRows(tbodyResult, { isDirectOrSpecial }) {
  if (!tbodyResult) return [];
  return Array.from(tbodyResult.querySelectorAll("tr")).filter((row) => {
    if (isDirectOrSpecial) return true;
    return row.querySelector(".row-status-select")?.value === "trung";
  });
}
export function applyAutoPassedEvaluation({ gt, bids, model }) {
  bids.forEach((bid) => {
    const bidInState = model.state.thongtinmothau.find((item) => item.id === bid.id);
    if (bidInState) {
      bidInState.danhGiaHopLe = "Đạt";
      bidInState.danhGiaNangLuc = "Đạt";
      bidInState.danhGiaKyThuat = "Đạt";
      bidInState.danhGiaKetLuan = "Đạt";
      bidInState.danhGiaTaiChinh = "Xếp hạng 1";
    }
  });
  const existingMeta = parseEvaluationMetadataStrict(gt.danhGiaHsdtMetadata);
  if (!existingMeta.saved) {
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    gt.danhGiaHsdtMetadata = serializeEvaluationMetadata({
      ...existingMeta,
      soBaoCao: "Tự động",
      ngayBaoCao: today,
      saved: true
    });
  }
}
export function applyResultRowsToBids(tbodyResult, model) {
  if (!tbodyResult) return;
  tbodyResult.querySelectorAll("tr").forEach((row) => {
    const bidId = row.getAttribute("data-approve-bid-id");
    const bid = model.state.thongtinmothau.find((item) => item.id === bidId);
    if (!bid) return;
    const status = row.querySelector(".row-status-select")?.value;
    if (status === "trung") {
      bid.lyDoTruot = "";
    } else {
      bid.lyDoTruot = row.querySelector(".row-ly-do-truot")?.value.trim() || "Nhà thầu xếp hạng 1 trúng thầu";
    }
  });
}
export function applyAwardResultToPackage({ gt, bids, winnerRows, tbodyResult, model }) {
  const lotList = gt.phanLo === "Có"
    ? parseLotListStrict(gt.phanLoList, { context: "legacy_award_command" })
    : null;
  const winner = resolveWinner({ gt, bids, winnerRows, model });
  if (gt.phanLo === "Có") {
    const plList = lotList;
    if (tbodyResult) {
      plList.forEach((pl) => {
        const lotWinnerRow = winnerRows.find((row) => row.cells[0]?.textContent.trim() === pl.maPhanLo);
        if (lotWinnerRow) {
          const winnerId = lotWinnerRow.getAttribute("data-nt-id");
          pl.nhaThauTrungThauId = winnerId ? normalizeId(winnerId) : "";
          pl.giaTrungThau = model.parseVND(lotWinnerRow.querySelector(".row-gia-trung")?.value || "0");
          pl.thoiGianGoiThau = lotWinnerRow.querySelector(".row-tg-goithau")?.value.trim() || "";
          pl.thoiGianHopDong = lotWinnerRow.querySelector(".row-tg-hopdong")?.value.trim() || "";
        } else {
          applyFallbackLotWinner({ pl, bids, gt, model });
        }
      });
      gt.phanLoList = plList;
    }
    if (winner.id) gt.nhaThauTrungThauId = normalizeId(winner.id);
    const winnerTotal = model.sumVND(winnerRows.map((row) => row.querySelector(".row-gia-trung")?.value || "0"));
    const fallbackTotal = model.sumVND(bids.filter((bid) => !isLowPriceBidRejected(gt, bid)).map((bid) => {
      const bidState = model.state.thongtinmothau.find((item) => item.id === bid.id);
      return bidState?.giaDeNghiTrungThau || bidState?.giaSauGiamGia || bidState?.giaDuThau || 0;
    }));
    gt.giaTrungThau = winnerRows.length ? winnerTotal : fallbackTotal;
    return;
  }
  gt.nhaThauTrungThauId = winner.id ? normalizeId(winner.id) : "";
  gt.giaTrungThau = winner.price;
  gt.thoiGianGoiThau = winner.durationPackage;
  gt.thoiGianHopDong = winner.durationContract;
}
export function applyAwardMetadata({ gt, isDirectOrSpecial, soBctdVal, ngayBctdVal, directDates, decDate }) {
  const metaFinal = parseEvaluationMetadataStrict(gt.danhGiaHsdtMetadata);
  if (!metaFinal.result) metaFinal.result = {};
  if (soBctdVal) metaFinal.result.soBctdKetQua = soBctdVal;
  if (ngayBctdVal) metaFinal.result.ngayBctdKetQua = ngayBctdVal;
  if (isDirectOrSpecial) {
    Object.assign(metaFinal.result, {
      danhGiaNangLuc: directDates.danhGiaNangLucVal,
      ngayYeuCauBaoGia: directDates.dateYcbgi,
      ngayGuiBaoGia: directDates.dateGbgi,
      ngayBaoCaoDanhGiaNhaThau: directDates.dateBcdg,
      ngayMoiThuongThao: directDates.dateMtt,
      ngayThuongThao: directDates.dateTt,
      ngayTrinhKetQua: directDates.dateTkq,
      ngayPheDuyetKetQua: decDate
    });
  }
  gt.danhGiaHsdtMetadata = serializeEvaluationMetadata(metaFinal);
}
function resolveWinner({ gt, bids, winnerRows, model }) {
  if (winnerRows.length > 0) {
    const row = winnerRows[0];
    return {
      id: row.getAttribute("data-nt-id") || "",
      price: model.parseVND(row.querySelector(".row-gia-trung")?.value || "0"),
      durationPackage: row.querySelector(".row-tg-goithau")?.value.trim() || "",
      durationContract: row.querySelector(".row-tg-hopdong")?.value.trim() || ""
    };
  }
  const firstBid = bids.find((bid) => !isLowPriceBidRejected(gt, bid));
  if (!firstBid) {
    return { id: "", price: 0, durationPackage: "", durationContract: "" };
  }
  const foundBid = model.state.thongtinmothau.find((item) => item.id === firstBid.id);
  if (!foundBid) {
    return { id: "", price: 0, durationPackage: "", durationContract: "" };
  }
  const durationPackage = foundBid.thoiGianThucHien || gt.thoiGianThucHien || "";
  return {
    id: foundBid.nhaThauId || foundBid.id,
    price: foundBid.giaDeNghiTrungThau || foundBid.giaSauGiamGia || foundBid.giaDuThau || 0,
    durationPackage,
    durationContract: durationPackage ? `${durationPackage} + Thời gian thực hiện các nghĩa vụ theo hợp đồng` : ""
  };
}
function applyFallbackLotWinner({ pl, bids, gt, model }) {
  const firstLotBid = bids.find((bid) => (
    bid.maPhanLo === pl.maPhanLo && !isLowPriceBidRejected(gt, bid)
  ));
  if (!firstLotBid) return;
  const bidState = model.state.thongtinmothau.find((item) => item.id === firstLotBid.id);
  pl.nhaThauTrungThauId = bidState?.nhaThauId || "";
  pl.giaTrungThau = bidState?.giaDeNghiTrungThau || bidState?.giaSauGiamGia || bidState?.giaDuThau || 0;
  pl.thoiGianGoiThau = bidState?.thoiGianThucHien || gt.thoiGianThucHien || "";
  pl.thoiGianHopDong = pl.thoiGianGoiThau ? `${pl.thoiGianGoiThau} + Thời gian thực hiện các nghĩa vụ theo hợp đồng` : "";
}
function normalizeId(id) {
  return isNaN(id) ? id : parseInt(id);
}
