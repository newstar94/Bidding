const BIDDING_ROUTES = new Set(["mothau", "danhgiahsdt", "goithau-detail"]);
const BIDDING_CREATE_ROUTES = new Set(["kehoach", "goithau"]);
const PARTNER_CREATE_ROUTES = new Set(["chudautu", "nhathau", "chuyengia", "hopdong"]);

const BIDDING_METHODS = new Set([
  "addBreakdownRow",
  "backToPlanDraft",
  "addGiaHanRow",
  "deleteGoiThau",
  "deleteKeHoach",
  "editGoiThau",
  "editKeHoach",
  "enforceSingleLeader",
  "moThauGoiThau",
  "openMoThauJVManager",
  "openMoThauJVViewModal",
  "phatHanhHsmtGoiThau",
  "removeBreakdownRow",
  "restoreCanceledPackage",
  "saveKetQuaChiDinhThau",
  "showNhaThauDetailsAndCloseJV",
  "validateGiaHanRealtime",
]);

const PARTNER_METHODS = new Set([
  "deleteChuDauTu",
  "deleteChuyenGia",
  "deleteHopDong",
  "deleteNhaThau",
  "editChuDauTu",
  "editChuyenGia",
  "editHopDong",
  "editNhaThau",
]);

const STATIC_WORKFLOW_METHODS = new Set([
  "triggerExcelImport",
  "triggerExcelTemplateDownload",
]);

const BIDDING_WORKFLOW_IMPORTERS = Object.freeze([
  () => import("../shared/BiddingCalculations.js"),
  () => import("../packages/BidEvaluationWorkflow.js"),
  () => import("../plans/KeHoachWorkflow.js"),
  () => import("../procurement/PlanImportWizard.js"),
  () => import("../procurement/NoticeImportWizard.js"),
  () => import("../procurement/ProcurementInlineLookup.js"),
  () => import("../procurement/ProcurementImportResume.js"),
  () => import("../procurement/OpeningImportWizard.js"),
  () => import("../packages/GoiThauWorkflow.js"),
  () => import("../packages/BidProcessWorkflow.js"),
  () => import("../shared/FormSubTables.js"),
  () => import("../shared/PartnerHelpers.js"),
]);

const DETAILED_EVALUATION_EXPORTS = Object.freeze([
  "closeDetailedEvaluation",
  "importDetailedEvaluationExcel",
  "openDetailedEvaluation",
  "renderDetailedEvaluation",
  "saveDetailedEvaluation",
]);

// These helpers are exported by their concrete modules for focused tests and
// internal composition, but BiddingWorkflows.js intentionally does not expose
// them to the controller command surface.
const BIDDING_WORKFLOW_PRIVATE_EXPORTS = Object.freeze([
  "addDetailedEvaluationCriterion",
  "applyDetailedEvaluationProjection",
  "applyRawAddressToAddressControls",
  "buildDetailedEvaluationDraft",
  "buildReopenedDetailedEvaluationReport",
  "collectActiveGroupRows",
  "collectConfiguredDetailedEvaluationCriteria",
  "commitEvaluationLotScopeChange",
  "composeInternalAddress",
  "initAddressDropdowns",
  "parseStoredInternalAddress",
  "parseVietnamAddress",
  "setDetailedTechnicalEvaluationMethod",
  "splitAddressParts",
  "stripAdministrativeSuffix",
  "stripVietnamCountrySuffix",
  "verifyMuasamcongDetailedEvaluationContractor",
]);

export async function importBiddingWorkflowsSequentially({
  importDetailedEvaluation = () => import("../packages/DetailedEvaluationWorkflow.js"),
} = {}) {
  const workflowModule = Object.create(null);
  for (const importWorkflowModule of BIDDING_WORKFLOW_IMPORTERS) {
    Object.assign(workflowModule, await importWorkflowModule());
  }
  for (const exportName of DETAILED_EVALUATION_EXPORTS) {
    workflowModule[exportName] = async function (...args) {
      const detailedEvaluation = await importDetailedEvaluation();
      return detailedEvaluation[exportName].apply(this, args);
    };
  }
  for (const privateExport of BIDDING_WORKFLOW_PRIVATE_EXPORTS) {
    delete workflowModule[privateExport];
  }
  return Object.freeze(workflowModule);
}

export function workflowRequirementForRoute(tabName, action = null) {
  if (BIDDING_ROUTES.has(tabName)) return "bidding";
  if (action !== "taomoi") return null;
  if (BIDDING_CREATE_ROUTES.has(tabName)) return "bidding";
  if (PARTNER_CREATE_ROUTES.has(tabName)) return "partner";
  return "all";
}

export function workflowRequirementForMethod(methodName) {
  if (BIDDING_METHODS.has(methodName)) return "bidding";
  if (PARTNER_METHODS.has(methodName)) return "partner";
  if (STATIC_WORKFLOW_METHODS.has(methodName)) return null;
  return "all";
}

export class WorkflowModuleLoader {
  constructor({
    importBidding = importBiddingWorkflowsSequentially,
    importPartner = () => import("../partners/PartnerWorkflows.js"),
    install,
  }) {
    if (typeof install !== "function") {
      throw new TypeError("WorkflowModuleLoader requires an install function");
    }
    this.importers = {
      bidding: importBidding,
      partner: importPartner,
    };
    this.install = install;
    this.states = {
      bidding: { ready: false, promise: null },
      partner: { ready: false, promise: null },
      all: { promise: null },
    };
  }

  isReady(group) {
    if (group === "all") {
      return this.states.bidding.ready && this.states.partner.ready;
    }
    return Boolean(this.states[group]?.ready);
  }

  ensure(group) {
    if (group === "all") return this.ensureAll();
    if (!(group in this.importers)) {
      throw new TypeError(`Unknown workflow module group: ${group}`);
    }
    return this.ensureOne(group);
  }

  ensureOne(group) {
    const state = this.states[group];
    if (state.promise) return state.promise;
    if (state.ready) {
      state.promise = Promise.resolve();
      return state.promise;
    }

    let imported;
    try {
      imported = this.importers[group]();
    } catch (error) {
      return Promise.reject(error);
    }
    state.promise = Promise.resolve(imported)
      .then((module) => {
        this.install(`${group}-workflows`, module);
        state.ready = true;
      })
      .catch((error) => {
        state.promise = null;
        throw error;
      });
    return state.promise;
  }

  ensureAll() {
    const state = this.states.all;
    if (state.promise) return state.promise;
    state.promise = Promise.all([
      this.ensureOne("bidding"),
      this.ensureOne("partner"),
    ])
      .then(() => undefined)
      .catch((error) => {
        state.promise = null;
        throw error;
      });
    return state.promise;
  }
}
