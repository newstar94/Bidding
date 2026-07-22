export function resolvePackageDetailState({ tabs, currentTab, currentPackageId, packageId }) {
  const tabExists = (tabs || []).some((tab) => tab.id === currentTab);
  const samePackage = String(currentPackageId || "") === String(packageId || "");
  return {
    packageId,
    activeTab: tabExists && samePackage ? currentTab : (tabs?.[0]?.id || "preparation")
  };
}

function packageVersionNumber(pkg) {
  const value = Number.parseInt(pkg?.phienBan, 10);
  return Number.isFinite(value) ? value : 0;
}

export function resolveLatestPackage(model, packageRef) {
  if (!packageRef) return null;
  const packages = model?.state?.goithau || [];
  const requested = typeof packageRef === "object"
    ? packageRef
    : packages.find((pkg) => String(pkg?.id || "") === String(packageRef));
  const requestedId = String(requested?.id || packageRef || "");
  const modelLatest = requestedId && typeof model?.getLatestPackage === "function"
    ? model.getLatestPackage(requestedId)
    : null;
  if (modelLatest) return modelLatest;

  const rootId = String(requested?.rootId || requested?.id || requestedId);
  const candidates = packages.filter((pkg) => (
    String(pkg?.rootId || pkg?.id || "") === rootId
  ));
  if (!candidates.length) return requested || null;
  return [...candidates].sort((left, right) => {
    const latestDelta = Number(right?.isLatest == 1) - Number(left?.isLatest == 1);
    return latestDelta || packageVersionNumber(right) - packageVersionNumber(left);
  })[0];
}

export function selectPackageDetailTab(target, tabId, packageRef, model = null) {
  const latestPackage = resolveLatestPackage(model, packageRef);
  const packageId = latestPackage?.id || (typeof packageRef === "object" ? packageRef?.id : packageRef);
  target._currentWorkflowTab = tabId;
  target._currentWorkflowPackageId = packageId;
  return packageId;
}
