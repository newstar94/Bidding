import timelineCatalog from "../../shared/timeline_rules.json" with { type: "json" };
import { buildVersionEhsmtAdjustment } from "../shared/VersionedEntityService.js";

export const TIMELINE_TEMPLATE_VERSION = timelineCatalog.catalogVersion;

const SECTION_BY_KEY = new Map(timelineCatalog.sections.map((section) => [section.sectionKey, section]));
const MANDATORY_TWO_ENVELOPE_MILESTONES = new Set([
  "DOCUMENT_RECONCILIATION_INVITATION",
  "DOCUMENT_RECONCILIATION_MINUTES",
  "CONTRACT_NEGOTIATION",
  "CONTRACTOR_SELECTION_RESULT_APPRAISAL",
  "TECHNICAL_RESULT_APPRAISAL"
]);

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase("vi").replace(/\s+/g, " ");
}

function firstValue(record, keys = []) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function listValue(record, keys = []) {
  for (const key of keys) {
    if (Array.isArray(record?.[key])) return record[key];
  }
  return [];
}

function canonicalFact(group, value) {
  const target = normalized(value);
  if (!target) return "UNDETERMINED";
  const mappings = timelineCatalog.factMappings[group] || {};
  for (const [code, aliases] of Object.entries(mappings)) {
    if (code === value || aliases.some((alias) => normalized(alias) === target)) return code;
  }
  return "UNDETERMINED";
}

export function canonicalTimelineFacts(packageData = {}, planData = {}) {
  return Object.freeze({
    selectionMethod: canonicalFact("selectionMethod", firstValue(packageData, ["hinhThucLuaChonCode", "hinh_thuc_lua_chon_code", "hinhThucLuaChon", "hinh_thuc_lua_chon"])),
    selectionProcedure: canonicalFact("selectionProcedure", firstValue(packageData, ["phuongThucLuaChonCode", "phuong_thuc_lua_chon_code", "phuongThucLuaChon", "phuong_thuc_lua_chon"])),
    planApproval: canonicalFact("planApproval", firstValue(planData, ["pheDuyetCode", "phe_duyet_code", "pheDuyet", "phe_duyet"])),
    packageField: String(firstValue(packageData, ["linhVuc", "linh_vuc"]) || "")
  });
}

export function normalizeEhsmtAppraisalRequirement(packageData = {}) {
  const coded = String(firstValue(packageData, ["yeuCauThamDinhHsmtCode", "yeu_cau_tham_dinh_hsmt_code"]) || "").toUpperCase();
  if (timelineCatalog.appraisalRequirementStates.includes(coded)) return coded;
  const legacy = firstValue(packageData, ["yeuCauThamDinhHsmt", "yeu_cau_tham_dinh_hsmt"]);
  if (legacy === true || legacy === 1 || ["có", "co", "required", "true", "1"].includes(normalized(legacy))) return "REQUIRED";
  if (legacy === false || legacy === 0 || ["không", "khong", "not_required", "false", "0"].includes(normalized(legacy))) return "NOT_REQUIRED";
  return "UNDETERMINED";
}

