const PARAMS = Object.freeze({
  packageId: "evaluationPackage",
  workflowTab: "evaluationWorkflowTab",
  evaluationRoundId: "evaluationRound",
  bidId: "evaluationBid",
  detailTab: "evaluationSection",
  lotMode: "evaluationLotMode",
  lotId: "evaluationLot",
});

const WORKFLOW_TABS = new Set([
  "preparation", "invitation", "opening", "eval_tech", "opening_fin",
  "eval_fin", "result", "documents", "activity", "cancel",
]);
const ROUNDS = new Set(["technical", "financial", "unified"]);
const LOT_MODES = new Set(["all", "selected"]);

function clean(value) {
  return String(value ?? "").trim();
}

function asUrl(value) {
  if (value instanceof URL) return new URL(value.toString());
  return new URL(String(value || "/"), "http://localhost");
}

function externalUrl(url) {
  return url.origin === "http://localhost"
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
}

function normalizedLotScope(value) {
  const mode = LOT_MODES.has(value?.mode) ? value.mode : "all";
  const ids = [...new Set((value?.ids || []).map(clean).filter(Boolean))].sort();
  return { mode, ids: mode === "selected" ? ids : [] };
}

function normalizedRoute(value = {}) {
  const workflowTab = clean(value.workflowTab);
  const evaluationRoundId = clean(value.evaluationRoundId);
  return {
    pathname: clean(value.pathname) || "/",
    packageId: clean(value.packageId),
    workflowTab: WORKFLOW_TABS.has(workflowTab) ? workflowTab : "preparation",
    evaluationRoundId: ROUNDS.has(evaluationRoundId) ? evaluationRoundId : "technical",
    bidId: clean(value.bidId),
    detailTab: clean(value.detailTab) || "validity",
    lotScope: normalizedLotScope(value.lotScope),
  };
}

export class RouteRegistry {
  static parse(value) {
    const url = asUrl(value);
    return normalizedRoute({
      pathname: url.pathname,
      packageId: url.searchParams.get(PARAMS.packageId),
      workflowTab: url.searchParams.get(PARAMS.workflowTab),
      evaluationRoundId: url.searchParams.get(PARAMS.evaluationRoundId),
      bidId: url.searchParams.get(PARAMS.bidId),
      detailTab: url.searchParams.get(PARAMS.detailTab),
      lotScope: {
        mode: url.searchParams.get(PARAMS.lotMode),
        ids: url.searchParams.getAll(PARAMS.lotId),
      },
    });
  }

  static serialize(route, baseUrl = globalThis.location?.href || "/") {
    const normalized = normalizedRoute(route);
    const url = asUrl(baseUrl);
    url.pathname = normalized.pathname;
    Object.values(PARAMS).forEach((parameter) => url.searchParams.delete(parameter));
    if (normalized.packageId) url.searchParams.set(PARAMS.packageId, normalized.packageId);
    if (normalized.workflowTab !== "preparation") {
      url.searchParams.set(PARAMS.workflowTab, normalized.workflowTab);
    }
    if (normalized.evaluationRoundId !== "technical") {
      url.searchParams.set(PARAMS.evaluationRoundId, normalized.evaluationRoundId);
    }
    if (normalized.bidId) url.searchParams.set(PARAMS.bidId, normalized.bidId);
    if (normalized.detailTab !== "validity") {
      url.searchParams.set(PARAMS.detailTab, normalized.detailTab);
    }
    if (normalized.lotScope.mode !== "all") {
      url.searchParams.set(PARAMS.lotMode, normalized.lotScope.mode);
      normalized.lotScope.ids.forEach((id) => url.searchParams.append(PARAMS.lotId, id));
    }
    return externalUrl(url);
  }

}

export { normalizedRoute as normalizeAppRoute };
