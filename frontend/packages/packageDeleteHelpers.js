import { replaceTableProjection } from "../shared/MutationService.js";

function normalizedPackageName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/gu, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/gu, " ")
    .trim();
}

function legacyPlanFamilyIds(plans, targetPlanId) {
  const targetPlan = (plans || []).find(
    (plan) => String(plan?.id) === String(targetPlanId),
  );
  if (!targetPlan) return new Set([String(targetPlanId)]);
  const rootId = String(targetPlan.rootId || targetPlan.id);
  const ids = new Set([String(targetPlan.id)]);
  (targetPlan.allVersions || []).forEach((version) => {
    if (version?.id) ids.add(String(version.id));
  });
  (plans || []).forEach((plan) => {
    if (String(plan?.rootId || plan?.id) === rootId && plan?.id) {
      ids.add(String(plan.id));
    }
  });
  return ids;
}

function legacySplitRootMatches(goithauList, targetPackage, plans) {
  const targetName = normalizedPackageName(targetPackage?.tenGoiThau);
  if (!targetName) return [];
  const planIds = legacyPlanFamilyIds(plans, targetPackage?.keHoachId);
  const familyPackages = (goithauList || []).filter(
    (pkg) => planIds.has(String(pkg?.keHoachId)),
  );
  const countsByPlanAndName = new Map();
  familyPackages.forEach((pkg) => {
    const key = `${String(pkg?.keHoachId)}|${normalizedPackageName(pkg?.tenGoiThau)}`;
    countsByPlanAndName.set(key, (countsByPlanAndName.get(key) || 0) + 1);
  });
  const targetKey = `${String(targetPackage?.keHoachId)}|${targetName}`;
  if (countsByPlanAndName.get(targetKey) !== 1) return [];
  return familyPackages.filter((pkg) => {
    if (normalizedPackageName(pkg?.tenGoiThau) !== targetName) return false;
    const key = `${String(pkg?.keHoachId)}|${targetName}`;
    return countsByPlanAndName.get(key) === 1;
  });
}

export function getPackageDeleteContext(goithauList, targetId, plans = []) {
  const targetPackage = goithauList.find((g) => String(g.id) === String(targetId));
  if (!targetPackage) return null;
  const rootId = targetPackage.rootId || targetPackage.id;
  const relatedById = new Map();
  goithauList
    .filter((gt) => String(gt.rootId || gt.id) === String(rootId))
    .forEach((pkg) => relatedById.set(String(pkg.id), pkg));
  legacySplitRootMatches(goithauList, targetPackage, plans)
    .forEach((pkg) => relatedById.set(String(pkg.id), pkg));
  const relatedPackages = [...relatedById.values()];
  const versionRefsById = new Map();
  const metadataVersions = Array.isArray(targetPackage.allVersions) ? targetPackage.allVersions : [];
  metadataVersions.forEach((version) => {
    if (!version?.id) return;
    versionRefsById.set(String(version.id), {
      ...version,
      id: version.id,
      phienBan: version.phienBan || "00"
    });
  });
  relatedPackages.forEach((version) => {
    if (!version?.id) return;
    versionRefsById.set(String(version.id), version);
  });
  const versionRefs = Array.from(versionRefsById.values());
  const relatedIds = versionRefs.map((gt) => gt.id);
  const planIds = [...new Set(relatedPackages.map((gt) => gt.keHoachId))];
  return {
    targetPackage,
    rootId,
    relatedPackages,
    versionRefs,
    relatedIds,
    planIds
  };
}
export function deleteAllPackageVersions(model, context) {
  const relatedIdSet = new Set(context.relatedIds.map(String));
  const relatedPackages = context.versionRefs?.length
    ? context.versionRefs
    : context.relatedPackages;
  const relatedBidRecords = (model.state.thongtinmothau || []).filter((b) => (
    relatedIdSet.has(String(b.goiThauId))
  ));
  replaceTableProjection(model, "goithau", model.state.goithau.filter((gt) => (
    String(gt.rootId || gt.id) !== String(context.rootId)
    && !relatedIdSet.has(String(gt.id))
  )));
  model.markDeleted("goithau", relatedPackages);
  replaceTableProjection(model, "thongtinmothau", model.state.thongtinmothau.filter((b) => !relatedIdSet.has(String(b.goiThauId))));
  model.markDeleted("thongtinmothau", relatedBidRecords);
  return { deletedBids: relatedBidRecords, deletedPackages: relatedPackages };
}
