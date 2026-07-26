import { adaptDetailedEvaluationCriteriaForBid } from "./detailedEvaluationCriteria.js";
import {
  mapDetailedEvaluationExcelRows,
  parseMuasamcongDetailedEvaluationWorkbook,
} from "./detailedEvaluationExcel.js";
import {
  applyHierarchicalDetailedEvaluationResults,
  markHierarchicalDetailedEvaluationCriteria,
} from "./detailedEvaluationHierarchy.js";

function flattenFirstSheet(sheets) {
  const rows = sheets[0]?.rows || [];
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => Object.fromEntries(
    headers.map((header, index) => [String(header || `Cột ${index + 1}`), row[index]]),
  ));
}

function mergeImportedRows(report, existingRows, matches) {
  const rowsByCriterion = new Map(
    existingRows.map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  matches.forEach(({ criterion, values }) => {
    const previous = rowsByCriterion.get(String(criterion.id)) || {};
    const textValue = (field) => values[field] !== "" ? values[field] : previous[field] || "";
    rowsByCriterion.set(String(criterion.id), {
      ...previous,
      id: previous.id || `detailed-evaluation-row:${report.id}:${criterion.id}`,
      tieuChiDanhGiaId: criterion.id,
      ketQua: values.ketQua !== "pending" ? values.ketQua : previous.ketQua || "pending",
      diem: values.diem !== null ? values.diem : previous.diem ?? null,
      noiDungHsdt: textValue("noiDungHsdt"),
      nhanXet: textValue("nhanXet"),
      lyDoKhongDat: textValue("lyDoKhongDat"),
      yeuCauLamRo: textValue("yeuCauLamRo"),
      ketQuaLamRo: textValue("ketQuaLamRo"),
      taiLieuThamChieu: textValue("taiLieuThamChieu"),
      extension: {
        ...(previous.extension || {}),
        ...(values.ketQuaTuDong && values.ketQuaTuDong !== "pending"
          ? { ketQuaTuDong: values.ketQuaTuDong }
          : {}),
      },
    });
  });
  return [...rowsByCriterion.values()];
}

export function analyzeDetailedEvaluationWorkbook({
  state,
  sheets = [],
  activeGroup,
  currentCriteriaOverride = null,
} = {}) {
  if (!state?.pkg || !state?.bid || !state?.report || !Array.isArray(sheets)) {
    throw new TypeError("Detailed evaluation import requires a valid state and workbook sheets.");
  }
  const groupCriteria = state.criteria.filter((criterion) => criterion.group === activeGroup);
  const roundId = `evaluation-round:${String(state.pkg.id || "pending")}:${state.roundType}`;
  const muasamcongImports = state.context.editableGroups.map((group) => (
    parseMuasamcongDetailedEvaluationWorkbook(sheets, {
      group,
      pkg: state.pkg,
      bid: state.bid,
      roundId,
    })
  )).filter(Boolean);
  const imported = muasamcongImports.length > 0
    ? {
      matches: muasamcongImports.flatMap((item) => item.matches),
      unmatchedRows: [],
      warnings: muasamcongImports.flatMap((item) => item.warnings || []),
    }
    : mapDetailedEvaluationExcelRows(flattenFirstSheet(sheets), groupCriteria);
  if (imported.matches.length === 0) {
    return {
      imported,
      isMuasamcong: muasamcongImports.length > 0,
      muasamcongImports,
      criteriaOverride: null,
      report: null,
    };
  }

  let existingReportRows = state.report.chiTietList || [];
  let criteriaOverride = currentCriteriaOverride;
  if (muasamcongImports.length > 0) {
    const importedGroups = new Set(muasamcongImports.flatMap(
      (item) => item.criteria.map((criterion) => criterion.group),
    ));
    const previousGroupIds = new Set(state.baseCriteria
      .filter((criterion) => importedGroups.has(criterion.group))
      .map((criterion) => String(criterion.id)));
    existingReportRows = existingReportRows.filter(
      (row) => !previousGroupIds.has(String(row.tieuChiDanhGiaId)),
    );
    criteriaOverride = [
      ...state.baseCriteria.filter((criterion) => !importedGroups.has(criterion.group)),
      ...muasamcongImports.flatMap((item) => item.sourceCriteria || item.criteria),
    ];
  }
  const importedExtension = { ...(state.report.extension || {}) };
  delete importedExtension.excelBidType;
  const hierarchyCriteria = markHierarchicalDetailedEvaluationCriteria(
    muasamcongImports.length > 0
      ? adaptDetailedEvaluationCriteriaForBid(criteriaOverride || state.baseCriteria, state.bid)
      : state.criteria,
  );
  const report = applyHierarchicalDetailedEvaluationResults({
    ...state.report,
    extension: importedExtension,
    chiTietList: mergeImportedRows(state.report, existingReportRows, imported.matches),
  }, hierarchyCriteria);
  return {
    imported,
    isMuasamcong: muasamcongImports.length > 0,
    muasamcongImports,
    criteriaOverride,
    report,
    stats: {
      matched: imported.matches.length,
      skipped: imported.unmatchedRows.length,
      warnings: imported.warnings.length,
      sheetNames: muasamcongImports.map((item) => item.sheetName).join(", "),
    },
  };
}
