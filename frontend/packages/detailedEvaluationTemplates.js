import { parseEvaluationMetadataForDisplay } from "./evaluationMetadata.js";

const COMMON_CRITERIA = Object.freeze({
  validity: Object.freeze({
    code: "VALIDITY_SUMMARY",
    name: "Kết quả đánh giá tổng hợp về tính hợp lệ",
    group: "validity",
    resultType: "pass_fail",
    required: true,
  }),
  capacity: Object.freeze({
    code: "CAPACITY_SUMMARY",
    name: "Kết quả đánh giá tổng hợp về năng lực và kinh nghiệm",
    group: "capacity",
    resultType: "pass_fail",
    required: true,
  }),
  technical: Object.freeze({
    code: "TECHNICAL_SUMMARY",
    name: "Kết quả đánh giá tổng hợp về kỹ thuật",
    group: "technical",
    resultType: "pass_fail",
    required: true,
  }),
  financial: Object.freeze({
    code: "FINANCIAL_SUMMARY",
    name: "Kết quả đánh giá tổng hợp về tài chính",
    group: "financial",
    resultType: "pass_fail",
    required: true,
  }),
});

const NON_CONSULTING_VALIDITY = Object.freeze([
  ["VALIDITY_SUMMARY", "Bảo đảm dự thầu"],
  ["JV_AGREEMENT", "Thỏa thuận liên danh (đối với nhà thầu liên danh)"],
  ["LEGAL_STATUS", "Tư cách hợp lệ của nhà thầu"],
  ["INDEPENDENT_ACCOUNTING", "Hạch toán tài chính độc lập"],
  ["COMPETITION", "Bảo đảm cạnh tranh trong đấu thầu"],
  ["TAX_COMPLIANCE", "Đã thực hiện nghĩa vụ kê khai thuế, nộp thuế"],
  ["NO_BID_BAN", "Không đang trong thời gian bị cấm tham dự thầu"],
  ["NO_CRIMINAL_PROSECUTION", "Không đang bị truy cứu trách nhiệm hình sự"],
  ["SYSTEM_STATUS", "Không bị tạm ngừng hoặc chấm dứt tham gia Hệ thống"],
  ["NO_TENDER_CONVICTION", "Không có nhân sự bị kết án về hành vi vi phạm đấu thầu"],
]);

const CONSULTING_VALIDITY = Object.freeze([
  ["VALIDITY_SUMMARY", "Thỏa thuận liên danh và tính hợp lệ của E-HSĐXKT"],
  ["LEGAL_STATUS", "Tư cách hợp lệ theo Điều 5 Luật Đấu thầu"],
  ["INDEPENDENT_ACCOUNTING", "Hạch toán tài chính độc lập"],
  ["COMPETITION", "Bảo đảm cạnh tranh trong đấu thầu"],
  ["TAX_COMPLIANCE", "Đã thực hiện nghĩa vụ kê khai thuế, nộp thuế"],
  ["NO_BID_BAN", "Không đang trong thời gian bị cấm tham dự thầu"],
  ["NO_CRIMINAL_PROSECUTION", "Không đang bị truy cứu trách nhiệm hình sự"],
  ["PROFESSIONAL_CERTIFICATE", "Có chứng chỉ chuyên môn phù hợp (nếu pháp luật yêu cầu)"],
  ["SYSTEM_STATUS", "Không bị tạm ngừng hoặc chấm dứt tham gia Hệ thống"],
]);

const CAPACITY_CRITERIA = Object.freeze([
  ["CAPACITY_SUMMARY", "Lịch sử, năng lực tài chính và kinh nghiệm"],
  ["FINANCIAL_STATEMENTS", "Kết quả hoạt động tài chính"],
  ["ANNUAL_REVENUE", "Doanh thu bình quân hằng năm"],
  ["SIMILAR_CONTRACTS", "Hợp đồng tương tự"],
  ["PRODUCTION_CAPACITY", "Năng lực sản xuất hoặc cung cấp"],
  ["KEY_PERSONNEL", "Nhân sự chủ chốt"],
  ["KEY_EQUIPMENT", "Thiết bị thi công hoặc thiết bị chủ yếu"],
  ["WARRANTY_SERVICE", "Khả năng bảo hành, bảo trì và dịch vụ sau bán hàng"],
]);

