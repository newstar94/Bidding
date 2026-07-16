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
  "_operation"
]);

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
    "toThamDinh"
  ],
  nha_thau: ["thanhVienLienDanh"],
  thong_tin_mo_thau: ["thanhVienLienDanh"],
  hop_dong: ["goiThauIds"]
};

const VIRTUAL_FIELDS_BY_TABLE = {
  goi_thau: ["danhGiaHsdtMetadata"],
  thong_tin_mo_thau: [
    "danhGiaHopLe",
    "danhGiaNangLuc",
    "danhGiaKyThuat",
    "danhGiaTaiChinh",
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
  const allowedFields = allowedOutboundFields(type);
  allowedFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) return;
    const value = normalizeSystemVersion(field, clonePayloadValue(normalized[field]));
    if (value !== void 0) serialized[field] = value;
  });

  if (Number.isInteger(normalized.rowVersion) && normalized.rowVersion > 0) {
    serialized.expectedVersion = normalized.rowVersion;
  }
  return serialized;
}
