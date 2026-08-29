const TRIAL_VALUE = "true";
const COMMERCIAL_TABS = new Set(["commercial-admin", "commercial-storefront"]);


export function isTrialFullAccess(documentRef = document) {
  return documentRef?.documentElement?.dataset?.trialFullAccess === TRIAL_VALUE;
}


export function applyTrialCommercialPresentation(documentRef = document) {
  if (!isTrialFullAccess(documentRef)) return 0;
  const nodes = [...documentRef.querySelectorAll("[data-commercial-only]")];
  nodes.forEach((node) => {
    node.hidden = true;
    node.setAttribute("aria-hidden", "true");
  });
  return nodes.length;
}


export function resolveTrialVisibleTab(tabName, fallbackTab, trialEnabled) {
  return trialEnabled && COMMERCIAL_TABS.has(tabName) ? fallbackTab : tabName;
}
