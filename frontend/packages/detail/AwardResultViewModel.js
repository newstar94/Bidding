import { checkBidQualified } from "./PackageTabs.js";
import { getLowPriceRejectionReason, isLowPriceBidRejected } from "../bidEvaluationLowPriceRules.js";
import {
  getOfficialEvaluationLotState,
  isBidWithinEvaluationLotDetails,
  resolveActiveSavedEvaluationScope,
  resolvePackageResultStatus,
} from "../lotEvaluationScope.js";
import { parseEvaluationMetadataForDisplay } from "../evaluationMetadata.js";

const TWO_ENVELOPE_METHOD = "Một giai đoạn hai túi hồ sơ";
const AWARDED_STATUS = "Đã có kết quả";

function parseResultMetadata(value) {
  const metadata = parseEvaluationMetadataForDisplay(value).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { technical: {}, result: {} };
  }
  return {
    ...metadata,
    technical: metadata.technical && typeof metadata.technical === "object"
      ? metadata.technical
      : {},
    result: metadata.result && typeof metadata.result === "object"
      ? metadata.result
      : {},
  };
}

function resolveEffectiveEditState(pkg, metadata, isEditable, editState = {}) {
  const effective = {
    officialBatchId: String(editState.officialBatchId || "").trim(),
    currentBatchId: String(editState.currentBatchId || "").trim(),
    wholePackage: editState.wholePackage === true,
    wholePackageId: String(editState.wholePackageId || "").trim(),
  };
  if (!isEditable) return effective;

  const persisted = metadata.resultEdit || metadata.technical?.resultEdit || {};
  if (persisted.type === "batch" && persisted.batchId) {
    effective.officialBatchId = String(persisted.batchId).trim();
    effective.currentBatchId = effective.officialBatchId;
  } else if (persisted.type === "whole") {
    effective.wholePackage = true;
    effective.wholePackageId = String(pkg?.id || "");
  }
  return effective;
}

function bindFrozenContractorVersions(bids, resultMetadata) {
  const bindings = new Map(
    (Array.isArray(resultMetadata?.contractorBindings)
      ? resultMetadata.contractorBindings
      : [])
      .map((item) => [String(item?.bidId || ""), item]),
  );
  return bids.map((bid) => {
    const binding = bindings.get(String(bid?.id || ""));
    if (!binding) return bid;
    const memberIds = Array.isArray(binding.memberVersionIds)
      ? binding.memberVersionIds
      : [];
    return {
      ...bid,
      nhaThauId: binding.contractorVersionId || bid.nhaThauId,
      tenNhaThau: bid.loaiNhaThau === "Liên danh"
        ? binding.jointVentureName || bid.tenNhaThau
        : bid.tenNhaThau,
      thanhVienLienDanh: (Array.isArray(bid.thanhVienLienDanh)
        ? bid.thanhVienLienDanh
        : []).map((member, index) => ({
        ...member,
        thanhVienNhaThauId: memberIds[index] || member.thanhVienNhaThauId,
      })),
    };
  });
}

