import { adaptDetailedEvaluationCriteriaForBid } from "./detailedEvaluationCriteria.js";

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanImportedText(value) {
  return String(value ?? "")
    .replace(/\(\s*\d{1,3}\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:])/g, "$1")
    .trim();
}

function extractContractorNamesFromSheet(sheet = {}) {
  const names = [];
  (sheet.rows || []).slice(0, 8).forEach((row) => {
    (row || []).forEach((value) => {
      const text = String(value ?? "");
      const pattern = /(?:^|[\r\n]|\s+-\s+)nhà\s+thầu\s*:\s*([^\r\n]+)/giu;
      for (const match of text.matchAll(pattern)) {
        const name = String(match[1] || "").trim();
        if (name) names.push(name);
      }
    });
  });
  return names;
}

export function validateMuasamcongContractorIdentity(sheets = [], expectedName = "") {
  const namesByIdentity = new Map();
  sheets.flatMap(extractContractorNamesFromSheet).forEach((name) => {
    const identity = normalize(name);
    if (identity && !namesByIdentity.has(identity)) namesByIdentity.set(identity, name);
  });
  const actualNames = [...namesByIdentity.values()];
  const selectedName = String(expectedName || "").trim();
  if (actualNames.length === 0) {
    return { valid: false, reason: "missing-workbook-name", expectedName: selectedName, actualNames };
  }
  if (actualNames.length > 1) {
    return { valid: false, reason: "conflicting-workbook-names", expectedName: selectedName, actualNames };
  }
  if (!normalize(selectedName)) {
    return { valid: false, reason: "missing-selected-name", expectedName: selectedName, actualNames };
  }
  const valid = normalize(actualNames[0]) === normalize(selectedName);
  return {
    valid,
    reason: valid ? "match" : "mismatch",
    expectedName: selectedName,
    actualNames,
  };
}

function normalizedRow(row = {}) {
  return new Map(Object.entries(row).map(([key, value]) => [normalize(key), value]));
}

