import { replaceTableProjection } from "../shared/MutationService.js";

export function getPackageDeleteContext(goithauList, targetId) {
  const targetPackage = goithauList.find((g) => String(g.id) === String(targetId));
  if (!targetPackage) return null;
  const rootId = targetPackage.rootId || targetPackage.id;
  const relatedPackages = goithauList.filter((gt) => String(gt.rootId || gt.id) === String(rootId));
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
