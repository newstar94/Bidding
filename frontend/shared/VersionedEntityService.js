import { versionFamily, versionNumber } from "./versionResolver.js";

const NEW_RECORD_SERVER_FIELDS = [
  "rowVersion",
  "expectedVersion",
  "syncVersion",
  "organizationId",
  "ownerType",
  "archivedAt"
];

export function copyAsNewRecord(source, overrides = {}) {
  const record = { ...(source || {}), ...overrides };
  NEW_RECORD_SERVER_FIELDS.forEach((field) => { delete record[field]; });
  return record;
}

function copyChildRows(rows, transform = (row) => row) {
  return (Array.isArray(rows) ? rows : []).map((source) => {
    const row = copyAsNewRecord(source);
    delete row.id;
    return transform(row);
  });
}

/**
 * Create the data portion of a new package snapshot.
 *
 * Planning data is retained, while opening/evaluation/award/cancellation data
 * belongs to the historical package version and must never leak into a new
 * procurement process. Child IDs are also removed because they are globally
 * unique database rows, not lineage identifiers.
 */
export function preparePackageSnapshot(source, overrides = {}) {
  const packageData = copyAsNewRecord(source, overrides);
  return {
    ...packageData,
    trangThai: "Chuẩn bị",
    nhaThauTrungThauId: null,
    giaTrungThau: null,
    soQuyetDinhKetQua: "",
    ngayQuyetDinhKetQua: "",
    thoiGianGoiThau: "",
    thoiGianHopDong: "",
    danhGiaHsdtMetadata: null,
    phanLoList: copyChildRows(packageData.phanLoList, (row) => ({
      ...row,
      nhaThauTrungThauId: null,
      giaTrungThau: null,
      thoiGianGoiThau: "",
      thoiGianHopDong: ""
    })),
    awardedPhanLoList: [],
    tuyChonMuaThemList: copyChildRows(packageData.tuyChonMuaThemList),
    giaHanList: [],
    yeuCauLamRoList: [],
    traLoiLamRoList: [],
    timelineItems: [],
    ehsmtAdjustments: []
  };
}

export function buildVersionEhsmtAdjustment(packageData = {}) {
  const sequence = Number.parseInt(packageData.phienBan || "0", 10) || 0;
  const packageId = String(packageData.id || "").trim();
  if (sequence <= 0 || !packageId) return null;
  return {
    id: `package-version:${packageId}`,
    sequence,
    reason: "Điều chỉnh E-HSMT theo phiên bản gói thầu",
    submissionNumber: "",
    submissionDate: "",
    appraisalReportNumber: "",
    appraisalReportDate: "",
    approvalDecisionNumber: packageData.soQuyetDinh || "",
    approvalDecisionDate: packageData.ngayQuyetDinh || "",
    publishedAt: packageData.thoiGianDangTai || ""
  };
}

export function ensureVersionEhsmtAdjustment(packageData = {}) {
  const generated = buildVersionEhsmtAdjustment(packageData);
  if (!generated) return packageData;
  const adjustments = Array.isArray(packageData.ehsmtAdjustments)
    ? [...packageData.ehsmtAdjustments]
    : [];
  const existingIndex = adjustments.findIndex((item) => String(item?.id || "") === generated.id);
  if (existingIndex >= 0) {
    adjustments[existingIndex] = { ...adjustments[existingIndex], ...generated };
  } else {
    adjustments.push(generated);
  }
  packageData.ehsmtAdjustments = adjustments;
  return packageData;
}

export function preserveRowVersion(record, current) {
  if (Number.isInteger(current?.rowVersion) && current.rowVersion > 0) {
    record.rowVersion = current.rowVersion;
  } else {
    delete record.rowVersion;
  }
  delete record.expectedVersion;
  return record;
}

export function getVersionFamily(records, target) {
  return versionFamily(records, target);
}

export function getNextVersion(records, target) {
  const family = getVersionFamily(records, target);
  const metadataVersions = Array.isArray(target?.allVersions) ? target.allVersions : [];
  const knownVersions = [...family, ...metadataVersions];
  const next = knownVersions.length ? Math.max(...knownVersions.map(versionNumber)) + 1 : 0;
  return String(next).padStart(2, "0");
}

export function markLatestVersion(records, target) {
  const family = getVersionFamily(records, target);
  if (!family.length) return null;
  const latestVersion = Math.max(...family.map(versionNumber));
  let latest = null;
  family.forEach((record) => {
    record.isLatest = versionNumber(record) === latestVersion ? 1 : 0;
    if (record.isLatest) latest = record;
  });
  return latest;
}

export function removeLatestVersion(records, target) {
  const family = getVersionFamily(records, target);
  if (!family.length) return { records: [...(records || [])], removed: [], latest: null };
  const latestVersion = Math.max(...family.map(versionNumber));
  const removed = family.filter((record) => versionNumber(record) === latestVersion);
  const removedIds = new Set(removed.map((record) => String(record.id)));
  const remaining = (records || []).filter((record) => !removedIds.has(String(record.id)));
  const familyRemaining = getVersionFamily(remaining, target);
  const latest = familyRemaining.length ? markLatestVersion(remaining, familyRemaining[0]) : null;
  return { records: remaining, removed, latest };
}

export function removeAllVersions(records, target) {
  const family = getVersionFamily(records, target);
  const ids = new Set(family.map((record) => String(record.id)));
  return {
    records: (records || []).filter((record) => !ids.has(String(record.id))),
    removed: family,
    latest: null
  };
}

export function createInitialVersion(data, { id, timestamp }) {
  return copyAsNewRecord(data, {
    id,
    rootId: id,
    phienBan: "00",
    isLatest: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function createNextVersion(records, current, data, { id, timestamp }) {
  getVersionFamily(records, current).forEach((record) => { record.isLatest = 0; });
  return copyAsNewRecord(data, {
    id,
    rootId: current.rootId || current.id,
    phienBan: getNextVersion(records, current),
    isLatest: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function rememberSelectedVersion(state, selectionKey, record) {
  if (!state || !selectionKey || !record?.id) return;
  state[selectionKey] = state[selectionKey] || {};
  state[selectionKey][record.rootId || record.id] = record.id;
  if (selectionKey === "selectedPackageVersion") {
    state.selectedPackageVersionIntent ||= {};
    state.selectedPackageVersionIntent[record.rootId || record.id] = "latest";
  }
}

export function findVersionReferences(targets, relationships = []) {
  const list = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
  const ids = new Set(list.map((record) => String(record.id ?? record)));
  return (relationships || []).flatMap((relationship) => {
    const records = relationship.records || [];
    const matches = relationship.matches || ((record) => ids.has(String(record?.[relationship.foreignKey])));
    return records.filter((record) => matches(record, ids, list)).map((record) => ({
      relation: relationship.name || relationship.foreignKey || "reference",
      record
    }));
  });
}

export function canDeleteVersions(targets, relationships = []) {
  const references = findVersionReferences(targets, relationships);
  return { allowed: references.length === 0, references };
}
