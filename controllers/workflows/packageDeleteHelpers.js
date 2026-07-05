export function getPackageDeleteContext(goithauList, targetId) {
    const targetPackage = goithauList.find(g => g.id === targetId);
    if (!targetPackage) return null;

    const rootId = targetPackage.rootId || targetPackage.id;
    const relatedPackages = goithauList.filter(gt => (gt.rootId || gt.id) === rootId);
    const relatedIds = relatedPackages.map(gt => gt.id);
    const versionCount = new Set(relatedPackages.map(g => g.phienBan || '00')).size;
    const planIds = [...new Set(relatedPackages.map(gt => gt.keHoachId))];

    return {
        targetPackage,
        rootId,
        relatedPackages,
        relatedIds,
        versionCount,
        planIds
    };
}

export function deleteLatestPackageVersion(model, context) {
    const maxVersion = Math.max(...context.relatedPackages.map(g => parseInt(g.phienBan) || 0));
    const latestPackages = context.relatedPackages.filter(g => (parseInt(g.phienBan) || 0) === maxVersion);
    const latestIds = latestPackages.map(g => g.id);

    model.state.goithau = model.state.goithau.filter(gt => !latestIds.includes(gt.id));
    model.markDeleted('goithau', latestIds);

    const latestBidIds = (model.state.thongtinmothau || [])
        .filter(b => latestIds.includes(String(b.goiThauId)))
        .map(b => b.id);
    model.state.thongtinmothau = model.state.thongtinmothau.filter(b => !latestIds.includes(String(b.goiThauId)));
    model.markDeleted('thongtinmothau', latestBidIds);

    const remainingRelated = context.relatedPackages.filter(gt => !latestIds.includes(gt.id));
    context.planIds.forEach(planId => {
        const planRemaining = remainingRelated.filter(gt => gt.keHoachId === planId);
        if (planRemaining.length === 0) return;

        const nextMaxVersion = Math.max(...planRemaining.map(g => parseInt(g.phienBan) || 0));
        planRemaining.forEach(gt => {
            gt.isLatest = (parseInt(gt.phienBan) || 0) === nextMaxVersion ? 1 : 0;
        });
    });
}

export function deleteAllPackageVersions(model, context) {
    model.state.goithau = model.state.goithau.filter(gt => (gt.rootId || gt.id) !== context.rootId);
    model.markDeleted('goithau', context.relatedIds);

    const relatedBidIds = (model.state.thongtinmothau || [])
        .filter(b => context.relatedIds.includes(String(b.goiThauId)))
        .map(b => b.id);
    model.state.thongtinmothau = model.state.thongtinmothau.filter(b => !context.relatedIds.includes(String(b.goiThauId)));
    model.markDeleted('thongtinmothau', relatedBidIds);
}
