export const WORD_PUBLICATION_SELECTION_METHOD = Object.freeze({
  ONE_STAGE_ONE_ENVELOPE: "Một giai đoạn một túi hồ sơ",
  ONE_STAGE_TWO_ENVELOPE: "Một giai đoạn hai túi hồ sơ",
});

export const WORD_PUBLICATION_PROCUREMENT_FORM = Object.freeze({
  DIRECT_APPOINTMENT_SHORTENED: "Chỉ định thầu rút gọn",
  SPECIAL_SELECTION: "Lựa chọn nhà thầu trong trường hợp đặc biệt",
});

const APPLICABILITY = Object.freeze({
  ALL_PACKAGES: "all-packages",
  STANDARD_BASE: "standard-base",
  ONE_ENVELOPE: "one-envelope",
  TWO_ENVELOPE: "two-envelope",
  NORMAL_PROCUREMENT: "normal-procurement",
  DIRECT_OR_SPECIAL: "direct-or-special",
});

const planExport = Object.freeze({ scope: "plan", reportType: "plan" });
const evaluationExport = Object.freeze({ scope: "package", reportType: "evaluation" });
const resultExport = Object.freeze({ scope: "package", reportType: "result" });

function definition(value) {
  return Object.freeze(value);
}

export const WORD_PUBLICATION_DOCUMENTS = Object.freeze([
  definition({
    id: "procurement_plan",
    label: "Kế hoạch lựa chọn nhà thầu",
    description: "Xuất dữ liệu Kế hoạch LCNT đang chọn.",
    icon: "clipboard-list",
    applicability: APPLICABILITY.ALL_PACKAGES,
    exportTarget: planExport,
    legacyActiveFallback: true,
  }),
  definition({
    id: "consultant_evaluation_step_1",
    label: "Tư vấn lập, đánh giá Bước 1",
    description: "Định danh riêng cho hồ sơ tư vấn lập và đánh giá Bước 1.",
    icon: "file-search",
    applicability: APPLICABILITY.STANDARD_BASE,
    exportTarget: evaluationExport,
  }),
  definition({
    id: "consultant_evaluation_step_2",
    label: "Tư vấn lập, đánh giá Bước 2",
    description: "Định danh riêng cho hồ sơ tư vấn lập và đánh giá Bước 2.",
    icon: "file-search-2",
    applicability: APPLICABILITY.STANDARD_BASE,
    exportTarget: evaluationExport,
  }),
  definition({
    id: "consultant_appraisal_step_1",
    label: "Tư vấn thẩm định Bước 1",
    description: "Định danh riêng cho hồ sơ tư vấn thẩm định Bước 1.",
    icon: "file-check-2",
    applicability: APPLICABILITY.STANDARD_BASE,
    exportTarget: evaluationExport,
  }),
  definition({
    id: "consultant_appraisal_step_2",
    label: "Tư vấn thẩm định Bước 2",
    description: "Định danh riêng cho hồ sơ tư vấn thẩm định Bước 2.",
    icon: "files",
    applicability: APPLICABILITY.STANDARD_BASE,
    exportTarget: evaluationExport,
  }),
  definition({
    id: "bid_evaluation_report",
    label: "Báo cáo đánh giá E-HSDT",
    description: "Báo cáo đánh giá E-HSDT dành cho phương thức 1G1T.",
    icon: "file-chart-column-increasing",
    applicability: APPLICABILITY.ONE_ENVELOPE,
    exportTarget: evaluationExport,
    legacyActiveFallback: true,
  }),
  definition({
    id: "technical_bid_evaluation_report_01",
    label: "Báo cáo đánh giá E-HSĐXKT",
    description: "Báo cáo đánh giá E-HSĐXKT dành cho phương thức 1G2T.",
    icon: "file-chart-column",
    applicability: APPLICABILITY.TWO_ENVELOPE,
    exportTarget: evaluationExport,
  }),
  definition({
    id: "technical_bid_evaluation_report_02",
    label: "Quyết định phê duyệt nhà thầu đạt kỹ thuật",
    description: "Quyết định phê duyệt nhà thầu đạt kỹ thuật dành cho phương thức 1G2T.",
    icon: "file-chart-column",
    applicability: APPLICABILITY.TWO_ENVELOPE,
    exportTarget: evaluationExport,
  }),
  definition({
    id: "technical_bid_evaluation_report_03",
    label: "Báo cáo đánh giá E-HSĐXTC",
    description: "Báo cáo đánh giá E-HSĐXTC dành cho phương thức 1G2T.",
    icon: "file-chart-column",
    applicability: APPLICABILITY.TWO_ENVELOPE,
    exportTarget: evaluationExport,
  }),
  definition({
    id: "award_result_appraisal_report",
    label: "Báo cáo thẩm định, KQLCNT",
    description: "Áp dụng cho gói thầu không thuộc hình thức rút gọn hoặc đặc biệt.",
    icon: "file-badge",
    applicability: APPLICABILITY.NORMAL_PROCUREMENT,
    exportTarget: evaluationExport,
  }),
  definition({
    id: "contractor_selection_result",
    label: "Kết quả lựa chọn nhà thầu",
    description: "Áp dụng cho chỉ định thầu rút gọn hoặc lựa chọn đặc biệt.",
    icon: "badge-check",
    applicability: APPLICABILITY.DIRECT_OR_SPECIAL,
    exportTarget: resultExport,
    legacyActiveFallback: true,
  }),
]);

function canonicalValue(value) {
  return String(value || "").trim();
}

export function isDirectOrSpecialWordPublicationPackage(packageRecord) {
  const procurementForm = canonicalValue(packageRecord?.hinhThucLuaChon);
  return procurementForm === WORD_PUBLICATION_PROCUREMENT_FORM.DIRECT_APPOINTMENT_SHORTENED
    || procurementForm === WORD_PUBLICATION_PROCUREMENT_FORM.SPECIAL_SELECTION;
}

export function getAvailableWordPublicationTypes({ packageRecord } = {}) {
  if (!packageRecord) return [];
  const selectionMethod = canonicalValue(packageRecord.phuongThucLuaChon);
  const directOrSpecial = isDirectOrSpecialWordPublicationPackage(packageRecord);
  return WORD_PUBLICATION_DOCUMENTS.filter((documentType) => {
    switch (documentType.applicability) {
      case APPLICABILITY.ALL_PACKAGES:
        return true;
      case APPLICABILITY.STANDARD_BASE:
        return !directOrSpecial;
      case APPLICABILITY.ONE_ENVELOPE:
        return !directOrSpecial
          && selectionMethod === WORD_PUBLICATION_SELECTION_METHOD.ONE_STAGE_ONE_ENVELOPE;
      case APPLICABILITY.TWO_ENVELOPE:
        return !directOrSpecial
          && selectionMethod === WORD_PUBLICATION_SELECTION_METHOD.ONE_STAGE_TWO_ENVELOPE;
      case APPLICABILITY.NORMAL_PROCUREMENT:
        return !directOrSpecial;
      case APPLICABILITY.DIRECT_OR_SPECIAL:
        return directOrSpecial;
      default:
        return false;
    }
  });
}