const NON_CONSULTING_TECHNICAL = Object.freeze([
  ["TECHNICAL_SUMMARY", "Đáp ứng các yêu cầu kỹ thuật trong E-HSMT"],
  ["TECHNICAL_METHOD", "Giải pháp và phương pháp tổ chức thực hiện"],
  ["SCHEDULE", "Tiến độ thực hiện"],
]);

const NON_CONSULTING_FINANCIAL = Object.freeze([
  ["FINANCIAL_SUMMARY", "Giá dự thầu và kết quả đánh giá tài chính"],
  ["DISCREPANCY_ADJUSTMENT", "Hiệu chỉnh sai lệch và sai lệch thừa (nếu có)"],
  ["PREFERENCE", "Giá trị ưu đãi (nếu có)"],
  ["EVALUATED_PRICE", "Giá đánh giá hoặc giá sau ưu đãi"],
  ["FINANCIAL_RANKING", "Xếp hạng về tài chính"],
]);

const CONSULTING_TECHNICAL = Object.freeze([
  ["TECHNICAL_SUMMARY", "Phương pháp luận và cách tiếp cận"],
  ["WORK_PLAN", "Kế hoạch và tổ chức thực hiện"],
  ["CONSULTING_PERSONNEL", "Nhân sự thực hiện gói thầu"],
  ["CONSULTING_EXPERIENCE", "Kinh nghiệm chuyên môn và hợp đồng tương tự"],
  ["CONSULTING_SCHEDULE", "Tiến độ thực hiện dịch vụ tư vấn"],
]);

const CONSULTING_FINANCIAL = Object.freeze([
  ["FINANCIAL_SUMMARY", "Giá dự thầu và kết quả đánh giá tài chính"],
  ["DISCREPANCY_ADJUSTMENT", "Hiệu chỉnh sai lệch (nếu có)"],
  ["DISCOUNT", "Giá trị giảm giá (nếu có)"],
  ["PRICE_SCORE", "Điểm giá hoặc điểm tài chính"],
  ["COMBINED_SCORE", "Điểm tổng hợp kỹ thuật và giá"],
]);

function definitionsToCriteria(definitions, group, { score = false } = {}) {
  return definitions.map(([code, name]) => ({
    code,
    name,
    group,
    resultType: score ? "score" : "pass_fail",
    required: true,
    ...(score ? { maxScore: null } : {}),
  }));
}

const NON_CONSULTING_CRITERIA = Object.freeze({
  validity: definitionsToCriteria(NON_CONSULTING_VALIDITY, "validity"),
  capacity: definitionsToCriteria(CAPACITY_CRITERIA, "capacity"),
  technical: definitionsToCriteria(NON_CONSULTING_TECHNICAL, "technical"),
  financial: definitionsToCriteria(NON_CONSULTING_FINANCIAL, "financial"),
});

const CONSULTING_CRITERIA = Object.freeze({
  validity: definitionsToCriteria(CONSULTING_VALIDITY, "validity"),
  technical: definitionsToCriteria(CONSULTING_TECHNICAL, "technical", { score: true }),
  financial: definitionsToCriteria(CONSULTING_FINANCIAL, "financial"),
});

