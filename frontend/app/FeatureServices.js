function featureService(controller, methods) {
  const service = {};
  Object.entries(methods).forEach(([operation, methodName]) => {
    service[operation] = async (...args) => {
      await controller.ensureWorkflowReady(methodName);
      const implementation = controller[methodName];
      if (typeof implementation !== "function") {
        throw new TypeError(`Workflow method is unavailable: ${methodName}`);
      }
      return implementation.apply(controller, args);
    };
  });
  return Object.freeze(service);
}

export function createFeatureServices(controller) {
  if (!controller || typeof controller.ensureWorkflowReady !== "function") {
    throw new TypeError("Feature services require a workflow-capable controller.");
  }
  return Object.freeze({
    plans: featureService(controller, {
      edit: "editKeHoach",
      delete: "deleteKeHoach",
      addBreakdownRow: "addBreakdownRow",
      removeBreakdownRow: "removeBreakdownRow",
      saveBreakdown: "savePlanBreakdown",
    }),
    packages: featureService(controller, {
      edit: "editGoiThau",
      delete: "deleteGoiThau",
      restoreCanceled: "restoreCanceledPackage",
      addExtension: "addGiaHanRow",
      publishInvitation: "phatHanhHsmtGoiThau",
    }),
    evaluation: featureService(controller, {
      openBid: "moThauGoiThau",
      saveDirectAppointmentResult: "saveKetQuaChiDinhThau",
      openJointVentureManager: "openMoThauJVManager",
    }),
    contracts: featureService(controller, {
      edit: "editHopDong",
      delete: "deleteHopDong",
    }),
    partners: featureService(controller, {
      editInvestor: "editChuDauTu",
      deleteInvestor: "deleteChuDauTu",
      editContractor: "editNhaThau",
      deleteContractor: "deleteNhaThau",
      editExpert: "editChuyenGia",
      deleteExpert: "deleteChuyenGia",
    }),
  });
}
