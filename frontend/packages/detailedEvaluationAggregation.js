import { parseVietnameseNumber } from "../shared/formatters.js";

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .join("; ");
}

export function aggregateDetailedEvaluation({
  report = {},
  criteria = [],
  group,
} = {}) {
  const groupCriteria = criteria.filter((criterion) => criterion.group === group);
  const rows = new Map(
    (report.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  // A parent with children is a derived subtotal. Aggregate only leaf criteria
  // so a stored/legacy parent score cannot be counted a second time.
  const leafCriteria = groupCriteria.filter((criterion) => criterion.hasChildren !== true);
  const requiredCriteria = leafCriteria.filter((criterion) => criterion.required !== false);
  const requiredRows = requiredCriteria.map(
    (criterion) => rows.get(String(criterion.id)) || { ketQua: "pending" },
  );
  let status = "";
  if (requiredRows.some((row) => row.ketQua === "fail")) {
    status = "Không đạt";
  } else if (
    requiredRows.length > 0
    && requiredRows.every((row) => row.ketQua && row.ketQua !== "pending")
  ) {
    status = "Đạt";
  }
  const groupRows = leafCriteria
    .map((criterion) => rows.get(String(criterion.id)))
    .filter(Boolean);
  const numericScores = groupRows
    .map((row) => row.diem)
    .map(parseVietnameseNumber)
    .filter((value) => value !== null && Number.isFinite(value));
  return {
    status,
    score: numericScores.length > 0
      ? numericScores.reduce((total, value) => total + value, 0)
      : null,
    clarification: uniqueText(groupRows.flatMap(
      (row) => [row.yeuCauLamRo, row.ketQuaLamRo],
    )),
  };
}

export function aggregateDetailedEvaluationAutomatic({
  report = {},
  criteria = [],
  group,
} = {}) {
  const rows = new Map(
    (report.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  const results = criteria
    .filter((criterion) => criterion.group === group
      && criterion.hasChildren !== true && criterion.required !== false)
    .map((criterion) => {
      const row = rows.get(String(criterion.id)) || {};
      return row.extension?.ketQuaTuDong || row.ketQuaTuDong || "pending";
    });
  if (results.some((result) => result === "fail")) return "Không đạt";
  if (results.length > 0 && results.every(
    (result) => result === "pass" || result === "not_applicable",
  )) return "Đạt";
  return "";
}

export function aggregateDetailedEvaluationReport({
  report = {},
  criteria = [],
  groups = [],
} = {}) {
  const byGroup = Object.fromEntries(groups.map((group) => [
    group,
    aggregateDetailedEvaluation({ report, criteria, group }),
  ]));
  const results = Object.values(byGroup);
  let status = "";
  if (results.some((result) => result.status === "Không đạt")) {
    status = "Không đạt";
  } else if (results.length > 0 && results.every((result) => result.status === "Đạt")) {
    status = "Đạt";
  }
  const scores = results
    .map((result) => result.score)
    .map(parseVietnameseNumber)
    .filter((value) => value !== null && Number.isFinite(value));
  return {
    byGroup,
    overall: {
      status,
      score: scores.length > 0
        ? scores.reduce((total, value) => total + value, 0)
        : null,
      clarification: uniqueText(results.map((result) => result.clarification)),
    },
  };
}
