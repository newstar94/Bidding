import { evaluationScopeKey } from "./BidEvaluationPanelState.js";
import { RouteRegistry } from "../app/RouteRegistry.js";
import { packageWorkspaceFor } from "./detail/PackageWorkspaceState.js";

const PARAMS = Object.freeze({
  view: "evaluationView",
  packageId: "evaluationPackage",
  workflowTab: "evaluationWorkflowTab",
  round: "evaluationRound",
  bidId: "evaluationBid",
  detailTab: "evaluationSection",
  lotMode: "evaluationLotMode",
  lotId: "evaluationLot",
});

const DETAIL_VIEW = "contractor-detail";
const VALID_ROUNDS = new Set(["technical", "financial", "unified"]);
const VALID_WORKFLOW_TABS = new Set(["eval_tech", "eval_fin"]);
const VALID_LOT_MODES = new Set(["all", "selected"]);

function clean(value) {
  return String(value ?? "").trim();
}

function urlFrom(value) {
  if (value instanceof URL) return new URL(value.toString());
  return new URL(String(value || "/"), "http://localhost");
}

function navigationUrl(url) {
  return url.origin === "http://localhost"
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
}

function clearNavigationParams(searchParams) {
  Object.values(PARAMS).forEach((name) => searchParams.delete(name));
}

export function buildDetailedEvaluationNavigation(controller, packageId) {
  if (!controller || controller.currentEvaluationView !== DETAIL_VIEW) return null;
  const normalizedPackageId = clean(packageId);
  const round = VALID_ROUNDS.has(controller.currentDanhGiaTab)
    ? controller.currentDanhGiaTab
    : "technical";
  const scope = controller._evaluationLotScopes?.[
    evaluationScopeKey(normalizedPackageId, round)
  ];
  return {
    view: DETAIL_VIEW,
    packageId: normalizedPackageId,
    workflowTab: VALID_WORKFLOW_TABS.has(controller.view?._currentWorkflowTab)
      ? controller.view._currentWorkflowTab
      : (round === "financial" ? "eval_fin" : "eval_tech"),
    round,
    bidId: clean(controller.selectedEvaluationBidId),
    detailTab: clean(controller.selectedDetailedEvaluationTab) || "validity",
    lotMode: VALID_LOT_MODES.has(scope?.mode) ? scope.mode : "",
    lotIds: [...new Set((scope?.selectedLotIds || []).map(clean).filter(Boolean))],
  };
}

export function serializeDetailedEvaluationNavigation(urlValue, navigation) {
  const sourceUrl = urlFrom(urlValue);
  clearNavigationParams(sourceUrl.searchParams);
  if (!navigation || navigation.view !== DETAIL_VIEW || !clean(navigation.packageId)) {
    return RouteRegistry.serialize({ pathname: sourceUrl.pathname }, sourceUrl);
  }
  const serialized = RouteRegistry.serialize({
    pathname: sourceUrl.pathname,
    packageId: navigation.packageId,
    workflowTab: navigation.workflowTab,
    evaluationRoundId: navigation.round,
    bidId: navigation.bidId,
    detailTab: navigation.detailTab,
    lotScope: { mode: navigation.lotMode || "all", ids: navigation.lotIds || [] },
  }, sourceUrl);
  const url = urlFrom(serialized);
  url.searchParams.set(PARAMS.view, DETAIL_VIEW);
  return navigationUrl(url);
}

export function parseDetailedEvaluationNavigation(urlValue) {
  const url = urlFrom(urlValue);
  const params = url.searchParams;
  if (params.get(PARAMS.view) !== DETAIL_VIEW) return null;
  const route = RouteRegistry.parse(url);
  const packageId = clean(route.packageId);
  if (!packageId) return null;
  const round = clean(params.get(PARAMS.round));
  const workflowTab = clean(params.get(PARAMS.workflowTab));
  const lotMode = clean(params.get(PARAMS.lotMode));
  return {
    view: DETAIL_VIEW,
    packageId,
    workflowTab: VALID_WORKFLOW_TABS.has(workflowTab) ? workflowTab : "eval_tech",
    round: VALID_ROUNDS.has(round) ? round : route.evaluationRoundId,
    bidId: route.bidId,
    detailTab: route.detailTab,
    lotMode: VALID_LOT_MODES.has(lotMode) ? lotMode : "",
    lotIds: [...new Set(params.getAll(PARAMS.lotId).map(clean).filter(Boolean))],
  };
}

export function applyDetailedEvaluationNavigation(controller, navigation, packageId) {
  if (
    !controller
    || !navigation
    || navigation.view !== DETAIL_VIEW
    || clean(navigation.packageId) !== clean(packageId)
  ) return false;

  controller.currentEvaluationView = DETAIL_VIEW;
  controller.currentDanhGiaTab = navigation.round;
  controller.selectedEvaluationBidId = navigation.bidId || null;
  controller.selectedDetailedEvaluationTab = navigation.detailTab || "validity";
  controller._detailedEvaluationDirty = false;
  packageWorkspaceFor(controller).load({
    packageId,
    workflowTab: navigation.workflowTab,
    evaluationRoundId: navigation.round,
    bidId: navigation.bidId,
    detailTab: navigation.detailTab,
    lotScope: {
      mode: navigation.lotMode || "all",
      ids: navigation.lotIds,
    },
  });
  controller._evaluationLotScopes = controller._evaluationLotScopes || {};
  if (navigation.lotMode) {
    controller._evaluationLotScopes[evaluationScopeKey(packageId, navigation.round)] = {
      mode: navigation.lotMode,
      selectedLotIds: [...navigation.lotIds],
      availableLotIds: [...navigation.lotIds],
      batchId: null,
    };
  }
  if (controller.view) {
    controller.view._currentWorkflowPackageId = clean(packageId);
    controller.view._currentWorkflowTab = navigation.workflowTab;
  }
  return true;
}

export function restoreDetailedEvaluationNavigation(controller, packageId) {
  if (typeof window === "undefined") return false;
  return applyDetailedEvaluationNavigation(
    controller,
    parseDetailedEvaluationNavigation(window.location.href),
    packageId,
  );
}

export function syncDetailedEvaluationNavigation(controller, packageId) {
  if (typeof window === "undefined" || typeof history === "undefined") return false;
  const navigation = buildDetailedEvaluationNavigation(controller, packageId);
  if (!navigation) return false;
  const url = serializeDetailedEvaluationNavigation(window.location.href, navigation);
  history.replaceState(
    { ...(history.state || {}), detailedEvaluation: navigation },
    "",
    url,
  );
  return true;
}

export function clearDetailedEvaluationNavigation() {
  if (typeof window === "undefined" || typeof history === "undefined") return false;
  const url = serializeDetailedEvaluationNavigation(window.location.href, null);
  const nextState = { ...(history.state || {}) };
  delete nextState.detailedEvaluation;
  history.replaceState(nextState, "", url);
  return true;
}