function parseMetadata(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function contractKind(contract) {
  const label = normalized(firstValue(contract, ["phanLoai", "phan_loai"]));
  if (["tư vấn", "tu van", "consulting"].includes(label) || label.includes("tvl") || label.includes("tư vấn lập")) return "preparation";
  if (["thẩm định", "tham dinh", "appraisal"].includes(label) || label.includes("tvt") || label.includes("tư vấn thẩm")) return "appraisal";
  return "";
}

function hasAppointmentDecision(contract = {}) {
  const flag = firstValue(contract, ["coQdChiDinh", "co_qd_chi_dinh"]);
  if (flag !== "") return flag === true || flag === 1 || ["1", "true", "có", "co"].includes(normalized(flag));
  return Boolean(firstValue(contract, ["soQdChiDinh", "so_qd_chi_dinh", "ngayQdChiDinh", "ngay_qd_chi_dinh"]));
}

function activeRecords(items) {
  return (Array.isArray(items) ? items : []).filter((item) => !firstValue(item, ["archivedAt", "archived_at", "deletedAt", "deleted_at"]));
}

function buildRelated(packageData, relatedEntities = {}) {
  const contracts = activeRecords(relatedEntities.contracts || relatedEntities.hopDong || []);
  const metadata = parseMetadata(firstValue(packageData, ["danhGiaHsdtMetadata", "danh_gia_hsdt_metadata"]));
  const technical = metadata.technical && typeof metadata.technical === "object" ? metadata.technical : metadata;
  const rawAdjustments = relatedEntities.ehsmtAdjustments || listValue(packageData, ["ehsmtAdjustments", "ehsmt_adjustments"]);
  const versionAdjustment = buildVersionEhsmtAdjustment({
    id: firstValue(packageData, ["id"]),
    phienBan: firstValue(packageData, ["phienBan", "phien_ban"]),
    soQuyetDinh: firstValue(packageData, ["soQuyetDinh", "so_quyet_dinh"]),
    ngayQuyetDinh: firstValue(packageData, ["ngayQuyetDinh", "ngay_quyet_dinh"]),
    thoiGianDangTai: firstValue(packageData, ["thoiGianDangTai", "thoi_gian_dang_tai"])
  });
  const hasVersionAdjustment = versionAdjustment && rawAdjustments.some((item) => (
    String(firstValue(item, ["id"]) || "") === versionAdjustment.id
    || Number(firstValue(item, ["sequence", "thuTu", "thu_tu"])) === versionAdjustment.sequence
  ));
  const inferredAdjustments = versionAdjustment && !hasVersionAdjustment
    ? [...rawAdjustments, versionAdjustment]
    : rawAdjustments;
  const result = {
    ...relatedEntities,
    contracts,
    preparationContract: contracts.find((item) => contractKind(item) === "preparation") || {},
    appraisalContract: contracts.find((item) => contractKind(item) === "appraisal") || {},
    technicalEvaluation: relatedEntities.technicalEvaluation || technical || {},
    financialEvaluation: relatedEntities.financialEvaluation || metadata.financial || {},
    resultEvaluation: relatedEntities.resultEvaluation || metadata.result || {},
    ehsmtAdjustments: activeRecords(inferredAdjustments),
    clarificationRequests: activeRecords(relatedEntities.clarificationRequests || listValue(packageData, ["yeuCauLamRoList", "yeu_cau_lam_ro_list"])),
    clarificationResponses: activeRecords(relatedEntities.clarificationResponses || listValue(packageData, ["traLoiLamRoList", "tra_loi_lam_ro_list"])),
    extensions: activeRecords(relatedEntities.extensions || listValue(packageData, ["giaHanList", "gia_han_list"])),
    expertTeam: relatedEntities.expertTeam || listValue(packageData, ["toChuyenGia", "to_chuyen_gia"]),
    appraisalTeam: relatedEntities.appraisalTeam || listValue(packageData, ["toThamDinh", "to_tham_dinh"])
  };
  result.effectiveClosingTime = resolveLatestBidClosingTime(packageData, { extensions: result.extensions });
  return result;
}

function sourceRecord(definition, packageData, planData, related, entity) {
  const source = definition.source || {};
  if (source.entity) return entity || {};
  if (source.record === "package") return packageData;
  if (source.record === "plan") return planData;
  return related[source.record] || {};
}

function isoDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : "";
}

function dateTimeValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}T${dmy[4] || "00"}:${dmy[5] || "00"}:00` : "";
}

export function resolveLatestBidClosingTime(packageData = {}, relatedEntities = {}) {
  const extensions = relatedEntities.extensions || relatedEntities.giaHanList || relatedEntities.gia_han_list || [];
  const candidates = [
    firstValue(packageData, ["thoiGianDongThau", "thoi_gian_dong_thau"]),
    ...activeRecords(extensions).map((item) => firstValue(item, ["thoiGianDongThau", "thoi_gian_dong_thau"]))
  ].map(dateTimeValue).filter(Boolean);
  return candidates.sort((left, right) => left.localeCompare(right)).at(-1) || "";
}

function sourceValues(definition, packageData, planData, related, entity) {
  if (!definition.source) return { number: "", date: "", sourceKey: "" };
  const record = sourceRecord(definition, packageData, planData, related, entity);
  return {
    number: String(firstValue(record, definition.source.numberFields) || ""),
    date: isoDate(firstValue(record, definition.source.dateFields)),
    sourceKey: definition.source.entity
      ? `${definition.source.entity}.${String(firstValue(record, ["id"]) || "")}`
      : String(definition.source.record || "")
  };
}

function hasMeaningfulSavedData(saved = {}) {
  return Boolean(firstValue(saved, ["soVanBan", "so_van_ban", "ngayDuKien", "ngay_du_kien", "ngayThucTe", "ngay_thuc_te"]))
    || ["IN_PROGRESS", "DONE"].includes(String(firstValue(saved, ["trangThai", "trang_thai"]) || "").toUpperCase());
}

function hasAppraisalEvidence(packageData, related) {
  return Boolean(
    firstValue(packageData, ["soBaoCaoThamDinhHsmt", "so_bao_cao_tham_dinh_hsmt", "ngayBaoCaoThamDinhHsmt", "ngay_bao_cao_tham_dinh_hsmt"])
    || Object.keys(related.appraisalContract || {}).length
    || (related.appraisalTeam || []).length
  );
}

function isConsultingPackage(facts) {
  return ["tư vấn", "tu van", "consulting", "tu_van"].includes(normalized(facts.packageField));
}

function hasPreparationProcessEvidence(facts, related, hasData) {
  return (related.expertTeam || []).length || isConsultingPackage(facts) || hasData;
}

function hasAppraisalProcessEvidence(facts, related, hasData) {
  return (related.appraisalTeam || []).length || isConsultingPackage(facts) || hasData;
}

function timelineTitle(definition, facts) {
  if (definition.milestoneKey === "BID_EVALUATION_REPORT") {
    if (facts.selectionProcedure === "ONE_STAGE_ONE_ENVELOPE") return "Báo cáo đánh giá E-HSDT";
    if (facts.selectionProcedure === "ONE_STAGE_TWO_ENVELOPES") return "Báo cáo đánh giá E-HSĐXKT";
  }
  if (definition.milestoneKey === "DOCUMENT_RECONCILIATION_INVITATION" && facts.selectionProcedure === "ONE_STAGE_TWO_ENVELOPES") {
    return "Thư mời đối chiếu tài liệu/Thương thảo hợp đồng";
  }
  return definition.title;
}

function ruleResult(definition, context) {
  const { facts, packageData, related, saved, source } = context;
  const tags = new Set(definition.tags || []);
  const hasData = hasMeaningfulSavedData(saved) || Boolean(source.number || source.date);

  if (definition.applicabilityRule === "CONSULTANT_PREPARATION_APPOINTMENT") {
    if (String(related.preparationConsultantMode || "").toUpperCase() === "INTERNAL") {
      return ["NOT_APPLICABLE", "EXCLUDED_BY_INTERNAL_PREPARATION"];
    }
    if (hasAppointmentDecision(related.preparationContract)) return ["APPLICABLE", "INCLUDED_BY_PREPARATION_APPOINTMENT_DECISION"];
    return hasPreparationProcessEvidence(facts, related, hasData)
      ? ["APPLICABLE", "INCLUDED_BY_PREPARATION_CONSULTANT_PROCESS"]
      : ["NOT_APPLICABLE", "EXCLUDED_WITHOUT_PREPARATION_APPOINTMENT_DECISION"];
  }
  if (definition.applicabilityRule === "CONSULTANT_APPRAISAL_APPOINTMENT") {
    if (String(related.appraisalConsultantMode || "").toUpperCase() === "INTERNAL") {
      return ["NOT_APPLICABLE", "EXCLUDED_BY_INTERNAL_APPRAISAL"];
    }
    if (hasAppointmentDecision(related.appraisalContract)) return ["APPLICABLE", "INCLUDED_BY_APPRAISAL_APPOINTMENT_DECISION"];
    return hasAppraisalProcessEvidence(facts, related, hasData)
      ? ["APPLICABLE", "INCLUDED_BY_APPRAISAL_CONSULTANT_PROCESS"]
      : ["NOT_APPLICABLE", "EXCLUDED_WITHOUT_APPRAISAL_APPOINTMENT_DECISION"];
  }

  if (facts.selectionMethod === "COMPETITIVE_OFFERING" && tags.has("APPRAISAL")) {
    return ["NOT_APPLICABLE", "EXCLUDED_BY_COMPETITIVE_OFFERING"];
  }
  if (facts.selectionProcedure === "ONE_STAGE_ONE_ENVELOPE" && tags.has("TWO_ENVELOPE_ONLY")) {
    return ["NOT_APPLICABLE", "EXCLUDED_BY_ONE_STAGE_ONE_ENVELOPE"];
  }
  if (["DIRECT_APPOINTMENT", "DIRECT_APPOINTMENT_SIMPLIFIED"].includes(facts.selectionMethod) && tags.has("COMPETITIVE_TENDER")) {
    return ["NOT_APPLICABLE", "EXCLUDED_BY_DIRECT_APPOINTMENT"];
  }
  if (facts.selectionMethod === "DIRECT_APPOINTMENT_SIMPLIFIED" && tags.has("APPRAISAL")) {
    return ["NOT_APPLICABLE", "EXCLUDED_BY_SIMPLIFIED_DIRECT_APPOINTMENT"];
  }
  if (facts.selectionProcedure === "ONE_STAGE_TWO_ENVELOPES" && MANDATORY_TWO_ENVELOPE_MILESTONES.has(definition.milestoneKey)) {
    return ["APPLICABLE", "INCLUDED_BY_ONE_STAGE_TWO_ENVELOPES"];
  }
  if (definition.applicabilityRule === "CONTRACT_NEGOTIATION") {
    const isEligible = facts.selectionMethod === "DIRECT_APPOINTMENT_SIMPLIFIED"
      || facts.selectionProcedure === "ONE_STAGE_TWO_ENVELOPES"
      || isConsultingPackage(facts);
    if (!isEligible) return ["NOT_APPLICABLE", "EXCLUDED_BY_CONTRACT_NEGOTIATION_SCOPE"];
    return hasData
      ? ["APPLICABLE", "INCLUDED_BY_CONTRACT_NEGOTIATION_DATA"]
      : ["CONDITIONAL", "WAITING_FOR_CONTRACT_NEGOTIATION_DATA"];
  }
  if (facts.selectionMethod === "DIRECT_APPOINTMENT_SIMPLIFIED" && tags.has("OPTIONAL") && !hasData) {
    return ["NOT_APPLICABLE", "EXCLUDED_BY_SIMPLIFIED_DIRECT_APPOINTMENT"];
  }
  if (definition.applicabilityRule === "PLAN_SEPARATE") {
    if (facts.planApproval === "COMBINED") return ["NOT_APPLICABLE", "EXCLUDED_BY_COMBINED_PLAN"];
    if (facts.planApproval === "SEPARATE") return ["APPLICABLE", "INCLUDED_BY_SEPARATE_PLAN"];
    return ["CONDITIONAL", "WAITING_FOR_PLAN_APPROVAL_MODE"];
  }
  if (definition.applicabilityRule === "PLAN_COMBINED") {
    if (facts.planApproval === "SEPARATE") return ["NOT_APPLICABLE", "EXCLUDED_BY_SEPARATE_PLAN"];
    if (facts.planApproval === "COMBINED") return ["APPLICABLE", "INCLUDED_BY_COMBINED_PLAN"];
    return ["CONDITIONAL", "WAITING_FOR_PLAN_APPROVAL_MODE"];
  }
  if (definition.applicabilityRule === "E_HSMT_APPRAISAL") {
    const decision = normalizeEhsmtAppraisalRequirement(packageData);
    const evidence = hasAppraisalEvidence(packageData, related) || hasData;
    if (decision === "NOT_REQUIRED" && evidence) return ["CONDITIONAL", "CONFLICT_E_HSMT_APPRAISAL_DATA"];
    if (decision === "NOT_REQUIRED") return ["NOT_APPLICABLE", "EXCLUDED_BY_E_HSMT_APPRAISAL_DECISION"];
    if (decision === "REQUIRED" || evidence) return ["APPLICABLE", evidence ? "INCLUDED_BY_APPRAISAL_DATA" : "INCLUDED_BY_E_HSMT_APPRAISAL_DECISION"];
    return ["CONDITIONAL", "WAITING_FOR_E_HSMT_APPRAISAL_DECISION"];
  }
  if (definition.applicabilityRule === "TWO_ENVELOPE") {
    if (facts.selectionProcedure === "ONE_STAGE_TWO_ENVELOPES") return ["APPLICABLE", "INCLUDED_BY_ONE_STAGE_TWO_ENVELOPES"];
    if (facts.selectionProcedure === "UNDETERMINED") return ["CONDITIONAL", "WAITING_FOR_SELECTION_PROCEDURE"];
    return ["NOT_APPLICABLE", "EXCLUDED_BY_SELECTION_PROCEDURE"];
  }
  if (definition.applicabilityRule === "TECHNICAL_APPRAISAL") {
    if (facts.selectionProcedure !== "ONE_STAGE_TWO_ENVELOPES") {
      return facts.selectionProcedure === "UNDETERMINED"
        ? ["CONDITIONAL", "WAITING_FOR_SELECTION_PROCEDURE"]
        : ["NOT_APPLICABLE", "EXCLUDED_BY_SELECTION_PROCEDURE"];
    }
    return hasData ? ["APPLICABLE", "INCLUDED_BY_TECHNICAL_APPRAISAL_DATA"] : ["CONDITIONAL", "WAITING_FOR_TECHNICAL_APPRAISAL_DATA"];
  }
  if (definition.applicabilityRule === "CONSULTANT_PREPARATION") {
    const mode = String(related.preparationConsultantMode || "").toUpperCase();
    if (mode === "INTERNAL") return ["NOT_APPLICABLE", "EXCLUDED_BY_INTERNAL_PREPARATION"];
    if (Object.keys(related.preparationContract || {}).length) return ["APPLICABLE", "INCLUDED_BY_PREPARATION_CONSULTANT_DATA"];
    if (hasPreparationProcessEvidence(facts, related, hasData)) return ["APPLICABLE", "INCLUDED_BY_PREPARATION_CONSULTANT_PROCESS"];
    return ["NOT_APPLICABLE", "EXCLUDED_WITHOUT_PREPARATION_CONSULTANT_CONTRACT"];
  }
  if (definition.applicabilityRule === "CONSULTANT_APPRAISAL") {
    const mode = String(related.appraisalConsultantMode || "").toUpperCase();
    if (mode === "INTERNAL") return ["NOT_APPLICABLE", "EXCLUDED_BY_INTERNAL_APPRAISAL"];
    if (Object.keys(related.appraisalContract || {}).length) return ["APPLICABLE", "INCLUDED_BY_APPRAISAL_CONSULTANT_DATA"];
    if (hasAppraisalProcessEvidence(facts, related, hasData)) return ["APPLICABLE", "INCLUDED_BY_APPRAISAL_CONSULTANT_PROCESS"];
    return ["NOT_APPLICABLE", "EXCLUDED_WITHOUT_APPRAISAL_CONSULTANT_CONTRACT"];
  }
  if (definition.applicabilityRule === "EXPERT_TEAM") {
    return hasPreparationProcessEvidence(facts, related, hasData)
      ? ["APPLICABLE", "INCLUDED_BY_EXPERT_TEAM_DATA"]
      : ["CONDITIONAL", "WAITING_FOR_EXPERT_TEAM_DATA"];
  }
  if (definition.applicabilityRule === "APPRAISAL_TEAM") {
    if (!Object.keys(related.appraisalContract || {}).length && !(related.appraisalTeam || []).length && !isConsultingPackage(facts) && !hasData) {
      return ["NOT_APPLICABLE", "EXCLUDED_WITHOUT_APPRAISAL_CONSULTANT_CONTRACT"];
    }
    return hasAppraisalProcessEvidence(facts, related, hasData)
      ? ["APPLICABLE", "INCLUDED_BY_APPRAISAL_TEAM_DATA"]
      : ["CONDITIONAL", "WAITING_FOR_APPRAISAL_TEAM_DATA"];
  }
  if (["OPTIONAL_WHEN_DATA", "OPTIONAL_APPRAISAL"].includes(definition.applicabilityRule)) {
    return hasData ? ["APPLICABLE", "INCLUDED_BY_BUSINESS_DATA"] : ["CONDITIONAL", "WAITING_FOR_OPTIONAL_BUSINESS_DATA"];
  }
  if (definition.applicabilityRule === "STANDARD_TENDER") {
    if (facts.selectionMethod === "SPECIAL_SELECTION") return hasData
      ? ["APPLICABLE", "INCLUDED_BY_SPECIAL_SELECTION_DATA"]
      : ["CONDITIONAL", "WAITING_FOR_SPECIAL_SELECTION_PLAN"];
    return ["APPLICABLE", "INCLUDED_BY_STANDARD_TENDER"];
  }
  return ["APPLICABLE", "DEFAULT_APPLICABLE"];
}

function savedIndex(savedEntries) {
  const byStableKey = new Map();
  const byLegacyCode = new Map();
  for (const entry of Array.isArray(savedEntries) ? savedEntries : []) {
    const milestoneKey = String(firstValue(entry, ["milestoneKey", "milestone_key"]) || "");
    const instanceKey = String(firstValue(entry, ["instanceKey", "instance_key"]) || "");
    if (milestoneKey) byStableKey.set(`${milestoneKey}\u0000${instanceKey}`, entry);
    const legacy = String(firstValue(entry, ["maMoc", "ma_moc"]) || "");
    if (legacy && !byLegacyCode.has(legacy)) byLegacyCode.set(legacy, entry);
  }
  return { byStableKey, byLegacyCode };
}

function entitySortValue(entity, index) {
  const sequence = Number(firstValue(entity, ["sequence", "thuTu", "thu_tu", "sortOrder", "sort_order"]));
  const date = String(firstValue(entity, ["approvalDecisionDate", "approval_decision_date", "thoiGian", "thoi_gian", "createdAt", "created_at"]) || "");
  return [Number.isFinite(sequence) && sequence > 0 ? sequence : 100000 + index, date, String(firstValue(entity, ["id"]) || index)];
}

function compareTuple(left, right) {
  return left[0] - right[0] || left[1].localeCompare(right[1]) || left[2].localeCompare(right[2]);
}

function repeatableEntities(definition, related) {
  const key = definition.source?.entity;
  const seen = new Set();
  return activeRecords(related[key]).filter((entity, index) => {
    const stableId = String(firstValue(entity, ["id"]) || `${key}-${index}`);
    if (seen.has(stableId)) return false;
    seen.add(stableId);
    return true;
  }).map((entity, index) => ({ entity, index, sort: entitySortValue(entity, index) }))
    .sort((left, right) => compareTuple(left.sort, right.sort));
}

function createRow(definition, entity, ordinal, packageData, planData, related, indexes) {
  const section = SECTION_BY_KEY.get(definition.sectionKey);
  const instanceKey = definition.repeatable ? String(firstValue(entity, ["id"]) || `${definition.milestoneKey}-${ordinal}`) : "";
  const stableKey = `${definition.milestoneKey}\u0000${instanceKey}`;
  const legacyCode = String(definition.legacyCodes?.[0] || `${section.displayPrefix}.0`);
  const saved = indexes.byStableKey.get(stableKey)
    || (!definition.repeatable ? indexes.byLegacyCode.get(legacyCode) : null)
    || {};
  const source = sourceValues(definition, packageData, planData, related, entity);
  const storedSourceMode = String(firstValue(saved, ["sourceMode", "source_mode"]) || (definition.source ? "AUTO" : "MANUAL")).toUpperCase();
  const number = storedSourceMode === "MANUAL" ? firstValue(saved, ["soVanBan", "so_van_ban"]) : source.number;
  const actualDate = storedSourceMode === "MANUAL" ? firstValue(saved, ["ngayThucTe", "ngay_thuc_te"]) : source.date;
  const facts = canonicalTimelineFacts(packageData, planData);
  const [applicability, applicabilityReason] = ruleResult(definition, { facts, packageData, related, saved, source });
  const entitySequence = Number(firstValue(entity, ["sequence", "thuTu", "thu_tu"]));
  const repeatableOrdinal = Number.isFinite(entitySequence) && entitySequence > 0 ? entitySequence : ordinal;
  const baseTitle = timelineTitle(definition, facts);
  const title = definition.repeatable && repeatableOrdinal > 0 ? `${baseTitle} lần ${repeatableOrdinal}` : baseTitle;
  const row = {
    ...saved,
    id: String(firstValue(saved, ["id"]) || `${definition.milestoneKey}:${instanceKey || "base"}`),
    milestoneKey: definition.milestoneKey,
    instanceKey,
    displayCode: "",
    displayGroupCode: "",
    title,
    sectionKey: definition.sectionKey,
    applicability,
    applicabilityReason,
    status: String(firstValue(saved, ["status", "trangThai", "trang_thai"]) || (actualDate ? "DONE" : "PENDING")).toUpperCase(),
    source: source.sourceKey,
    sourceEntityId: definition.repeatable ? instanceKey : "",
    effectiveClosingTime: related.effectiveClosingTime || "",
    savedEntry: Object.keys(saved).length ? { ...saved } : null,
    isRepeatable: Boolean(definition.repeatable),
    sortOrder: Number(definition.sortAnchor) + (definition.repeatable ? ordinal / 100 : 0),
    templateVersion: timelineCatalog.catalogVersion,
    tags: [...(definition.tags || [])],
    maNhom: section.legacyCode,
    tenNhom: section.title,
    maMoc: legacyCode,
    congViec: title,
    donViBanHanh: String(firstValue(saved, ["donViBanHanh", "don_vi_ban_hanh"]) || definition.issuer || ""),
    soVanBan: String(number || ""),
    ngayDuKien: isoDate(firstValue(saved, ["ngayDuKien", "ngay_du_kien"])),
    ngayThucTe: isoDate(actualDate),
    ghiChu: String(firstValue(saved, ["ghiChu", "ghi_chu"]) || ""),
    sourceKey: source.sourceKey || String(firstValue(saved, ["sourceKey", "source_key"]) || ""),
    sourceMode: storedSourceMode,
    isOptional: (definition.tags || []).includes("OPTIONAL"),
    trangThai: String(firstValue(saved, ["trangThai", "trang_thai", "status"]) || (actualDate ? "DONE" : "PENDING")).toUpperCase()
  };
  return row;
}

function romanNumeral(value) {
  const pairs = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let remaining = Number(value) || 0;
  let result = "";
  for (const [amount, symbol] of pairs) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result;
}

function assignDisplayCodes(rows) {
  const counters = new Map();
  const visibleSections = new Set(rows.filter((row) => row.applicability !== "NOT_APPLICABLE").map((row) => row.sectionKey));
  const sectionNumbers = new Map(
    timelineCatalog.sections
      .filter((section) => visibleSections.has(section.sectionKey))
      .map((section, index) => [section.sectionKey, index + 1])
  );
  return rows.map((row) => {
    if (row.applicability === "NOT_APPLICABLE") return { ...row, displayCode: "", displayGroupCode: "" };
    const sectionNumber = sectionNumbers.get(row.sectionKey);
    const next = (counters.get(row.sectionKey) || 0) + 1;
    counters.set(row.sectionKey, next);
    return { ...row, displayCode: `${sectionNumber}.${next}`, displayGroupCode: romanNumeral(sectionNumber) };
  });
}

export function buildEffectiveTimeline(packageData = {}, relatedEntities = {}, savedEntries = [], options = {}) {
  const packageCopy = structuredClone(packageData || {});
  const planData = structuredClone(relatedEntities?.plan || {});
  const related = buildRelated(packageCopy, structuredClone(relatedEntities || {}));
  const indexes = savedIndex(structuredClone(savedEntries || []));
  const rows = [];
  for (const definition of timelineCatalog.milestones) {
    if (definition.repeatable) {
      repeatableEntities(definition, related).forEach(({ entity }, index) => {
        rows.push(createRow(definition, entity, index + 1, packageCopy, planData, related, indexes));
      });
    } else {
      rows.push(createRow(definition, null, 0, packageCopy, planData, related, indexes));
    }
  }
  rows.sort((left, right) => left.sortOrder - right.sortOrder || left.milestoneKey.localeCompare(right.milestoneKey) || left.instanceKey.localeCompare(right.instanceKey));
  const numbered = assignDisplayCodes(rows);
  return options.includeNotApplicable ? numbered : numbered.filter((row) => row.applicability !== "NOT_APPLICABLE");
}

export function mergeSavedTimelineEntries(existingEntries = [], effectiveRows = []) {
  const updated = new Map(effectiveRows.map((row) => [`${row.milestoneKey}\u0000${row.instanceKey || ""}`, row]));
  const retained = [];
  for (const entry of Array.isArray(existingEntries) ? existingEntries : []) {
    const key = `${firstValue(entry, ["milestoneKey", "milestone_key"])}\u0000${firstValue(entry, ["instanceKey", "instance_key"])}`;
    const replacement = updated.get(key);
    if (replacement) {
      retained.push(replacement);
      updated.delete(key);
    } else {
      retained.push(entry);
    }
  }
  retained.push(...updated.values());
  return retained;
}

export function timelineProgress(rows = []) {
  const applicable = rows.filter((row) => row.applicability === "APPLICABLE");
  const completed = applicable.filter((row) => ["DONE", "COMPLETED"].includes(String(row.status || row.trangThai || "").toUpperCase())).length;
  return { completed, total: applicable.length, ratio: applicable.length ? completed / applicable.length : 0 };
}
