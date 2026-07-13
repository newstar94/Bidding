function versionNumber(record) {
  return Number.parseInt(record?.phienBan || "0", 10) || 0;
}

export function getVersionFamily(records, target) {
  if (!target) return [];
  const rootId = target.rootId || target.id;
  return (records || []).filter((record) => String(record.rootId || record.id) === String(rootId));
}

export function getNextVersion(records, target) {
  const family = getVersionFamily(records, target);
  const next = family.length ? Math.max(...family.map(versionNumber)) + 1 : 0;
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
  return {
    ...data,
    id,
    rootId: id,
    phienBan: "00",
    isLatest: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createNextVersion(records, current, data, { id, timestamp }) {
  getVersionFamily(records, current).forEach((record) => { record.isLatest = 0; });
  return {
    ...data,
    id,
    rootId: current.rootId || current.id,
    phienBan: getNextVersion(records, current),
    isLatest: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function rememberSelectedVersion(state, selectionKey, record) {
  if (!state || !selectionKey || !record?.id) return;
  state[selectionKey] = state[selectionKey] || {};
  state[selectionKey][record.rootId || record.id] = record.id;
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
