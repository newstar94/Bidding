import { FIELD_MAP_BY_TABLE, resolveSchemaTable } from "../documents/schemaRuntime.js";

const SERVER_MANAGED_FIELDS = new Set([
  "organizationId",
  "ownerType",
  "syncVersion",
  "rowVersion",
  "createdAt",
  "updatedAt",
  "archivedAt",
  "isLatest",
  "sensitiveDataMasked"
]);

const LOCAL_ONLY_FIELDS = new Set([
  "allVersions",
  "canEdit",
  "referenceOnly",
  "expectedVersion",
  "_valid",
  "_comment",
  "_operation",
  "_procurementImportCurrent"
]);

const PROCUREMENT_AUTHORITY_TABLES = new Set(["ke_hoach_lcnt", "goi_thau"]);

const CHILD_FIELDS_BY_TABLE = {
  ke_hoach_lcnt: ["cvDaThucHienList", "cvKhongApDungList", "cvChuaDuDieuKienList"],
  goi_thau: [
    "phanLoList",
    "awardedPhanLoList",
    "tuyChonMuaThemList",
    "giaHanList",
    "yeuCauLamRoList",
    "traLoiLamRoList",
    "toChuyenGia",
    "toThamDinh",
    "timelineItems",
    "ehsmtAdjustments"
  ],
  nha_thau: ["thanhVienLienDanh"],
  thong_tin_mo_thau: ["thanhVienLienDanh", "baoCaoDanhGiaChiTietList"],
  hop_dong: ["goiThauIds"]
};

const VIRTUAL_FIELDS_BY_TABLE = {
  goi_thau: ["danhGiaHsdtMetadata"],
  thong_tin_mo_thau: [
    "danhGiaHopLe",
    "danhGiaNangLuc",
    "danhGiaKyThuat",
    "danhGiaTaiChinh",
    "giaXepHang",
    "giaDeNghiTrungThau",
    "chapThuanGiaDeNghiTrungThauDuoi50",
    "danhGiaKetLuan",
    "diemDanhGia",
    "lyDoTruot",
    "lamRoHopLe",
    "lamRoNangLuc",
    "lamRoKyThuat",
    "lamRoTaiChinh",
    "nguyenNhanKhongDatHopLe",
    "nguyenNhanKhongDatNangLuc",
    "nguyenNhanKhongDatKyThuat"
  ]
};

const BIGINT_SAFE_DECIMAL_FIELDS_BY_TABLE = {
  thong_tin_mo_thau: new Set(["giaXepHang", "giaDeNghiTrungThau"])
};

function clonePayloadValue(value) {
  if (value === void 0) return void 0;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeSystemVersion(field, value) {
  if (field !== "phienBan") return value;
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const numericVersion = Number(value);
    if (Number.isSafeInteger(numericVersion)) return numericVersion;
  }
  return value;
}

function normalizeBigintSafeDecimal(tableName, field, value) {
  if (!BIGINT_SAFE_DECIMAL_FIELDS_BY_TABLE[tableName]?.has(field) || value == null) return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value;
}

export function allowedOutboundFields(type) {
  const tableName = resolveSchemaTable(type);
  const schemaFields = Object.values(FIELD_MAP_BY_TABLE[tableName] || {})
    .filter((field) => !SERVER_MANAGED_FIELDS.has(field));
  return new Set([
    ...schemaFields,
    ...(CHILD_FIELDS_BY_TABLE[tableName] || []),
    ...(VIRTUAL_FIELDS_BY_TABLE[tableName] || [])
  ]);
}

export function unknownOutboundFields(record, type, allowedTransforms = []) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return [];
  const allowed = allowedOutboundFields(type);
  const transforms = new Set(allowedTransforms);
  return Object.keys(record).filter((field) => (
    !allowed.has(field)
    && !(field === "sourceRevision" && PROCUREMENT_AUTHORITY_TABLES.has(resolveSchemaTable(type)))
    && !SERVER_MANAGED_FIELDS.has(field)
    && !LOCAL_ONLY_FIELDS.has(field)
    && !transforms.has(field)
  ));
}

export function assertOutboundRecordFields(record, type, {
  source = "input",
  allowedTransforms = []
} = {}) {
  const unknown = unknownOutboundFields(record, type, allowedTransforms);
  if (unknown.length) {
    throw new Error(`${source} chứa field ngoài schema ${resolveSchemaTable(type)}: ${unknown.join(", ")}`);
  }
  return record;
}

export function serializeOutboundRecord(record, type, normalizeRecord = (value) => value) {
  const normalized = normalizeRecord(record, type);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;

  const serialized = {};
  const tableName = resolveSchemaTable(type);
  const allowedFields = allowedOutboundFields(type);
  allowedFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) return;
    const cloned = clonePayloadValue(normalized[field]);
    const value = normalizeBigintSafeDecimal(tableName, field, normalizeSystemVersion(field, cloned));
    if (value !== void 0) serialized[field] = value;
  });

  if (
    PROCUREMENT_AUTHORITY_TABLES.has(tableName)
    && normalized._procurementImportCurrent === true
    && normalized.sourceRevision
    && typeof normalized.sourceRevision === "object"
    && !Array.isArray(normalized.sourceRevision)
  ) {
    serialized.sourceRevision = clonePayloadValue(normalized.sourceRevision);
  }

  if (Number.isInteger(normalized.rowVersion) && normalized.rowVersion > 0) {
    serialized.expectedVersion = normalized.rowVersion;
  }
  return serialized;
}
