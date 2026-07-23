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
  const versionCount = new Set(versionRefs.map((g) => g.phienBan || "00")).size;
  const planIds = [...new Set(relatedPackages.map((gt) => gt.keHoachId))];
  return {
    targetPackage,
    rootId,
    relatedPackages,
    versionRefs,
    relatedIds,
    versionCount,
    planIds
  };
}
export function deleteLatestPackageVersion(model, context) {
  const versionRefs = context.versionRefs?.length ? context.versionRefs : context.relatedPackages;
  const maxVersion = Math.max(...versionRefs.map((g) => parseInt(g.phienBan) || 0));
  const latestPackages = versionRefs.filter((g) => (parseInt(g.phienBan) || 0) === maxVersion);
  const latestIds = latestPackages.map((g) => g.id);
  const latestIdSet = new Set(latestIds.map(String));
  const latestBidRecords = (model.state.thongtinmothau || []).filter((b) => (
    latestIdSet.has(String(b.goiThauId))
  ));
  model.state.goithau = model.state.goithau.filter((gt) => !latestIdSet.has(String(gt.id)));
  model.markDeleted("goithau", latestPackages);
  model.state.thongtinmothau = model.state.thongtinmothau.filter((b) => !latestIdSet.has(String(b.goiThauId)));
  model.markDeleted("thongtinmothau", latestBidRecords);
  const remainingRelated = context.relatedPackages.filter((gt) => !latestIds.includes(gt.id));
  context.planIds.forEach((planId) => {
    const planRemaining = remainingRelated.filter((gt) => gt.keHoachId === planId);
    if (planRemaining.length === 0) return;
    const nextMaxVersion = Math.max(...planRemaining.map((g) => parseInt(g.phienBan) || 0));
    planRemaining.forEach((gt) => {
      gt.isLatest = (parseInt(gt.phienBan) || 0) === nextMaxVersion ? 1 : 0;
    });
  });
}
export function deleteAllPackageVersions(model, context) {
  const relatedIdSet = new Set(context.relatedIds.map(String));
  const relatedPackages = context.versionRefs?.length
    ? context.versionRefs
    : context.relatedPackages;
  const relatedBidRecords = (model.state.thongtinmothau || []).filter((b) => (
    relatedIdSet.has(String(b.goiThauId))
  ));
  model.state.goithau = model.state.goithau.filter((gt) => (
    String(gt.rootId || gt.id) !== String(context.rootId)
    && !relatedIdSet.has(String(gt.id))
  ));
  model.markDeleted("goithau", relatedPackages);
  model.state.thongtinmothau = model.state.thongtinmothau.filter((b) => !relatedIdSet.has(String(b.goiThauId)));
  model.markDeleted("thongtinmothau", relatedBidRecords);
}
