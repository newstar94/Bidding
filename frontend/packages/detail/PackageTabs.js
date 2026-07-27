import {
  getOfficialEvaluationLotState,
  isBidWithinEvaluationLotDetails,
  resolveActiveSavedEvaluationScope,
} from "../lotEvaluationScope.js";
import { isLowPriceBidRejected } from "../bidEvaluationLowPriceRules.js";

export function checkBidQualified(bid, pkg = null) {
  if (!bid) return false;
  if (pkg && isLowPriceBidRejected(pkg, bid)) return false;
  const conclusion = String(bid.danhGiaKetLuan || "").trim().toLowerCase();
  if (conclusion) {
    return conclusion === "đạt" || conclusion.startsWith("đạt") || conclusion.includes("trúng thầu");
  }
  const validity = String(bid.danhGiaHopLe || "").trim().toLowerCase();
  const capacity = String(bid.danhGiaNangLuc || "").trim().toLowerCase();
  const technical = String(bid.danhGiaKyThuat || "").trim().toLowerCase();
  return validity === "đạt" && capacity === "đạt" && technical !== "không đạt" && technical !== "";
}

function parseMetadata(value) {
  if (!value) return {};
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return {};
  }
}

export function getPackageWorkflowState(pkg, bids = []) {
  const metadata = parseMetadata(pkg?.danhGiaHsdtMetadata);
  const isTwoEnvelope = pkg?.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const activeSavedEvaluationScope = !isTwoEnvelope
    ? resolveActiveSavedEvaluationScope(pkg, metadata)
    : null;
  const activeTechnicalScope = isTwoEnvelope
    ? resolveActiveSavedEvaluationScope(pkg, metadata.technical || {})
    : null;
  const activeFinancialScope = isTwoEnvelope
    ? resolveActiveSavedEvaluationScope(pkg, metadata.financial || {})
    : null;
  const officialLotState = getOfficialEvaluationLotState(
    pkg,
    isTwoEnvelope ? metadata.technical || {} : metadata,
  );
  const qualifiedBids = bids
    .filter((bid) => !activeTechnicalScope || isBidWithinEvaluationLotDetails(bid, activeTechnicalScope))
    .filter(checkBidQualified);
  return {
    isTwoEnvelope,
    isTechEvalSaved: isTwoEnvelope ? Boolean(metadata.is1G2T && (metadata.technical?.saved || activeTechnicalScope)) : false,
    isFinEvalSaved: isTwoEnvelope ? Boolean(metadata.is1G2T && (metadata.financial?.saved || activeFinancialScope)) : false,
    isSingleEnvelopeEvalSaved: !isTwoEnvelope && Boolean(metadata.saved),
    isSingleEnvelopeScopedEvalSaved: Boolean(activeSavedEvaluationScope),
    hasOfficialLotResults: officialLotState.history.length > 0,
    activeSavedEvaluationScope,
    isQualifiedSaved: Boolean(isTwoEnvelope && metadata.is1G2T && (
      metadata.technical?.qualifiedSaved || activeTechnicalScope?.batch?.qualifiedSaved
    )),
    qualifiedBids,
    isFinOpeningSaved: qualifiedBids.some((bid) => Number(bid.giaDuThau) > 0),
    hasCancelDetails: Boolean(metadata.cancelDetails?.soQuyetDinhHuyThau || metadata.cancelDetails?.lyDoHuyThau)
  };
}

export function buildPackageTabs(pkg, bids = [], { currentTab = "" } = {}) {
  const state = getPackageWorkflowState(pkg, bids);
  const tabs = [{ id: "preparation", label: "Thông tin gói thầu" }];
  const isDirectOrSpecial = pkg.hinhThucLuaChon === "Chỉ định thầu rút gọn"
    || pkg.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";

  if (isDirectOrSpecial) {
    tabs.push({ id: "opening", label: "Dữ liệu nhà thầu" });
    if (bids.length > 0) tabs.push({ id: "result", label: "Kết quả lựa chọn nhà thầu" });
  } else if (pkg.trangThai === "Chuẩn bị") {
    tabs.push({ id: "preparation_action", label: "Phát hành E-HSMT" });
  } else if (state.isTwoEnvelope) {
    tabs.push({ id: "opening_tech", label: pkg.trangThai === "Đang mời thầu" ? "Thông tin mời thầu" : "Biên bản mở E-HSĐXKT" });
    if (pkg.trangThai !== "Đang mời thầu" && pkg.trangThai !== "Đã mở thầu" && (pkg.trangThai !== "Hủy thầu" || state.isTechEvalSaved)) {
      tabs.push({ id: "eval_tech", label: "Báo cáo đánh giá E-HSĐXKT" });
    }
    const hasQualifiedBidders = state.qualifiedBids.length > 0;
    if (state.isTechEvalSaved && hasQualifiedBidders) tabs.push({ id: "qualified", label: "Danh sách nhà thầu đạt kỹ thuật" });
    if (state.isTechEvalSaved && state.isQualifiedSaved && hasQualifiedBidders) tabs.push({ id: "opening_fin", label: "Biên bản mở E-HSĐXTC" });
    if (state.isTechEvalSaved && state.isQualifiedSaved && hasQualifiedBidders && state.isFinOpeningSaved) {
      tabs.push({ id: "eval_fin", label: "Báo cáo đánh giá E-HSĐXTC" });
    }
    const resultWithoutQualified = state.isTechEvalSaved && !hasQualifiedBidders;
    const resultNormal = state.isTechEvalSaved && state.isQualifiedSaved && hasQualifiedBidders && state.isFinOpeningSaved
      && (state.isFinEvalSaved || pkg.trangThai === "Đã có kết quả" || (pkg.trangThai === "Hủy thầu" && pkg.soQuyetDinhKetQua));
    if (resultWithoutQualified || resultNormal || state.hasOfficialLotResults) {
      tabs.push({ id: "result", label: "Kết quả lựa chọn nhà thầu" });
    }
  } else {
    tabs.push({ id: "opening", label: pkg.trangThai === "Đang mời thầu" ? "Thông tin mời thầu" : "Biên bản mở thầu" });
    if (pkg.trangThai !== "Đang mời thầu" && pkg.trangThai !== "Đã mở thầu" && (pkg.trangThai !== "Hủy thầu" || state.isSingleEnvelopeEvalSaved)) {
      tabs.push({ id: "eval_tech", label: "Báo cáo đánh giá E-HSDT" });
    }
    if (state.isSingleEnvelopeEvalSaved || state.isSingleEnvelopeScopedEvalSaved || state.hasOfficialLotResults || pkg.trangThai === "Đã có kết quả" || (pkg.trangThai === "Hủy thầu" && state.isSingleEnvelopeEvalSaved && pkg.soQuyetDinhKetQua)) {
      tabs.push({ id: "result", label: "Kết quả lựa chọn nhà thầu" });
    }
  }

  if (pkg.trangThai === "Hủy thầu" || currentTab === "cancel" || state.hasCancelDetails) {
    tabs.push({ id: "cancel", label: "Hủy thầu" });
  }
  tabs.push({ id: "documents", label: "Tài liệu" });
  return { tabs, ...state };
}
