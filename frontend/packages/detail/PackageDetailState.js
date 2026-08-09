import {
  packageVersionResolutionOptions,
  resolveLatestVersion,
} from "../../shared/versionResolver.js";

export function resolvePackageDetailState({ tabs, currentTab, currentPackageId, packageId }) {
  const tabExists = (tabs || []).some((tab) => tab.id === currentTab);
  const samePackage = String(currentPackageId || "") === String(packageId || "");
  return {
    packageId,
    activeTab: tabExists && samePackage ? currentTab : (tabs?.[0]?.id || "preparation")
  };
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

  return resolveLatestVersion(
    packages,
    requested || requestedId,
    packageVersionResolutionOptions(model?.state?.kehoach),
  ) || requested || null;
}

export function selectPackageDetailTab(target, tabId, packageRef, model = null) {
  const latestPackage = resolveLatestPackage(model, packageRef);
  const packageId = latestPackage?.id || (typeof packageRef === "object" ? packageRef?.id : packageRef);
  const workspace = packageWorkspaceFor(target);
  const currentPackageId = String(target._currentWorkflowPackageId || "");
  if (currentPackageId !== String(packageId || "")) {
    workspace.load({ packageId, workflowTab: tabId });
  } else {
    workspace.transition({ type: "SELECT_TAB", tab: tabId });
  }
  // Compatibility mirror for panels not yet migrated to the module interface.
  target._currentWorkflowTab = tabId;
  target._currentWorkflowPackageId = packageId;
  return packageId;
}
import { packageWorkspaceFor } from "./PackageWorkspaceState.js";
