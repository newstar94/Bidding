import { normalizeEvaluationMethod, EVALUATION_METHOD_CODES } from "./evaluationMethodRules.js";
import { parseEvaluationMetadataForDisplay } from "./evaluationMetadata.js";

export const MEDICINE_TEMPLATE_ID = "bc-dgct-thuoc-v1";

export function isMedicineEvaluationPackage(pkg = {}) {
  return [1, "1", true].includes(pkg.isThuoc)
    || [1, "1", true].includes(pkg.is_thuoc)
    || [1, "1", true].includes(pkg.laGoiThauThuoc);
}

// Empty legacy drafts are not configured reports. Preserve every nonempty or
// completed report; opening the screen must never overwrite evaluation data.
export function canSeedMedicineEvaluation(pkg, roundType, bids = []) {
  if (!isMedicineEvaluationPackage(pkg)) return false;
  const parsed = parseEvaluationMetadataForDisplay(pkg.danhGiaHsdtMetadata);
  if (!parsed.canPersist) return false;
  const block = roundType === "single" ? parsed.metadata : parsed.metadata[roundType] || {};
  return (!Object.hasOwn(block, "criteria") || (Array.isArray(block.criteria) && block.criteria.length === 0))
    && !bids.some((bid) => (bid.baoCaoDanhGiaChiTietList || []).some(
      (report) => report.loaiVong === roundType && (
        report.trangThai !== "draft" || (report.chiTietList || []).length > 0
        || String(report.ketLuan || "").trim() || report.hoanThanhLuc
        || Object.keys(report.extension || {}).some((key) =>
          !["workflowVersion", "technicalEvaluationMethod"].includes(key))
      ),
    ));
}