function valueFor(row, aliases) {
  for (const alias of aliases) {
    const value = row.get(normalize(alias));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function isMarked(value) {
  const token = normalize(value);
  return Boolean(token) && !["0", "false", "khong", "no", "n"].includes(token);
}

function parseResult(row, rawResult) {
  const token = normalize(rawResult);
  if (["dat", "pass", "passed", "yes", "y", "true", "1"].includes(token)) return "pass";
  if (["khong dat", "fail", "failed", "no", "n", "false", "0"].includes(token)) return "fail";
  if (["khong ap dung", "not applicable", "n a", "na"].includes(token)) return "not_applicable";
  if (["chua danh gia", "pending", ""].includes(token)) {
    if (isMarked(valueFor(row, ["Không đạt", "Kết quả không đạt"]))) return "fail";
    if (isMarked(valueFor(row, ["Không áp dụng"]))) return "not_applicable";
    if (isMarked(valueFor(row, ["Đạt", "Kết quả đạt"]))) return "pass";
    return "pending";
  }
  return "pending";
}

function parseScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function findCriterion(row, criteria, usedIds) {
  const code = normalize(valueFor(row, ["Mã tiêu chí", "Criterion code", "Mã"]));
  if (code) {
    const byCode = criteria.find((criterion) => (
      normalize(criterion.code) === code && !usedIds.has(String(criterion.id))
    ));
    if (byCode) return byCode;
  }

  const name = normalize(cleanImportedText(valueFor(row, [
    "Tiêu chí/Yêu cầu",
    "Tiêu chí",
    "Nội dung đánh giá",
    "Nội dung đánh giá trong E-HSMT",
    "Nội dung",
    "Criterion",
  ])));
  if (name) {
    const exact = criteria.find((criterion) => (
      normalize(criterion.name) === name && !usedIds.has(String(criterion.id))
    ));
    if (exact) return exact;
    const fuzzy = criteria.filter((criterion) => {
      const candidate = normalize(criterion.name);
      return !usedIds.has(String(criterion.id))
        && candidate.length >= 8
        && (candidate.includes(name) || name.includes(candidate));
    });
    if (fuzzy.length === 1) return fuzzy[0];
  }

  const order = Number(valueFor(row, ["STT", "Số thứ tự", "No.", "No"]));
  return Number.isInteger(order) && order > 0
    ? criteria[order - 1] || null
    : null;
}

export function mapDetailedEvaluationExcelRows(rows = [], criteria = []) {
  const matches = [];
  const unmatchedRows = [];
  const warnings = [];
  const usedIds = new Set();

  rows.forEach((sourceRow, index) => {
    const row = normalizedRow(sourceRow);
    const criterion = findCriterion(row, criteria, usedIds);
    if (!criterion) {
      unmatchedRows.push(index + 2);
      return;
    }
    usedIds.add(String(criterion.id));
    const rawResult = valueFor(row, [
      "Kết quả",
      "Kết quả đánh giá",
      "Kết quả của chuyên gia",
      "Đánh giá",
      "Result",
    ]);
    const score = parseScore(valueFor(row, ["Điểm đánh giá", "Điểm", "Score"]));
    let result = parseResult(row, rawResult);
    if (criterion.resultType === "score" && score !== null && result === "pending") result = "pass";
    if (rawResult && result === "pending" && normalize(rawResult) !== "chua danh gia") {
      warnings.push(`Dòng ${index + 2}: kết quả "${String(rawResult)}" không được nhận diện.`);
    }
    matches.push({
      criterion,
      values: {
        ketQua: result,
        diem: score,
        noiDungHsdt: cleanImportedText(valueFor(row, [
          "Nội dung trong HSDT",
          "Nội dung HSDT",
          "Thông tin trong E-HSDT",
          "Thông tin trong HSDT",
          "Bidder response",
        ])),
        nhanXet: cleanImportedText(valueFor(row, ["Nhận xét đánh giá", "Nhận xét của chuyên gia", "Nhận xét", "Comment"])),
        yeuCauLamRo: cleanImportedText(valueFor(row, ["Yêu cầu làm rõ", "Clarification request"])),
        ketQuaLamRo: cleanImportedText(valueFor(row, ["Kết quả làm rõ", "Clarification response"])),
        taiLieuThamChieu: cleanImportedText(valueFor(row, ["Tài liệu tham chiếu", "Tài liệu", "Reference"])),
      },
    });
  });

  return { matches, unmatchedRows, warnings };
}

function sheetText(sheet) {
  return normalize((sheet?.rows || []).slice(0, 8).flat().filter(Boolean).join(" "));
}

function rowValue(row, index) {
  return String(row?.[index] ?? "").trim();
}

function isNumberedRow(row) {
  return /^\d+(?:\.\d+)*\.?$/.test(rowValue(row, 0));
}

function markedResult(row, passIndex, failIndex, acceptableIndex = -1) {
  if (failIndex >= 0 && isMarked(rowValue(row, failIndex))) return "fail";
  if (passIndex >= 0 && isMarked(rowValue(row, passIndex))) return "pass";
  if (acceptableIndex >= 0 && isMarked(rowValue(row, acceptableIndex))) return "acceptable";
  return "pending";
}

function parseVietnameseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") return null;
  let numeric = raw.replace(/[^0-9,.-]/g, "");
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(numeric)) {
    numeric = numeric.replaceAll(".", "").replace(",", ".");
  } else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(numeric)) {
    numeric = numeric.replaceAll(",", "");
  } else {
    numeric = numeric.replace(",", ".");
  }
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

function criterionCode(group, stt, rowIndex) {
  const token = normalize(stt).replaceAll(" ", "_").toUpperCase() || String(rowIndex + 1);
  return `MSC_${group.toUpperCase()}_${token}`;
}

function makeCriterion({ group, stt, name, rowIndex, roundId, resultType = "pass_fail", maxScore = null, minScore = null, requirement = "" }) {
  const code = criterionCode(group, stt, rowIndex);
  return {
    id: `evaluation-criterion:${roundId}:${code}`,
    code,
    name: cleanImportedText(name),
    group,
    resultType,
    required: true,
    maxScore,
    minScore,
    requirement: cleanImportedText(requirement),
    stt: String(stt || rowIndex + 1).trim().replace(/\.$/, ""),
    sourceStt: String(stt || rowIndex + 1).trim().replace(/\.$/, ""),
    order: rowIndex,
    source: "muasamcong",
  };
}

function markStructuralCriteria(parsed) {
  const valuesById = new Map(parsed.matches.map(
    ({ criterion, values }) => [String(criterion.id), values],
  ));
  parsed.criteria.forEach((criterion) => {
    const hasChildren = parsed.criteria.some((candidate) => (
      candidate.stt.startsWith(`${criterion.stt}.`)
    ));
    const values = valuesById.get(String(criterion.id));
    if (hasChildren
      && (values?.ketQuaTuDong || "pending") === "pending"
      && (values?.ketQua || "pending") === "pending") {
      criterion.isSection = true;
      criterion.required = false;
    }
  });
  return parsed;
}

