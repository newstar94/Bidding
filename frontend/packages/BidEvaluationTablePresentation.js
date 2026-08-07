import { getEvaluationLotScopeDetails } from "./lotEvaluationScope.js";
import { isCombinedTechnicalPriceMethod } from "./technicalEvaluationMethod.js";

function cell(label, className) {
  return `<th class="${className}">${label}</th>`;
}

function buildHeader(caseType, {
  isConsulting,
  isCombinedMethod,
  showCombinedScore,
}) {
  const combinedScore = showCombinedScore
    ? [cell("Điểm tổng hợp", "bf-s-415b5d64b8")]
    : [];
  const technicalAndCombinedScore = showCombinedScore
    ? [
      cell("Đánh giá KT", "bf-s-415b5d64b8"),
      cell("Điểm tổng hợp", "bf-s-415b5d64b8"),
    ]
    : [];
  const headers = {
    TU_VAN: [
      cell("Loại nhà thầu", "bf-s-8523765ec6"),
      cell("Mã nhà thầu", "bf-s-ae54075f01"),
      cell("Tên nhà thầu", "bf-s-c83ebbe56b"),
      cell("Hiệu lực E-HSĐXKT", "bf-s-ae54075f01"),
      cell("Thời gian thực hiện", "bf-s-ae54075f01"),
      cell("Đánh giá hợp lệ", "bf-s-8523765ec6"),
      cell("Làm rõ tính hợp lệ", "bf-s-8523765ec6"),
      cell("Đánh giá năng lực", "bf-s-8523765ec6"),
      cell("Làm rõ năng lực kinh nghiệm", "bf-s-8523765ec6"),
      cell("Đánh giá kỹ thuật", "bf-s-8523765ec6"),
      cell("Làm rõ kỹ thuật", "bf-s-8523765ec6"),
      ...combinedScore,
      cell("Kết luận", "bf-s-8523765ec6"),
    ],
    "1G2T_NO_LOT": [
      cell("Loại nhà thầu", "bf-s-8523765ec6"),
      cell("Mã nhà thầu", "bf-s-8523765ec6"),
      cell("Tên nhà thầu", "bf-s-2811ee8f01"),
      cell("Đảm bảo dự thầu", "bf-s-8523765ec6"),
      cell("Hiệu lực đảm bảo", "bf-s-8523765ec6"),
      cell("Hiệu lực E-HSĐXKT", "bf-s-8523765ec6"),
      cell("Đánh giá hợp lệ", "bf-s-8523765ec6"),
      cell("Làm rõ tính hợp lệ", "bf-s-8523765ec6"),
      cell("Đánh giá năng lực", "bf-s-8523765ec6"),
      cell("Làm rõ năng lực kinh nghiệm", "bf-s-8523765ec6"),
      cell("Đánh giá kỹ thuật", "bf-s-8523765ec6"),
      cell("Làm rõ kỹ thuật", "bf-s-8523765ec6"),
      cell("Kết luận", "bf-s-8523765ec6"),
    ],
    "1G2T_WITH_LOT": [
      cell("Mã phần lô", "bf-s-aed34ad439"),
      cell("Tên phần lô", "bf-s-aed34ad439"),
      cell("Loại nhà thầu", "bf-s-415b5d64b8"),
      cell("Mã nhà thầu", "bf-s-415b5d64b8"),
      cell("Tên nhà thầu", "bf-s-ae54075f01"),
      cell("Đảm bảo dự thầu", "bf-s-b258c3e162"),
      cell("Hiệu lực đảm bảo", "bf-s-b258c3e162"),
      cell("Hiệu lực E-HSĐXKT", "bf-s-b258c3e162"),
      cell("Đánh giá hợp lệ", "bf-s-b258c3e162"),
      cell("Làm rõ hợp lệ", "bf-s-b258c3e162"),
      cell("Đánh giá năng lực", "bf-s-b258c3e162"),
      cell("Làm rõ năng lực", "bf-s-b258c3e162"),
      cell("Đánh giá kỹ thuật", "bf-s-b258c3e162"),
      cell("Làm rõ kỹ thuật", "bf-s-b258c3e162"),
      cell("Kết luận", "bf-s-8523765ec6"),
    ],
    "1G2T_TC_NO_LOT": [
      cell("Loại nhà thầu", "bf-s-8523765ec6"),
      cell("Mã nhà thầu", "bf-s-8523765ec6"),
      cell("Tên nhà thầu", "bf-s-2811ee8f01"),
      cell("Giá dự thầu", "bf-s-ae54075f01"),
      cell("Tỷ lệ %", "bf-s-415b5d64b8"),
      cell("Giá sau giảm", "bf-s-ae54075f01"),
      cell("Giá xếp hạng", "bf-s-ae54075f01"),
      cell("Giá đề nghị trúng thầu", "bf-s-ae54075f01"),
      ...(isConsulting ? [cell("Hiệu lực E-HSĐXTC", "bf-s-ae54075f01")] : []),
      cell("Làm rõ tài chính", "bf-s-8523765ec6"),
      ...technicalAndCombinedScore,
      cell("Xếp hạng", "bf-s-415b5d64b8"),
    ],
    "1G2T_TC_WITH_LOT": [
      cell("Mã phần lô", "bf-s-415b5d64b8"),
      cell("Tên phần lô", "bf-s-415b5d64b8"),
      cell("Loại nhà thầu", "bf-s-415b5d64b8"),
      cell("Mã nhà thầu", "bf-s-415b5d64b8"),
      cell("Tên nhà thầu", "bf-s-ae54075f01"),
      cell("Giá dự thầu", "bf-s-3faf34a5d2"),
      cell("Tỷ lệ %", "bf-s-aed34ad439"),
      cell("Giá sau giảm", "bf-s-3faf34a5d2"),
      cell("Giá xếp hạng", "bf-s-ae54075f01"),
      cell("Giá đề nghị trúng thầu", "bf-s-ae54075f01"),
      ...(isConsulting ? [cell("Hiệu lực E-HSĐXTC", "bf-s-8523765ec6")] : []),
      cell("Làm rõ tài chính", "bf-s-8523765ec6"),
      ...technicalAndCombinedScore,
      cell("Xếp hạng", "bf-s-415b5d64b8"),
    ],
    "1G1T_NO_LOT": [
      cell("Loại nhà thầu", "bf-s-aed34ad439"),
      cell("Mã nhà thầu", "bf-s-aed34ad439"),
      cell("Tên nhà thầu", "bf-s-ae54075f01"),
      cell("Giá dự thầu", "bf-s-8523765ec6"),
      cell("Tỷ lệ %", "bf-s-6a7768ee0d"),
      cell("Giá sau giảm", "bf-s-8523765ec6"),
      cell("Giá xếp hạng", "bf-s-ae54075f01"),
      cell("Giá đề nghị trúng thầu", "bf-s-ae54075f01"),
      cell("Hiệu lực E-HSDT", "bf-s-415b5d64b8"),
      cell("Giá trị ĐB", "bf-s-415b5d64b8"),
      cell("Hiệu lực ĐB", "bf-s-415b5d64b8"),
      cell("Thời gian TH", "bf-s-415b5d64b8"),
      cell("Đánh giá hợp lệ", "bf-s-415b5d64b8"),
      cell("Làm rõ hợp lệ", "bf-s-415b5d64b8"),
      cell("Đánh giá năng lực", "bf-s-415b5d64b8"),
      cell("Làm rõ năng lực", "bf-s-415b5d64b8"),
      cell("Đánh giá kỹ thuật", "bf-s-415b5d64b8"),
      cell("Làm rõ kỹ thuật", "bf-s-415b5d64b8"),
      cell("Làm rõ tài chính", "bf-s-415b5d64b8"),
      ...(isCombinedMethod ? [cell("Điểm tổng hợp", "bf-s-415b5d64b8")] : []),
      cell("Kết luận", "bf-s-8523765ec6"),
      cell("Xếp hạng", "bf-s-415b5d64b8"),
    ],
    "1G1T_WITH_LOT": [
      cell("Mã phần lô", "bf-s-aed34ad439"),
      cell("Tên phần lô", "bf-s-aed34ad439"),
      cell("Loại nhà thầu", "bf-s-6a7768ee0d"),
      cell("Mã nhà thầu", "bf-s-415b5d64b8"),
      cell("Tên nhà thầu", "bf-s-8523765ec6"),
      cell("Giá dự thầu", "bf-s-b258c3e162"),
      cell("Tỷ lệ %", "bf-s-6a7768ee0d"),
      cell("Giá sau giảm", "bf-s-b258c3e162"),
      cell("Giá xếp hạng", "bf-s-ae54075f01"),
      cell("Giá đề nghị trúng thầu", "bf-s-ae54075f01"),
      cell("Hiệu lực E-HSDT", "bf-s-aed34ad439"),
      cell("Giá trị ĐB", "bf-s-aed34ad439"),
      cell("Hiệu lực ĐB", "bf-s-aed34ad439"),
      cell("Thời gian TH", "bf-s-aed34ad439"),
      cell("Đánh giá hợp lệ", "bf-s-aed34ad439"),
      cell("Làm rõ hợp lệ", "bf-s-aed34ad439"),
      cell("Đánh giá năng lực", "bf-s-aed34ad439"),
      cell("Làm rõ năng lực", "bf-s-aed34ad439"),
      cell("Đánh giá kỹ thuật", "bf-s-aed34ad439"),
      cell("Làm rõ kỹ thuật", "bf-s-aed34ad439"),
      cell("Làm rõ tài chính", "bf-s-aed34ad439"),
      ...(isCombinedMethod ? [cell("Điểm tổng hợp", "bf-s-415b5d64b8")] : []),
      cell("Kết luận", "bf-s-8523765ec6"),
      cell("Xếp hạng", "bf-s-415b5d64b8"),
    ],
  };
  return `<tr>${(headers[caseType] || []).join("")}</tr>`;
}

