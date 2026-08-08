import {
  EVALUATION_METHOD_CODES,
  isCombinedEvaluationMethod,
  normalizeEvaluationMethod,
  parseTechnicalScore,
} from "./evaluationMethodRules.js";
import { parseEvaluationMetadataForDisplay } from "./evaluationMetadata.js";

export { parseTechnicalScore } from "./evaluationMethodRules.js";

export const TECHNICAL_EVALUATION_METHODS = Object.freeze({
  PASS_FAIL: "pass_fail",
  SCORE: "score",
});

const FORCED_PASS_FAIL_FORMS = new Set([
  "chao hang canh tranh",
  "chi dinh thau",
  "chi dinh thau rut gon",
  "lua chon nha thau trong truong hop dac biet",
]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeTechnicalEvaluationMethod(value) {
  const token = normalize(value);
  if (["score", "scoring", "cham diem", "diem"].includes(token)) {
    return TECHNICAL_EVALUATION_METHODS.SCORE;
  }
  if (["pass fail", "pass_fail", "dat khong dat", "dat va khong dat"].includes(token)) {
    return TECHNICAL_EVALUATION_METHODS.PASS_FAIL;
  }
  return "";
}

export function isCombinedTechnicalPriceMethod(valueOrPackage = {}) {
  return isCombinedEvaluationMethod(valueOrPackage);
}

function metadataBlock(pkg, roundType) {
  const metadata = parseEvaluationMetadataForDisplay(
    pkg?.danhGiaHsdtMetadata,
  ).metadata;
  return roundType === "single" ? metadata : metadata?.[roundType] || {};
}

export function getStoredTechnicalEvaluationMethod(pkg = {}, roundType = "single") {
  const block = metadataBlock(pkg, roundType);
  return normalizeTechnicalEvaluationMethod(
    block.technicalEvaluationMethod
      || block.phuongPhapDanhGiaKyThuat
      || pkg.technicalEvaluationMethod
      || pkg.phuongPhapDanhGiaKyThuat,
  );
}

export function getForcedTechnicalEvaluationMethod(pkg = {}) {
  const field = normalize(pkg.linhVuc || pkg.loaiGoiThau || pkg.loaiGoi || pkg.category);
  if (field === "tu van" || field.startsWith("tu van ")) {
    return TECHNICAL_EVALUATION_METHODS.SCORE;
  }
  if (FORCED_PASS_FAIL_FORMS.has(normalize(pkg.hinhThucLuaChon))) {
    return TECHNICAL_EVALUATION_METHODS.PASS_FAIL;
  }
  const overallMethod = normalizeEvaluationMethod(pkg);
  if ([
    EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE,
    EVALUATION_METHOD_CODES.TECHNICAL_BASED,
  ].includes(overallMethod)) {
    return TECHNICAL_EVALUATION_METHODS.SCORE;
  }
  return "";
}

function inferImportedMethod(criteria = []) {
  const imported = criteria.filter((criterion) => (
    criterion.group === "technical"
    && ["muasamcong", "custom"].includes(String(criterion.source || "").trim().toLowerCase())
  ));
  if (imported.length === 0) return "";
  return imported.some((criterion) => criterion.resultType === "score")
    ? TECHNICAL_EVALUATION_METHODS.SCORE
    : TECHNICAL_EVALUATION_METHODS.PASS_FAIL;
}

export function resolveTechnicalEvaluationMethod({
  pkg = {},
  roundType = "single",
  report = null,
  criteria = [],
  draftMethod = "",
} = {}) {
  return getForcedTechnicalEvaluationMethod(pkg)
    || normalizeTechnicalEvaluationMethod(draftMethod)
    || getStoredTechnicalEvaluationMethod(pkg, roundType)
    || normalizeTechnicalEvaluationMethod(
      report?.extension?.technicalEvaluationMethod
        || report?.extension?.phuongPhapDanhGiaKyThuat,
    )
    || inferImportedMethod(criteria);
}

export function requiresTechnicalScore(pkg = {}, roundType = "single") {
  return resolveTechnicalEvaluationMethod({ pkg, roundType })
    === TECHNICAL_EVALUATION_METHODS.SCORE;
}

export function configureBidTechnicalScoreInputs(root, pkg = {}, roundType = "single") {
  const scoreRequired = requiresTechnicalScore(pkg, roundType);
  root?.querySelectorAll?.("input.mt-dg-ky-thuat").forEach((input) => {
    if (!scoreRequired) {
      input.removeAttribute?.("data-technical-score-required");
      input.removeAttribute?.("required");
      input.removeAttribute?.("aria-required");
      return;
    }
    const current = String(input.value ?? "").trim();
    const parsed = parseTechnicalScore(current);
    const hadInvalidLegacyValue = Boolean(current) && parsed === null;
    input.type = "number";
    input.setAttribute?.("min", "0");
    input.setAttribute?.("step", "any");
    input.setAttribute?.("inputmode", "decimal");
    input.setAttribute?.("required", "true");
    input.setAttribute?.("aria-required", "true");
    input.setAttribute?.("data-technical-score-required", "true");
    input.placeholder = "Nhập điểm kỹ thuật...";
    if (current) input.value = parsed === null ? "" : String(parsed);
    if (
      hadInvalidLegacyValue
      && typeof input.dispatchEvent === "function"
      && typeof globalThis.Event === "function"
    ) {
      input.dispatchEvent(new globalThis.Event("input", { bubbles: true }));
    }
  });
  return scoreRequired;
}

export function applyTechnicalEvaluationMethod(criteria = [], method = "") {
  const normalizedMethod = normalizeTechnicalEvaluationMethod(method);
  if (!normalizedMethod) return criteria;
  return criteria.map((criterion) => criterion.group === "technical"
    ? { ...criterion, resultType: normalizedMethod === TECHNICAL_EVALUATION_METHODS.SCORE ? "score" : "pass_fail" }
    : criterion);
}