function adaptParsedValidityForBid(parsed, bid) {
  const criteria = adaptDetailedEvaluationCriteriaForBid(parsed.criteria, bid);
  const visibleIds = new Set(criteria.map((criterion) => String(criterion.id)));
  return {
    ...parsed,
    criteria,
    matches: parsed.matches
      .filter(({ criterion }) => visibleIds.has(String(criterion.id)))
      .map((match) => ({
        ...match,
        criterion: criteria.find((criterion) => criterion.id === match.criterion.id),
      })),
  };
}

function detectBidTypeFromSheet(sheet) {
  const headerText = normalize(
    (sheet?.rows || []).slice(0, 4).flat().filter(Boolean).join(" "),
  );
  return headerText.includes("nha thau lien danh") ? "Liên danh" : "";
}

function parseValiditySheet(sheet, roundId, bid = {}) {
  const criteria = [];
  const rows = [];
  (sheet.rows || []).forEach((row) => {
    if (!isNumberedRow(row) || !rowValue(row, 1)) return;
    const criterion = makeCriterion({
      group: "validity",
      stt: rowValue(row, 0),
      name: rowValue(row, 1),
      rowIndex: criteria.length,
      roundId,
    });
    const expert = markedResult(row, 4, 5);
    const automatic = markedResult(row, 2, 3);
    criteria.push(criterion);
    rows.push({
      criterion,
      values: {
        ketQua: expert,
        ketQuaTuDong: automatic,
        diem: null,
        noiDungHsdt: "",
        nhanXet: cleanImportedText(rowValue(row, 6)),
        yeuCauLamRo: "",
        ketQuaLamRo: "",
        taiLieuThamChieu: "",
      },
    });
  });
  const detectedBidType = detectBidTypeFromSheet(sheet);
  const parsed = adaptParsedValidityForBid(
    markStructuralCriteria({ criteria, matches: rows }),
    bid,
  );
  return detectedBidType ? { ...parsed, detectedBidType } : parsed;
}

function parseCapacitySheet(sheet, roundId) {
  const criteria = [];
  const rows = [];
  (sheet.rows || []).forEach((row) => {
    if (!isNumberedRow(row) || !rowValue(row, 1)) return;
    const criterion = makeCriterion({
      group: "capacity",
      stt: rowValue(row, 0),
      name: rowValue(row, 1),
      requirement: rowValue(row, 2),
      rowIndex: criteria.length,
      roundId,
    });
    const bidderInformation = [...new Set(
      row.slice(3, 15).map(cleanImportedText).filter(Boolean),
    )].join("\n");
    const expert = markedResult(row, 17, 18);
    const automatic = markedResult(row, 15, 16);
    criteria.push(criterion);
    rows.push({
      criterion,
      values: {
        ketQua: expert,
        ketQuaTuDong: automatic,
        diem: null,
        noiDungHsdt: bidderInformation,
        nhanXet: cleanImportedText(rowValue(row, 19)),
        yeuCauLamRo: "",
        ketQuaLamRo: "",
        taiLieuThamChieu: "",
      },
    });
  });
  return markStructuralCriteria({ criteria, matches: rows });
}

