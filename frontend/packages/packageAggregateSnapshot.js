import { generateRecordId } from "../shared/idUtils.js";
import {
  parseTechnicalScore,
  requiresTechnicalScoreInput,
} from "./evaluationMethodRules.js";
import { parseEvaluationMetadataStrict } from "./evaluationMetadata.js";

const SERVER_FIELDS = [
  "rowVersion",
  "expectedVersion",
  "syncVersion",
  "organizationId",
  "ownerType",
  "archivedAt",
  "allVersions",
  "referenceOnly",
];

const OWNED_CHILDREN = [
  ["tuyChonMuaThemList", "tuychonmuathem"],
  ["giaHanList", "giahan"],
  ["yeuCauLamRoList", "yeucaulamro"],
  ["traLoiLamRoList", "traloilamro"],
  ["timelineItems", "timeline"],
  ["ehsmtAdjustments", "ehsmtadjustment"],
];

const PACKAGE_DATETIME_FIELDS = [
  "thoiGianDangTai",
  "thoiGianDongThau",
  "thoiGianMoThau",
  "thoiGianMoEhsdxtc",
  "createdAt",
  "updatedAt",
];

const PACKAGE_DATE_FIELDS = [
  "ngayQuyetDinh",
  "ngayQuyetDinhKetQua",
  "ngayBaoCaoThamDinhHsmt",
  "ngayTrinhHsmt",
];

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function canonicalDateTime(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`
      + ` ${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}:${padDatePart(value.getSeconds())}`;
  }
  const text = String(value || "").trim();
  if (!text) return text;
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (ymd) {
    const date = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    return ymd[4] === undefined
      ? date
      : `${date} ${ymd[4]}:${ymd[5]}:${ymd[6] || "00"}`;
  }
  const dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const date = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    return dmy[4] === undefined
      ? date
      : `${date} ${dmy[4]}:${dmy[5]}:${dmy[6] || "00"}`;
  }
  return text;
}

function normalizeClonedDates(value) {
  if (value instanceof Date) return canonicalDateTime(value);
  if (Array.isArray(value)) return value.map(normalizeClonedDates);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeClonedDates(item)]),
  );
}

function deepClone(value) {
  if (value === undefined) return undefined;
  const clone = typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
  return normalizeClonedDates(clone);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseMetadata(value) {
  return parseEvaluationMetadataStrict(value);
}

function technicalEvaluationBlock(sourcePackage) {
  const metadata = parseMetadata(sourcePackage?.danhGiaHsdtMetadata);
  return metadata.is1G2T ? metadata.technical || {} : metadata;
}

function technicalReportForOpening(sourceOpening, sourcePackage) {
  const block = technicalEvaluationBlock(sourcePackage);
  const roundId = String(block.id || block.vongDanhGiaId || "").trim();
  return asArray(sourceOpening?.baoCaoDanhGiaChiTietList).find((report) => {
    const reportRoundId = String(report?.vongDanhGiaId || report?.vong_danh_gia_id || "").trim();
    const reportType = String(report?.loaiVong || report?.loai_vong || "").trim();
    return reportType === "technical"
      || (roundId && reportRoundId === roundId)
      || reportRoundId.endsWith(":technical");
  });
}

function inheritedTechnicalScore(sourceOpening, sourcePackage) {
  if (!requiresTechnicalScoreInput(sourcePackage)) return null;
  const existingScore = parseTechnicalScore(sourceOpening?.danhGiaKyThuat);
  if (existingScore !== null) return String(existingScore);
  const report = technicalReportForOpening(sourceOpening, sourcePackage);
  if (!report) return null;
  const criteria = asArray(technicalEvaluationBlock(sourcePackage).criteria);
  const criterionIds = new Set(
    criteria
      .filter((criterion) => !criterion.group || criterion.group === "technical")
      .map((criterion) => String(criterion.id || "").trim())
      .filter(Boolean),
  );
  const numericRows = asArray(report.chiTietList || report.chi_tiet_list)
    .filter((row) => !criterionIds.size || criterionIds.has(String(
      row?.tieuChiDanhGiaId || row?.tieu_chi_danh_gia_id || "",
    )))
    .map((row) => parseTechnicalScore(row?.diem))
    .filter((score) => score !== null);
  if (numericRows.length) {
    const total = numericRows.reduce((sum, score) => sum + Number(score), 0);
    return String(total);
  }
  const reportScore = parseTechnicalScore(
    report.diemKyThuat ?? report.diem_ky_thuat ?? report.technicalScore,
  );
  return reportScore === null ? null : String(reportScore);
}

function cleanServerFields(record) {
  SERVER_FIELDS.forEach((field) => delete record[field]);
  return record;
}

function cloneOwnedRow(source, type, createId) {
  return cleanServerFields({
    ...deepClone(source || {}),
    id: createId(type),
  });
}

function normalizedLotCode(lot) {
  return String(lot?.maPhanLo || lot?.tenPhanLo || "")
    .trim()
    .toLocaleLowerCase("vi-VN");
}

function cloneEvaluationMetadata(rawMetadata, targetPackageId, createId) {
  if (!rawMetadata) return { value: rawMetadata, roundIds: new Map(), criterionIds: new Map() };
  let metadata;
  try {
    metadata = typeof rawMetadata === "string" ? JSON.parse(rawMetadata) : deepClone(rawMetadata);
  } catch {
    return { value: rawMetadata, roundIds: new Map(), criterionIds: new Map() };
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { value: rawMetadata, roundIds: new Map(), criterionIds: new Map() };
  }

  const roundIds = new Map();
  const criterionIds = new Map();
  const blocks = metadata.is1G2T
    ? [["technical", metadata.technical], ["financial", metadata.financial]]
    : [["single", metadata]];

  blocks.forEach(([roundType, block]) => {
    if (!block || typeof block !== "object") return;
    const targetRoundId = `evaluation-round:${targetPackageId}:${roundType}`;
    const oldRoundId = String(block.id || block.vongDanhGiaId || "");
    if (oldRoundId) roundIds.set(oldRoundId, targetRoundId);
    roundIds.set(roundType, targetRoundId);
    const criteria = asArray(block.criteria);
    criteria.forEach((criterion) => {
      const oldId = String(criterion?.id || "");
      const newId = createId("evaluationcriterion");
      if (oldId) criterionIds.set(oldId, newId);
      criterion.id = newId;
    });
    criteria.forEach((criterion) => {
      const parentId = String(criterion?.parentCriterionId || criterion?.tieuChiChaId || "");
      if (!parentId || !criterionIds.has(parentId)) return;
      if (Object.hasOwn(criterion, "parentCriterionId")) criterion.parentCriterionId = criterionIds.get(parentId);
      if (Object.hasOwn(criterion, "tieuChiChaId")) criterion.tieuChiChaId = criterionIds.get(parentId);
    });
  });

  return {
    value: typeof rawMetadata === "string" ? JSON.stringify(metadata) : metadata,
    roundIds,
    criterionIds,
  };
}

function clonePackageRecord(sourcePackage, options) {
  const { targetPackageId, targetPlanId, packageVersion, timestamp, overrides, createId } = options;
  const packageRecord = cleanServerFields({
    ...deepClone(sourcePackage),
    ...deepClone(overrides || {}),
    id: targetPackageId,
    rootId: sourcePackage.rootId || sourcePackage.id,
    phienBan: packageVersion,
    isLatest: 1,
    keHoachId: targetPlanId,
    createdAt: sourcePackage.createdAt || timestamp,
    updatedAt: timestamp,
  });
  PACKAGE_DATETIME_FIELDS.forEach((field) => {
    if (packageRecord[field] !== undefined && packageRecord[field] !== null) {
      packageRecord[field] = canonicalDateTime(packageRecord[field]);
    }
  });
  PACKAGE_DATE_FIELDS.forEach((field) => {
    if (packageRecord[field] !== undefined && packageRecord[field] !== null) {
      packageRecord[field] = canonicalDateTime(packageRecord[field]).slice(0, 10);
    }
  });

  const oldLots = asArray(sourcePackage.phanLoList);
  const selectedLots = asArray(packageRecord.phanLoList);
  const oldLotsByCode = new Map(oldLots.map((lot) => [normalizedLotCode(lot), lot]));
  const lotIds = new Map();
  packageRecord.phanLoList = selectedLots.map((lot) => {
    const clone = cloneOwnedRow(lot, "phanlo", createId);
    const sourceLot = oldLots.find((candidate) => String(candidate.id) === String(lot.id))
      || oldLotsByCode.get(normalizedLotCode(lot));
    if (sourceLot?.id) lotIds.set(String(sourceLot.id), clone.id);
    return clone;
  });
  const targetLotsByCode = new Map(packageRecord.phanLoList.map((lot) => [normalizedLotCode(lot), lot]));
  packageRecord.awardedPhanLoList = asArray(packageRecord.awardedPhanLoList).map((award) => {
    const sourceLot = oldLots.find((lot) => String(lot.id) === String(award.id))
      || oldLotsByCode.get(normalizedLotCode(award));
    const targetLot = (sourceLot?.id && packageRecord.phanLoList.find((lot) => lot.id === lotIds.get(String(sourceLot.id))))
      || targetLotsByCode.get(normalizedLotCode(award));
    return cleanServerFields({ ...deepClone(award), id: targetLot?.id || createId("phanlo") });
  });
  OWNED_CHILDREN.forEach(([field, type]) => {
    packageRecord[field] = asArray(packageRecord[field]).map((row) => cloneOwnedRow(row, type, createId));
  });
  packageRecord.timelineItems.forEach((item) => {
    const sourceId = String(item.sourceEntityId || "");
    if (lotIds.has(sourceId)) item.sourceEntityId = lotIds.get(sourceId);
  });

  const metadata = cloneEvaluationMetadata(packageRecord.danhGiaHsdtMetadata, targetPackageId, createId);
  if (metadata.value === undefined) delete packageRecord.danhGiaHsdtMetadata;
  else packageRecord.danhGiaHsdtMetadata = metadata.value;
  return { packageRecord, lotIds, roundIds: metadata.roundIds, criterionIds: metadata.criterionIds };
}

function cloneGoods(state, sourcePackage, packageRecord, lotIds, createId) {
  const goodsIds = new Map();
  const rows = asArray(state.goithauhanghoa)
    .filter((row) => String(row.goiThauId) === String(sourcePackage.id))
    .map((row) => {
      const clone = cloneOwnedRow(row, "goithauhanghoa", createId);
      clone.goiThauId = packageRecord.id;
      clone.phanLoId = row.phanLoId ? (lotIds.get(String(row.phanLoId)) || null) : null;
      goodsIds.set(String(row.id), clone.id);
      return clone;
    });
  return { rows, goodsIds };
}

function cloneOpenings(state, sourcePackage, packageRecord, mappings, createId) {
  const openingIds = new Map();
  const rows = asArray(state.thongtinmothau)
    .filter((row) => String(row.goiThauId) === String(sourcePackage.id))
    .map((row) => {
      const clone = cloneOwnedRow(row, "thongtinmothau", createId);
      const score = inheritedTechnicalScore(row, sourcePackage);
      if (score !== null) clone.danhGiaKyThuat = score;
      openingIds.set(String(row.id), clone.id);
      clone.goiThauId = packageRecord.id;
      clone.phanLoId = row.phanLoId ? (mappings.lotIds.get(String(row.phanLoId)) || null) : row.phanLoId;
      clone.thanhVienLienDanh = asArray(clone.thanhVienLienDanh)
        .map((member) => cloneOwnedRow(member, "thong_tin_mo_thau_lien_danh_thanh_vien", createId));
      clone.baoCaoDanhGiaChiTietList = asArray(clone.baoCaoDanhGiaChiTietList).map((report) => {
        const reportClone = cloneOwnedRow(report, "detailedevaluation", createId);
        const roundType = String(report.loaiVong || "single");
        reportClone.vongDanhGiaId = mappings.roundIds.get(String(report.vongDanhGiaId || ""))
          || mappings.roundIds.get(roundType)
          || `evaluation-round:${packageRecord.id}:${roundType}`;
        reportClone.chiTietList = asArray(reportClone.chiTietList).map((detail) => {
          const detailClone = cloneOwnedRow(detail, "detailedevaluationrow", createId);
          const criterionId = String(detail.tieuChiDanhGiaId || "");
          detailClone.tieuChiDanhGiaId = mappings.criterionIds.get(criterionId) || criterionId;
          return detailClone;
        });
        return reportClone;
      });
      return clone;
    });
  return { rows, openingIds };
}

function cloneBidderGoods(state, sourcePackage, packageRecord, mappings, createId) {
  return asArray(state.hanghoaduthaunhathau)
    .filter((row) => String(row.goiThauId) === String(sourcePackage.id))
    .map((row) => {
      const clone = cloneOwnedRow(row, "hanghoaduthaunhathau", createId);
      clone.goiThauId = packageRecord.id;
      clone.thongTinMoThauId = mappings.openingIds.get(String(row.thongTinMoThauId || "")) || row.thongTinMoThauId;
      clone.phanLoId = row.phanLoId ? (mappings.lotIds.get(String(row.phanLoId)) || null) : null;
      clone.goiThauHangHoaId = row.goiThauHangHoaId
        ? (mappings.goodsIds.get(String(row.goiThauHangHoaId)) || null)
        : null;
      return clone;
    });
}

export function snapshotPackageAggregate(state, sourcePackage, {
  targetPackageId = generateRecordId("goithau"),
  targetPlanId = sourcePackage?.keHoachId,
  packageVersion = sourcePackage?.phienBan || "00",
  timestamp = new Date().toISOString(),
  overrides = {},
  createId = generateRecordId,
} = {}) {
  if (!sourcePackage?.id || !targetPlanId) {
    throw new Error("Không đủ dữ liệu để tạo snapshot gói thầu.");
  }
  const packageClone = clonePackageRecord(sourcePackage, {
    targetPackageId, targetPlanId, packageVersion, timestamp, overrides, createId,
  });
  const goods = cloneGoods(state, sourcePackage, packageClone.packageRecord, packageClone.lotIds, createId);
  const openings = cloneOpenings(state, sourcePackage, packageClone.packageRecord, {
    ...packageClone,
    goodsIds: goods.goodsIds,
  }, createId);
  const bidderGoods = cloneBidderGoods(state, sourcePackage, packageClone.packageRecord, {
    ...packageClone,
    goodsIds: goods.goodsIds,
    openingIds: openings.openingIds,
  }, createId);
  const assignments = asArray(state.assignments)
    .filter((row) => row.type === "goithau" && String(row.targetId) === String(sourcePackage.id))
    .map((row) => cloneOwnedRow(row, "assignments", createId))
    .map((row) => ({ ...row, targetId: packageClone.packageRecord.id }));

  return {
    packageRecord: packageClone.packageRecord,
    goithauhanghoa: goods.rows,
    thongtinmothau: openings.rows,
    hanghoaduthaunhathau: bidderGoods,
    assignments,
    mappings: {
      packageIds: new Map([[String(sourcePackage.id), packageClone.packageRecord.id]]),
      lotIds: packageClone.lotIds,
      goodsIds: goods.goodsIds,
      openingIds: openings.openingIds,
      roundIds: packageClone.roundIds,
      criterionIds: packageClone.criterionIds,
    },
  };
}
