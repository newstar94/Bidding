import { generateRecordId } from "../shared/idUtils.js";
import { snapshotPackageAggregate } from "../packages/packageAggregateSnapshot.js";
import { selectLatestVersionsByRoot } from "../shared/versionResolver.js";

function latestPackagesInPlan(packages, planId) {
  return selectLatestVersionsByRoot(
    (packages || []).filter((pkg) => String(pkg.keHoachId) === String(planId)),
  );
}

export function snapshotPlanAggregate(state, {
  sourcePlanId,
  targetPlanId,
  timestamp,
  sourcePackages = state.goithau,
  createId = generateRecordId,
} = {}) {
  if (!sourcePlanId || !targetPlanId) throw new Error("Không đủ dữ liệu để kế thừa phiên bản kế hoạch.");
  const aggregate = {
    goithau: [],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
    sourcePackageIds: [],
    mappings: {
      packageIds: new Map(),
      packageRoots: new Map(),
    },
  };
  latestPackagesInPlan(sourcePackages, sourcePlanId).forEach((sourcePackage) => {
    const snapshot = snapshotPackageAggregate(state, sourcePackage, {
      targetPackageId: createId("goithau"),
      targetPlanId,
      packageVersion: sourcePackage.phienBan || "00",
      timestamp,
      createId,
    });
    aggregate.goithau.push(snapshot.packageRecord);
    aggregate.goithauhanghoa.push(...snapshot.goithauhanghoa);
    aggregate.thongtinmothau.push(...snapshot.thongtinmothau);
    aggregate.hanghoaduthaunhathau.push(...snapshot.hanghoaduthaunhathau);
    aggregate.assignments.push(...snapshot.assignments);
    aggregate.sourcePackageIds.push(sourcePackage.id);
    aggregate.mappings.packageIds.set(String(sourcePackage.id), snapshot.packageRecord.id);
    aggregate.mappings.packageRoots.set(
      String(sourcePackage.rootId || sourcePackage.id),
      snapshot.packageRecord.id,
    );
  });
  aggregate.goithau.forEach((packageRecord) => {
    const sourceRebidId = String(packageRecord.rebidFromPackageId || "");
    if (aggregate.mappings.packageIds.has(sourceRebidId)) {
      packageRecord.rebidFromPackageId = aggregate.mappings.packageIds.get(sourceRebidId);
    }
  });
  return aggregate;
}

export function applyPlanAggregateSnapshot(state, aggregate) {
  const sourceIds = new Set((aggregate.sourcePackageIds || []).map(String));
  (state.goithau || []).forEach((pkg) => {
    if (sourceIds.has(String(pkg.id))) pkg.isLatest = 0;
  });
  ["goithau", "goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau", "assignments"].forEach((key) => {
    state[key] = Array.isArray(state[key]) ? state[key] : [];
    state[key].push(...(aggregate[key] || []));
  });
  repointSelectedPackageVersions(state, aggregate);
  return aggregate;
}

/**
 * The package version droplist remembers which row of a version family the user
 * is looking at. Inheriting a plan version replaces the active package row with
 * a frozen copy that has a new id, so a remembered id would keep pointing at the
 * superseded row. The table then treats the row as a historical version and
 * offers only "view", hiding edit and delete until the selection is rebuilt.
 */
function repointSelectedPackageVersions(state, aggregate) {
  const selection = state?.selectedPackageVersion;
  const mapping = aggregate?.mappings?.packageIds;
  const rootMapping = aggregate?.mappings?.packageRoots;
  if (!selection || (!mapping && !rootMapping)) return;
  Object.entries(selection).forEach(([rootId, selectedId]) => {
    const replacementId = mapping?.get(String(selectedId))
      || rootMapping?.get(String(rootId));
    if (replacementId) selection[rootId] = replacementId;
  });
}