function applyLotCapacityData(parsed, sheets, bid = {}) {
  const lotCode = normalize(bid.maPhanLo || bid.maPhan || bid.lotCode);
  if (!lotCode) return parsed;
  const lotTable = sheets.find((sheet) => normalize(sheet.name) === "bang x");
  const lotRow = lotTable?.rows?.find((row, index) => index > 0 && normalize(rowValue(row, 1)) === lotCode);
  const appendix = sheets.find((sheet) => normalize(sheet.name).includes("phu luc"));
  const appendixRow = appendix?.rows?.find((row, index) => index > 1 && normalize(rowValue(row, 0)) === lotCode);
  if (!lotRow && !appendixRow) {
    return {
      ...parsed,
      warnings: [`Không tìm thấy mã phần lô ${bid.maPhanLo || bid.maPhan || bid.lotCode} trong Bảng X hoặc phụ lục.`],
    };
  }

  const requirements = (criterion) => {
    const name = normalize(criterion.name);
    if (name.includes("doanh thu")) return rowValue(lotRow, 4);
    if (name.includes("hop dong") && name.includes("tuong tu")) return rowValue(lotRow, 7);
    if (name.includes("nang luc san xuat")) return rowValue(lotRow, 8);
    if (name.includes("bao hanh") || name.includes("bao tri")) return rowValue(lotRow, 9);
    return "";
  };
  const appendixValue = (criterion) => {
    const name = normalize(criterion.name);
    if (name.includes("hop dong") && name.includes("tuong tu")) return rowValue(appendixRow, 1);
    if (name.includes("nang luc san xuat")) return rowValue(appendixRow, 2);
    if (name.includes("bao hanh") || name.includes("bao tri")) return rowValue(appendixRow, 3);
    return "";
  };
  const byId = new Map(parsed.criteria.map((criterion) => {
    const requirement = requirements(criterion);
    return [
      String(criterion.id),
      requirement ? { ...criterion, requirement: cleanImportedText(requirement) } : criterion,
    ];
  }));
  return {
    ...parsed,
    criteria: parsed.criteria.map((criterion) => byId.get(String(criterion.id))),
    matches: parsed.matches.map((match) => {
      const criterion = byId.get(String(match.criterion.id));
      const expertValue = appendixValue(criterion);
      return {
        ...match,
        criterion,
        values: {
          ...match.values,
          ketQua: expertValue ? parseResult(new Map(), expertValue) : match.values.ketQua,
          nhanXet: cleanImportedText(rowValue(appendixRow, 4)) || match.values.nhanXet,
        },
      };
    }),
  };
}

function findHeaderColumn(sheet, label) {
  const target = normalize(label);
  for (const row of (sheet.rows || []).slice(0, 10)) {
    const index = row.findIndex((value) => normalize(value).includes(target));
    if (index >= 0) return index;
  }
  return -1;
}

function parseTechnicalSheet(sheet, roundId) {
  const criteria = [];
  const rows = [];
  const maximumIndex = findHeaderColumn(sheet, "Điểm tối đa");
  const minimumIndex = findHeaderColumn(sheet, "Điểm tối thiểu");
  const scoreIndex = findHeaderColumn(sheet, "Điểm đánh giá");
  const commentIndex = findHeaderColumn(sheet, "Nhận xét của chuyên gia");
  const passIndex = findHeaderColumn(sheet, "Đạt");
  const acceptableIndex = findHeaderColumn(sheet, "Chấp nhận được");
  const failIndex = findHeaderColumn(sheet, "Không đạt");
  const scoring = scoreIndex >= 0;
  (sheet.rows || []).forEach((row) => {
    if (!isNumberedRow(row) || !rowValue(row, 1) || rowValue(row, 1) === "-") return;
    const score = scoring ? parseVietnameseNumber(rowValue(row, scoreIndex)) : null;
    const criterion = makeCriterion({
      group: "technical",
      stt: rowValue(row, 0),
      name: rowValue(row, 1),
      rowIndex: criteria.length,
      roundId,
      resultType: scoring ? "score" : "pass_fail",
      maxScore: scoring ? parseVietnameseNumber(rowValue(row, maximumIndex)) : null,
      minScore: scoring ? parseVietnameseNumber(rowValue(row, minimumIndex)) : null,
    });
    criteria.push(criterion);
    rows.push({
      criterion,
      values: {
        ketQua: scoring
          ? score !== null ? "pass" : "pending"
          : markedResult(row, passIndex, failIndex, acceptableIndex),
        diem: score,
        noiDungHsdt: "",
        nhanXet: commentIndex >= 0 ? cleanImportedText(rowValue(row, commentIndex)) : "",
        yeuCauLamRo: "",
        ketQuaLamRo: "",
        taiLieuThamChieu: "",
      },
    });
  });
  return markStructuralCriteria({ criteria, matches: rows });
}

function parseFinancialSheet(sheet, roundId) {
  const criteria = [];
  const rows = [];
  const valueIndex = findHeaderColumn(sheet, "Giá trị");
  (sheet.rows || []).forEach((row) => {
    if (!isNumberedRow(row) || !rowValue(row, 1)) return;
    const value = cleanImportedText(
      valueIndex >= 0 ? rowValue(row, valueIndex) : row.filter(Boolean).slice(-1)[0] || "",
    );
    const score = normalize(rowValue(row, 1)).includes("diem") ? parseVietnameseNumber(value) : null;
    const criterion = makeCriterion({
      group: "financial",
      stt: rowValue(row, 0),
      name: rowValue(row, 1),
      rowIndex: criteria.length,
      roundId,
    });
    criteria.push(criterion);
    rows.push({
      criterion,
      values: {
        ketQua: value ? "pass" : "pending",
        diem: score,
        noiDungHsdt: value,
        nhanXet: "",
        yeuCauLamRo: "",
        ketQuaLamRo: "",
        taiLieuThamChieu: "",
      },
    });
  });
  return markStructuralCriteria({ criteria, matches: rows });
}