function parsePackageLots(pkg) {
  const value = pkg?.phanLoList;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function deriveRejectionReason(pkg, bid, isWinner) {
  if (isWinner) return "—";
  if (isLowPriceBidRejected(pkg, bid)) return getLowPriceRejectionReason(pkg, bid);
  if (bid?.lyDoTruot) return bid.lyDoTruot;
  if (pkg?.quyTrinhDanhGia === "quytrinh2" && bid?.danhGiaKetLuan === "Không đánh giá") {
    return "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";
  }
  const conclusion = String(bid?.danhGiaKetLuan || "");
  if (conclusion === "Không đạt" || conclusion.startsWith("Không đạt")) {
    const failedSteps = [];
    if (bid.danhGiaHopLe === "Không đạt") failedSteps.push("Đánh giá hợp lệ");
    if (bid.danhGiaNangLuc === "Không đạt") failedSteps.push("Đánh giá năng lực");
    if (
      bid.danhGiaKyThuat === "Không đạt"
      || String(bid.danhGiaKyThuat || "").toLocaleLowerCase("vi-VN").includes("không đạt")
    ) failedSteps.push("Đánh giá kỹ thuật");
    if (
      bid.danhGiaTaiChinh === "Không đạt"
      || String(bid.danhGiaTaiChinh || "").toLocaleLowerCase("vi-VN").includes("không đạt")
    ) failedSteps.push("Đánh giá tài chính");
    return failedSteps.length > 0
      ? `Không đạt ở bước: ${failedSteps.join(", ")}`
      : "Không đạt đánh giá chi tiết";
  }
  return "Nhà thầu xếp hạng 1 trúng thầu";
}

function buildAwardSummary(pkg, boundBids, qualifiedBids) {
  const isLotPackage = pkg?.phanLo === "Có";
  const lots = isLotPackage ? parsePackageLots(pkg) : [];
  const winningLots = lots.filter((lot) => lot?.nhaThauTrungThauId);
  const uniqueWinnerIds = [
    ...new Set(
      winningLots
        .map((lot) => String(lot.nhaThauTrungThauId || ""))
        .filter(Boolean),
    ),
  ];
  const inferredPackageWinnerId = !pkg?.nhaThauTrungThauId && qualifiedBids.length === 1
    ? qualifiedBids[0].nhaThauId || qualifiedBids[0].id
    : "";
  const effectivePackageWinnerId = pkg?.nhaThauTrungThauId || inferredPackageWinnerId;
  const winnerBid = qualifiedBids.find(
    (bid) => String(bid.nhaThauId || "") === String(effectivePackageWinnerId || ""),
  ) || qualifiedBids[0] || null;
  const finalWinnerId = uniqueWinnerIds.length === 1
    ? uniqueWinnerIds[0]
    : effectivePackageWinnerId || winnerBid?.nhaThauId || winnerBid?.id || "";
  const currentWinnerBid = qualifiedBids.find(
    (bid) => String(bid.nhaThauId || "") === String(finalWinnerId || ""),
  ) || winnerBid;
  const sortedBids = [...boundBids].sort((left, right) => {
    const leftCode = String(left?.maPhanLo || "").toLocaleLowerCase("vi-VN");
    const rightCode = String(right?.maPhanLo || "").toLocaleLowerCase("vi-VN");
    return leftCode.localeCompare(rightCode, "vi", { numeric: true });
  });
  const bidderRows = sortedBids.map((bid, index) => {
    let isWinner = false;
    let awardPrice = null;
    let packageDuration = bid.thoiGianThucHien || bid.thoiGianGoiThau || "—";
    if (isLotPackage) {
      const matchedLot = lots.find((lot) => (
        String(lot?.maPhanLo || "") === String(bid?.maPhanLo || "")
        && String(lot?.nhaThauTrungThauId || "") === String(bid?.nhaThauId || "")
      ));
      if (matchedLot) {
        isWinner = true;
        awardPrice = matchedLot.giaTrungThau || 0;
        packageDuration = matchedLot.thoiGianGoiThau || "—";
      }
    } else if (
      effectivePackageWinnerId
      && String(effectivePackageWinnerId) === String(bid?.nhaThauId || "")
    ) {
      isWinner = true;
      awardPrice = pkg?.giaTrungThau || 0;
      packageDuration = pkg?.thoiGianGoiThau || "—";
    }
    return {
      bid,
      index,
      isWinner,
      awardPrice,
      packageDuration,
      rejectionReason: deriveRejectionReason(pkg, bid, isWinner),
    };
  });
  return {
    isLotPackage,
    lots,
    winningLots,
    uniqueWinnerIds,
    hasMultipleWinners: uniqueWinnerIds.length > 1,
    inferredPackageWinnerId,
    effectivePackageWinnerId,
    winnerBid,
    finalWinnerId,
    currentWinnerBid,
    bidderRows,
  };
}

export function buildAwardResultViewModel({
  pkg,
  bids = [],
  isEditable = false,
  editState = {},
} = {}) {
  const metadata = parseResultMetadata(pkg?.danhGiaHsdtMetadata);
  const isTwoEnvelope = pkg?.phuongThucLuaChon === TWO_ENVELOPE_METHOD;
  const lifecycleMetadata = isTwoEnvelope ? metadata.technical : metadata;
  const officialLotState = getOfficialEvaluationLotState(pkg, lifecycleMetadata);
  const effectiveEditState = resolveEffectiveEditState(
    pkg,
    metadata,
    isEditable,
    editState,
  );
  const isAwarded = resolvePackageResultStatus(pkg) === AWARDED_STATUS;
  const editingOfficialBatchId = isEditable
    ? effectiveEditState.officialBatchId
    : "";
  const editingOfficialBatch = officialLotState.history.find(
    (batch) => String(batch.batchId || "") === editingOfficialBatchId,
  ) || null;
  const editingOfficialScope = editingOfficialBatch
    ? {
      batchId: editingOfficialBatch.batchId,
      lotIds: editingOfficialBatch.lotIds || [],
      lotCodes: editingOfficialBatch.lotCodes || [],
      isWholePackage: editingOfficialBatch.isWholePackage === true,
      batch: editingOfficialBatch,
    }
    : null;
  const isEditingOfficialResult = Boolean(editingOfficialScope);
  const isEditingWholePackageResult = Boolean(
    isEditable
    && effectiveEditState.wholePackage
    && (
      !effectiveEditState.wholePackageId
      || effectiveEditState.wholePackageId === String(pkg?.id || "")
    )
  );
  const activeScopedEvaluation = editingOfficialScope || (!isAwarded
    ? resolveActiveSavedEvaluationScope(
      pkg,
      lifecycleMetadata,
      effectiveEditState.currentBatchId,
    ) || resolveActiveSavedEvaluationScope(pkg, lifecycleMetadata)
    : null);
  if (activeScopedEvaluation) {
    effectiveEditState.currentBatchId = activeScopedEvaluation.batchId;
  }

  const resultMetadata = activeScopedEvaluation
    ? activeScopedEvaluation.batch?.result || {}
    : metadata.result;
  const packageBidsForResult = (Array.isArray(bids) ? bids : []).filter(
    (bid) => String(bid?.goiThauId || "") === String(pkg?.id || ""),
  );
  const boundPackageBidsForResult = bindFrozenContractorVersions(
    packageBidsForResult,
    resultMetadata,
  );
  const scopedBidsForResult = activeScopedEvaluation
    ? packageBidsForResult.filter(
      (bid) => isBidWithinEvaluationLotDetails(bid, activeScopedEvaluation),
    )
    : packageBidsForResult;
  const allBidsForResult = bindFrozenContractorVersions(
    scopedBidsForResult.filter((bid) => checkBidQualified(bid, pkg)),
    resultMetadata,
  );
  const summary = buildAwardSummary(
    pkg,
    boundPackageBidsForResult,
    allBidsForResult,
  );

  let mode = "approval";
  if (!isAwarded && !activeScopedEvaluation && officialLotState.history.length > 0) {
    mode = "history";
  } else if (isAwarded && !isEditingOfficialResult && !isEditingWholePackageResult) {
    mode = "summary";
  }

  return {
    mode,
    metadata,
    isTwoEnvelope,
    isAwarded,
    lifecycleMetadata,
    officialLotState,
    effectiveEditState,
    editingOfficialScope,
    isEditingOfficialResult,
    isEditingWholePackageResult,
    activeScopedEvaluation,
    resultMetadata,
    soBctdResult: resultMetadata.soBctdKetQua || "",
    ngayBctdResult: resultMetadata.ngayBctdKetQua || "",
    packageBidsForResult,
    boundPackageBidsForResult,
    scopedBidsForResult,
    allBidsForResult,
    summary,
  };
}
