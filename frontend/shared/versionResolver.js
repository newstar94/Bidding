export const versionNumber = (record) => {
  const value = Number.parseInt(record?.phienBan || "0", 10);
  return Number.isFinite(value) ? value : 0;
};

export const versionRootId = (record) => String(record?.rootId || record?.id || "");

const latestMarker = (record) => Number(record?.isLatest == 1);

const stableIdComparison = (left, right) => {
  const leftId = String(left?.id || "");
  const rightId = String(right?.id || "");
  if (leftId === rightId) return 0;
  if (!leftId) return -1;
  if (!rightId) return 1;
  return leftId < rightId ? 1 : -1;
};

export function compareVersionCandidates(left, right, {
  getSecondaryVersion = null,
} = {}) {
  const versionDelta = versionNumber(left) - versionNumber(right);
  if (versionDelta) return versionDelta;

  if (typeof getSecondaryVersion === "function") {
    const secondaryDelta = versionNumber({ phienBan: getSecondaryVersion(left) })
      - versionNumber({ phienBan: getSecondaryVersion(right) });
    if (secondaryDelta) return secondaryDelta;
  }

  const markerDelta = latestMarker(left) - latestMarker(right);
  return markerDelta || stableIdComparison(left, right);
}

export function selectLatestVersion(records, options = {}) {
  return (Array.isArray(records) ? records : []).reduce((latest, candidate) => {
    if (!candidate) return latest;
    if (!latest || compareVersionCandidates(candidate, latest, options) > 0) return candidate;
    return latest;
  }, null);
}

export function versionFamily(records, reference) {
  if (!reference) return [];
  const rootId = versionRootId(reference);
  return (Array.isArray(records) ? records : []).filter(
    (record) => versionRootId(record) === rootId,
  );
}

export function resolveLatestVersion(records, reference, options = {}) {
  if (!reference) return null;
  const list = Array.isArray(records) ? records : [];
  const requested = typeof reference === "object"
    ? reference
    : list.find((record) => String(record?.id || "") === String(reference));
  if (requested) {
    return selectLatestVersion(versionFamily(list, requested), options) || requested;
  }
  if (typeof reference === "object") return null;
  return selectLatestVersion(
    list.filter((record) => versionRootId(record) === String(reference)),
    options,
  );
}

export function selectLatestVersionsByRoot(records, options = {}) {
  const latestByRoot = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const rootId = versionRootId(record);
    if (!rootId) return;
    const latest = latestByRoot.get(rootId);
    if (!latest || compareVersionCandidates(record, latest, options) > 0) {
      latestByRoot.set(rootId, record);
    }
  });
  return [...latestByRoot.values()];
}

export function sortVersionsDescending(records, options = {}) {
  return [...(Array.isArray(records) ? records : [])]
    .sort((left, right) => compareVersionCandidates(right, left, options));
}

export function selectVersionRepresentatives(records, options = {}) {
  const representativeByVersion = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const key = versionNumber(record);
    const current = representativeByVersion.get(key);
    if (!current || compareVersionCandidates(record, current, options) > 0) {
      representativeByVersion.set(key, record);
    }
  });
  return sortVersionsDescending([...representativeByVersion.values()], options);
}

export function packageVersionResolutionOptions(plans = []) {
  const planById = new Map(
    (Array.isArray(plans) ? plans : []).map((plan) => [String(plan?.id || ""), plan]),
  );
  return {
    getSecondaryVersion: (pkg) => planById.get(String(pkg?.keHoachId || ""))?.phienBan,
  };
}