function chooseFinancialSheet(candidates, pkg = {}) {
  const method = normalize(pkg.phuongPhapDanhGia);
  const field = normalize(
    pkg.linhVuc || pkg.loaiGoiThau || pkg.loaiGoi || pkg.category,
  );
  const selectionMethod = normalize(pkg.phuongThucLuaChon);
  const consulting = field === "tu van" || field.startsWith("tu van ");
  const twoEnvelope = selectionMethod.includes("hai tui");
  const preferredCode = consulting
    ? method.includes("ket hop") ? "02b" : "02"
    : twoEnvelope
      ? method.includes("ket hop")
        ? "06b"
        : method.includes("gia danh gia") ? "06a" : "06c"
      : method.includes("gia danh gia") ? "07a" : "07b";
  const preferred = candidates.find((sheet) => (
    normalize(sheet.name).endsWith(preferredCode)
  ));
  if (preferred) return preferred;
  const phrase = method.includes("ket hop")
    ? "ket hop giua ky thuat va gia"
    : method.includes("gia danh gia")
      ? "gia danh gia"
      : method.includes("dua tren ky thuat")
        ? "dua tren ky thuat"
        : "gia thap nhat";
  return candidates.find((sheet) => sheetText(sheet).includes(phrase))
    || candidates.at(-1)
    || null;
}

function chooseTechnicalSheet(candidates, pkg = {}) {
  if (candidates.length <= 1) return candidates[0] || null;
  const ranked = candidates.map((sheet) => ({
    sheet,
    count: (sheet.rows || []).filter((row) => isNumberedRow(row) && rowValue(row, 1) && rowValue(row, 1) !== "-").length,
  })).sort((left, right) => right.count - left.count);
  if (ranked[0].count > ranked[1].count) return ranked[0].sheet;
  const method = normalize(pkg.phuongPhapDanhGia);
  const technicalMethod = normalize(pkg.technicalEvaluationMethod || pkg.phuongPhapDanhGiaKyThuat);
  if (technicalMethod.includes("score") || technicalMethod.includes("cham diem")
    || method.includes("cham diem") || method.includes("ket hop") || normalize(pkg.linhVuc) === "tu van") {
    return candidates.find((sheet) => normalize(sheet.name).endsWith("a")) || candidates[0];
  }
  return candidates.find((sheet) => normalize(sheet.name).endsWith("b")) || candidates.at(-1);
}

export function parseMuasamcongDetailedEvaluationWorkbook(sheets = [], {
  group,
  pkg = {},
  bid = {},
  roundId = "evaluation-round:pending:single",
} = {}) {
  const candidates = sheets.filter((sheet) => {
    const text = sheetText(sheet);
    if (group === "validity") return text.includes("danh gia tinh hop le");
    if (group === "capacity") return text.includes("danh gia ve nang luc va kinh nghiem");
    if (group === "technical") return text.includes("danh gia ve ky thuat");
    if (group === "financial") return text.includes("tong hop ket qua danh gia ve tai chinh");
    return false;
  });
  if (candidates.length === 0) return null;
  const sheet = group === "financial"
    ? chooseFinancialSheet(candidates, pkg)
    : group === "technical"
      ? chooseTechnicalSheet(candidates, pkg)
      : candidates[0];
  let parsed = group === "validity"
    ? parseValiditySheet(sheet, roundId, bid)
    : group === "capacity"
      ? parseCapacitySheet(sheet, roundId)
      : group === "technical"
        ? parseTechnicalSheet(sheet, roundId)
        : parseFinancialSheet(sheet, roundId);
  if (group === "capacity") parsed = applyLotCapacityData(parsed, sheets, bid);
  return parsed.criteria.length > 0
    ? {
      ...parsed,
      sourceCriteria: group === "validity"
        ? parseValiditySheet(sheet, roundId).criteria
        : parsed.criteria,
      sheetName: sheet.name,
      unmatchedRows: [],
      warnings: parsed.warnings || [],
    }
    : null;
}
