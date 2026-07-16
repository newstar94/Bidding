export function resolvePackageDetailState({ tabs, currentTab, currentPackageId, packageId }) {
  const tabExists = (tabs || []).some((tab) => tab.id === currentTab);
  const samePackage = String(currentPackageId || "") === String(packageId || "");
  return {
    packageId,
    activeTab: tabExists && samePackage ? currentTab : (tabs?.[0]?.id || "preparation")
  };
}

export function selectPackageDetailTab(target, tabId, packageId) {
  target._currentWorkflowTab = tabId;
  target._currentWorkflowPackageId = packageId;
}