export function buildBidEvaluationTablePresentation({
  pkg,
  isTwoEnvelope = false,
  currentTab = "unified",
  lotScope = null,
} = {}) {
  if (!pkg) throw new TypeError("Bid evaluation table presentation requires a package.");
  const isConsulting = pkg.linhVuc === "Tư vấn";
  const hasLots = pkg.phanLo === "Có";
  let caseType = "1G1T_NO_LOT";
  if (isTwoEnvelope) {
    if (currentTab === "technical") {
      caseType = isConsulting
        ? "TU_VAN"
        : hasLots
          ? "1G2T_WITH_LOT"
          : "1G2T_NO_LOT";
    } else {
      caseType = hasLots ? "1G2T_TC_WITH_LOT" : "1G2T_TC_NO_LOT";
    }
  } else if (isConsulting) {
    caseType = "TU_VAN";
  } else if (hasLots) {
    caseType = "1G1T_WITH_LOT";
  }
  const isCombinedMethod = isCombinedTechnicalPriceMethod(pkg);
  const showCombinedScore = isCombinedMethod
    && !(isTwoEnvelope && currentTab === "technical");
  const lotLabel = getEvaluationLotScopeDetails(pkg, lotScope)?.lotCodes?.join(", ");
  let baseTitle = "Đánh giá E-HSDT";
  if (isTwoEnvelope || isConsulting) {
    baseTitle = currentTab === "technical"
      ? "Đánh giá E-HSĐXKT"
      : "Đánh giá E-HSĐXTC";
  }
  return {
    caseType,
    isTwoEnvelope,
    currentTab,
    isConsulting,
    hasLots,
    isCombinedMethod,
    showCombinedScore,
    title: lotLabel ? `${baseTitle} — ${lotLabel}` : baseTitle,
    headerHtml: buildHeader(caseType, {
      isConsulting,
      isCombinedMethod,
      showCombinedScore,
    }),
  };
}