export function medicineBidderKind(bid = {}) {
  const type = String(bid.loaiNhaThau || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().trim();
  if (type === "lien danh") return "joint";
  if (type === "ho kinh doanh") return "household";
  if (["ca nhan", "nhom ca nhan"].includes(type)) return "individual";
  if (["to chuc", "doanh nghiep"].includes(type)) return "organization";
  // Independent participation does not establish the bidder's legal entity type.
  return "unknown";
}

export function createMedicineEvaluationCriteria(pkg, roundType, groups) {
  const rows = [];
  const add = (group, code, name, medicineBidderKinds = null, stt = null) => rows.push({
    id: `evaluation-criterion:${pkg.id}:${roundType}:MED_${code}`,
    code: `MED_${code}`, name, group, requirement: "", resultType: "pass_fail",
    required: true, maxScore: null, minScore: null, isCustom: true,
    source: "medicine-template", templateId: MEDICINE_TEMPLATE_ID, templateVersion: 1,
    ...(medicineBidderKinds ? { medicineBidderKinds } : {}), ...(stt ? { sourceStt: stt } : {}),
  });
  add("validity", "BID_SECURITY", "Bảo đảm dự thầu", null, "1");
  add("validity", "JV", "Thỏa thuận liên danh (đối với nhà thầu liên danh)", ["joint"], "2");
  add("validity", "ORG", "Tư cách hợp lệ theo quy định tại khoản 1 Điều 5 của Luật đấu thầu", ["organization", "unknown"], "3");
  add("validity", "ORG_SECTION", "Nhà thầu là tổ chức đáp ứng đủ các điều kiện sau đây:", ["organization", "unknown"], "3.1");
  add("validity", "ACCOUNTING", "Hạch toán tài chính độc lập", ["organization", "unknown"], "3.1.1");
  add("validity", "DISSOLUTION", "Không đang trong quá trình thực hiện thủ tục giải thể hoặc bị thu hồi giấy chứng nhận đăng ký doanh nghiệp, giấy chứng nhận đăng ký hợp tác xã, liên hiệp hợp tác xã, tổ hợp tác; không thuộc trường hợp mất khả năng thanh toán theo quy định của pháp luật về phá sản", ["organization", "unknown"], "3.1.2");
  add("validity", "COMPETITION", "Bảo đảm cạnh tranh trong đấu thầu", null, "3.1.3");
  add("validity", "BAN", "Không đang trong thời gian bị cấm tham dự thầu theo quy định của Luật Đấu thầu", null, "3.1.4");
  add("validity", "CRIMINAL", "Không đang bị truy cứu trách nhiệm hình sự", null, "3.1.5");
  add("validity", "HOUSEHOLD_STATUS", "Tư cách hợp lệ theo quy định tại khoản 2 Điều 5 của Luật đấu thầu", ["household"], "3");
  add("validity", "HOUSEHOLD_REG", "Có giấy chứng nhận đăng ký hộ kinh doanh theo quy định", ["household"], "3.1.1");
  add("validity", "HOUSEHOLD_CRIMINAL", "Không đang trong quá trình chấm dứt hoạt động hoặc bị thu hồi giấy chứng nhận đăng ký hộ kinh doanh; chủ hộ kinh doanh không đang bị truy cứu trách nhiệm hình sự", ["household"], "3.1.2");
  add("validity", "INDIVIDUAL_STATUS", "Tư cách hợp lệ theo quy định tại khoản 3 Điều 5 của Luật đấu thầu", ["individual"], "3");
  add("validity", "CIVIL", "Có năng lực hành vi dân sự đầy đủ", ["individual"], "3.1");
  add("validity", "INDIVIDUAL_CRIMINAL", "Không đang bị truy cứu trách nhiệm hình sự", ["individual"], "3.2");
  add("validity", "INDIVIDUAL_COMPETITION", "Bảo đảm cạnh tranh trong đấu thầu", ["individual"], "3.3");
  add("validity", "INDIVIDUAL_BAN", "Không đang trong thời gian bị cấm tham dự thầu", ["individual"], "3.4");
  add("validity", "CERTIFICATE", "Có chứng chỉ chuyên môn phù hợp trong trường hợp pháp luật quản lý ngành, lĩnh vực có quy định", ["individual"], "3.5");
  add("validity", "SYSTEM", "Không trong trạng thái bị tạm ngừng, chấm dứt tham gia Hệ thống", null, "4");
  add("validity", "CONVICTION", "Trong thời hạn 03 năm trước thời điểm đóng thầu, nhà thầu không có nhân sự bị tòa án kết án có hành vi vi phạm quy định về đấu thầu gây hậu quả nghiêm trọng theo quy định của pháp luật về hình sự nhằm mục đích cho nhà thầu đó trúng thầu", null, "5");
  add("capacity", "HISTORY", "Lịch sử thực hiện hợp đồng theo E-HSMT");
  add("capacity", "TAX", "Thực hiện nghĩa vụ kê khai thuế, nộp thuế");
  add("capacity", "FINANCE", "Kết quả hoạt động tài chính theo loại chủ thể và E-HSMT", ["organization", "joint", "unknown", "individual"]);
  add("capacity", "REVENUE", "Doanh thu và tài liệu chứng minh theo E-HSMT");
  add("capacity", "CONTRACTS", "Hợp đồng tương tự và phạm vi cung cấp thuốc");
  add("capacity", "SUPPLY", "Năng lực cung ứng theo phạm vi gói thầu/phần lô tham dự");
  add("capacity", "JV_CAPACITY", "Đối chiếu năng lực từng thành viên và cả liên danh theo phân công", ["joint"]);
  for (const [code, name] of [
    ["IDENTITY", "Đối chiếu từng thuốc: mã, tên, hoạt chất/thành phần, hàm lượng/nồng độ"],
    ["FORM", "Dạng bào chế, đường dùng, quy cách và đơn vị tính"],
    ["REGISTRATION", "Giấy đăng ký lưu hành/giấy phép nhập khẩu và tài liệu liên quan"],
    ["MANUFACTURER", "Cơ sở sản xuất, nước sản xuất và tài liệu chất lượng/GMP theo E-HSMT"],
    ["DRUG_GROUP", "Nhóm thuốc dự thầu và tài liệu chứng minh đáp ứng nhóm"],
    ["QUALITY", "Tiêu chuẩn chất lượng, hạn dùng và điều kiện bảo quản"],
    ["DELIVERY", "Số lượng, tiến độ, địa điểm giao hàng và yêu cầu cung ứng"],
  ]) add("technical", code, name);
  const method = normalizeEvaluationMethod(pkg);
  add("financial", "BID_PRICE", "Giá dự thầu trong phạm vi đang đánh giá");
  add("financial", "DISCOUNT", "Giảm giá và căn cứ phân bổ giảm giá (nếu có)");
  add("financial", "ADJUSTMENT", "Sửa lỗi, hiệu chỉnh và xử lý thuế theo E-HSMT (nếu áp dụng)");
  add("financial", "PREFERENCE", "Điều kiện và giá trị ưu đãi theo E-HSMT (nếu có)");
  if (method === EVALUATION_METHOD_CODES.EVALUATED_PRICE) {
    add("financial", "DELTA_G", "Các yếu tố quy đổi, công thức và giá trị ΔG theo E-HSMT");
    add("financial", "EVALUATED_PRICE", "Giá đánh giá dùng để so sánh, xếp hạng");
  } else if (method === EVALUATION_METHOD_CODES.LOWEST_PRICE) {
    add("financial", "LOWEST_PRICE", "Giá sau các điều chỉnh được áp dụng để so sánh, xếp hạng");
  } else if (method === EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE) {
    add("financial", "PRICE_SCORE", "Công thức và điểm giá theo E-HSMT");
    add("financial", "COMBINED_SCORE", "Điểm kỹ thuật, trọng số và điểm tổng hợp theo E-HSMT");
  } else {
    add("financial", "METHOD", "Xác nhận phương pháp, công thức và căn cứ xếp hạng trong E-HSMT");
  }
  add("financial", "RANKING", "Kết quả xếp hạng trong phạm vi đang đánh giá");
  const counts = {};
  return rows.filter((row) => groups.includes(row.group)).map((row, order) => ({
    ...row, order, stt: row.sourceStt || String(counts[row.group] = (counts[row.group] || 0) + 1),
  }));
}

export function adaptMedicineEvaluationCriteria(criteria, bid, report) {
  const kind = medicineBidderKind(bid);
  const savedIds = new Set((report?.chiTietList || []).map((row) => row.tieuChiDanhGiaId));
  const savedBranch = criteria.some((row) => row.medicineBidderKinds && savedIds.has(row.id));
  const filtered = criteria.filter((criterion) => {
    if (criterion.templateId !== MEDICINE_TEMPLATE_ID || !criterion.medicineBidderKinds) return true;
    return savedBranch ? savedIds.has(criterion.id) : criterion.medicineBidderKinds.includes(kind);
  });
  const groups = new Map();
  return filtered.map((criterion, index) => {
    if (criterion.templateId !== MEDICINE_TEMPLATE_ID) return criterion;
    const parts = String(criterion.sourceStt || criterion.stt || index + 1).split(".");
    const mapping = groups.get(criterion.group) || new Map();
    groups.set(criterion.group, mapping);
    if (!mapping.has(parts[0])) mapping.set(parts[0], String(mapping.size + 1));
    parts[0] = mapping.get(parts[0]);
    return { ...criterion, stt: parts.join(".") };
  });
}

export function isLegacyMedicineTemplateCriteria(criteria = []) {
  return criteria.some((criterion) => criterion.templateId === MEDICINE_TEMPLATE_ID
    && ["MED_ENTITY", "MED_COMPETITION", "MED_BAN", "MED_SYSTEM", "MED_PHARMACY"]
      .includes(String(criterion.code || "")));
}
