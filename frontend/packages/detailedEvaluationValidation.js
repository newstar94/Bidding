const RESULT_VALUES = new Set(["pending", "pass", "acceptable", "fail", "not_applicable"]);

function error(criterionId, field, message) {
  return { criterionId: String(criterionId || ""), field, message };
}

export function validateDetailedEvaluationRow(row = {}, criterion = {}, {
  completing = false,
} = {}) {
  const criterionId = criterion.id || row.tieuChiDanhGiaId || "";
  const result = String(row.ketQua || "pending");
  const errors = [];
  if (!RESULT_VALUES.has(result)) {
    errors.push(error(criterionId, "ketQua", "Kết quả đánh giá không hợp lệ."));
  }
  if (completing && criterion.required !== false && result === "pending") {
    errors.push(error(
      criterionId,
      "ketQua",
      "Tiêu chí bắt buộc chưa được đánh giá.",
    ));
  }
  if (result === "not_applicable" && !String(row.nhanXet || "").trim()) {
    errors.push(error(
      criterionId,
      "nhanXet",
      "Vui lòng ghi chú lý do không áp dụng.",
    ));
  }
  if (criterion.resultType === "score") {
    const maximumMissing = criterion.maxScore === ""
      || criterion.maxScore === null
      || criterion.maxScore === undefined;
    const minimumMissing = criterion.minScore === ""
      || criterion.minScore === null
      || criterion.minScore === undefined;
    const maximum = maximumMissing ? Number.NaN : Number(criterion.maxScore);
    const minimum = minimumMissing ? Number.NaN : Number(criterion.minScore);
    if (completing && (!Number.isFinite(maximum) || maximum <= 0)) {
      errors.push(error(
        criterionId,
        "maxScore",
        "Điểm tối đa phải là số lớn hơn 0.",
      ));
    }
    if (completing && (!Number.isFinite(minimum) || minimum < 0)) {
      errors.push(error(
        criterionId,
        "minScore",
        "Điểm tối thiểu phải là số không âm.",
      ));
    } else if (Number.isFinite(maximum) && Number.isFinite(minimum) && minimum > maximum) {
      errors.push(error(
        criterionId,
        "minScore",
        "Điểm tối thiểu không được lớn hơn điểm tối đa.",
      ));
    }
  }
  if (criterion.resultType === "score" && result !== "pending") {
    const score = row.diem === "" || row.diem === null || row.diem === undefined
      ? Number.NaN
      : Number(row.diem);
    const maximum = criterion.maxScore === null || criterion.maxScore === undefined
      ? null
      : Number(criterion.maxScore);
    if (!Number.isFinite(score) || score < 0 || (maximum !== null && score > maximum)) {
      errors.push(error(
        criterionId,
        "diem",
        maximum === null
          ? "Điểm phải là số không âm."
          : `Điểm phải từ 0 đến ${maximum}.`,
      ));
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateDetailedEvaluationGroup(rows = [], criteria = [], {
  completing = false,
} = {}) {
  const rowsByCriterion = new Map(
    rows.map((row) => [String(row.tieuChiDanhGiaId || ""), row]),
  );
  const errors = criteria
    .filter((criterion) => criterion.hasChildren !== true)
    .flatMap((criterion) => validateDetailedEvaluationRow(
    rowsByCriterion.get(String(criterion.id)) || {
      tieuChiDanhGiaId: criterion.id,
      ketQua: "pending",
    },
    criterion,
    { completing },
    ).errors);
  return { valid: errors.length === 0, errors };
}

export function validateDetailedEvaluationReport(report = {}, context = {}, criteria = []) {
  const editableGroups = new Set(context.editableGroups || []);
  const scopedCriteria = criteria.filter(
    (criterion) => editableGroups.size === 0 || editableGroups.has(criterion.group),
  );
  return validateDetailedEvaluationGroup(
    report.chiTietList || [],
    scopedCriteria,
    { completing: true },
  );
}