// Các mẫu bám theo 4 biểu mẫu BCĐG chi tiết được cung cấp:
// 14A: Hàng hóa/Xây lắp/Hỗn hợp/Phi tư vấn, 1G1T, quy trình 1;
// 14B: Hàng hóa/Xây lắp/Hỗn hợp/Phi tư vấn, 1G1T, quy trình 2;
// 14C: Hàng hóa/Xây lắp/Hỗn hợp/Phi tư vấn, 1G2T; 14D: gói thầu tư vấn.
export const DETAILED_EVALUATION_TEMPLATES = Object.freeze({
  nonConsultingProcess1: Object.freeze({
    id: "bc-dgct-14a",
    version: 1,
    source: "14A",
    groups: Object.freeze(["validity", "capacity", "technical", "financial"]),
    criteria: NON_CONSULTING_CRITERIA,
  }),
  nonConsultingProcess2: Object.freeze({
    id: "bc-dgct-14b",
    version: 1,
    source: "14B",
    groups: Object.freeze(["validity", "capacity", "technical"]),
    criteria: NON_CONSULTING_CRITERIA,
  }),
  oneStageTwoEnvelope: Object.freeze({
    id: "bc-dgct-14c",
    version: 1,
    source: "14C",
    groups: Object.freeze(["validity", "capacity", "technical", "financial"]),
    criteria: NON_CONSULTING_CRITERIA,
  }),
  consulting: Object.freeze({
    id: "bc-dgct-14d",
    version: 1,
    source: "14D",
    groups: Object.freeze(["validity", "technical", "financial"]),
    scoreGroups: Object.freeze(["technical"]),
    criteria: CONSULTING_CRITERIA,
  }),
});

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .trim();
}

function packageField(pkg, names) {
  for (const name of names) {
    if (pkg?.[name] !== undefined && pkg?.[name] !== null && String(pkg[name]).trim()) {
      return pkg[name];
    }
  }
  return "";
}

function packageMetadata(pkg) {
  return parseEvaluationMetadataForDisplay(pkg?.danhGiaHsdtMetadata).metadata;
}

export function resolveDetailedEvaluationTemplate(pkg = {}) {
  const metadata = packageMetadata(pkg);
  const field = normalize(packageField(pkg, ["linhVuc", "loaiGoiThau", "loaiGoi", "category"])
    || packageField(metadata, ["linhVuc", "loaiGoiThau", "loaiGoi", "category"]));
  if (field === "tu van" || field.startsWith("tu van ")) {
    return DETAILED_EVALUATION_TEMPLATES.consulting;
  }
  const method = normalize(pkg.phuongThucLuaChon || metadata.phuongThucLuaChon);
  if (method.includes("hai tui")) {
    return DETAILED_EVALUATION_TEMPLATES.oneStageTwoEnvelope;
  }
  const procedure = normalize(packageField(pkg, ["quyTrinhDanhGia", "quyTrinh", "evaluationProcedure"])
    || packageField(metadata, ["quyTrinhDanhGia", "quyTrinh", "evaluationProcedure"]));
  if (procedure === "quytrinh2" || procedure.includes("quy trinh 2") || procedure === "2") {
    return DETAILED_EVALUATION_TEMPLATES.nonConsultingProcess2;
  }
  return DETAILED_EVALUATION_TEMPLATES.nonConsultingProcess1;
}

export function createDefaultDetailedEvaluationCriteria(roundType = "single", {
  roundId = `evaluation-round:pending:${roundType}`,
  pkg = {},
  templateId = "",
} = {}) {
  const template = templateId
    ? Object.values(DETAILED_EVALUATION_TEMPLATES).find((item) => item.id === templateId)
      || resolveDetailedEvaluationTemplate(pkg)
    : resolveDetailedEvaluationTemplate(pkg);
  const allowedGroups = roundType === "technical"
    ? new Set(["validity", "capacity", "technical"])
    : roundType === "financial"
      ? new Set(["financial"])
      : new Set(template.groups);
  // Không có package là API tương thích cũ: chỉ trả bốn dòng tổng hợp.
  // Khi mở một gói thầu thật, dùng các dòng tiêu chí tương ứng biểu mẫu 14A-14D.
  const criteriaByGroup = pkg && Object.keys(pkg).length > 0
    ? template.criteria
    : Object.fromEntries(Object.entries(COMMON_CRITERIA).map(([group, criterion]) => [group, [criterion]]));
  return template.groups
    .flatMap((group) => criteriaByGroup?.[group] || [COMMON_CRITERIA[group]])
    .filter(Boolean)
    .filter((criterion) => !allowedGroups || allowedGroups.has(criterion.group))
    .map((criterion, index) => ({
    id: `evaluation-criterion:${roundId}:${criterion.code}`,
    ...criterion,
    maxScore: criterion.maxScore ?? null,
    weight: null,
    order: index,
    templateId: template.id,
    templateVersion: template.version,
    }));
}
