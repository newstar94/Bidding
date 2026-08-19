import { DraftRecoveryStore } from "../shared/DraftRecoveryStore.js";

const STORAGE_KEY = "bf_detailed_evaluation_drafts_v1";


export class DraftAutosaveStore extends DraftRecoveryStore {
  constructor(storage, options = {}) {
    super(storage, {
      ...options,
      storageKey: STORAGE_KEY,
      payloadField: "report",
      shouldStore: (report) => Boolean(report) && report.trangThai !== "completed",
    });
  }

  restore(key) {
    const draft = super.restore(key);
    if (!draft?.report || draft.report.trangThai === "completed") return null;
    return draft;
  }
}

export function detailedEvaluationAutosaveFor(controller) {
  const storage = controller?.model?.workspaceStorage || globalThis.localStorage;
  if (!controller._detailedEvaluationAutosave
    || controller._detailedEvaluationAutosave.storage !== storage) {
    controller._detailedEvaluationAutosave = new DraftAutosaveStore(storage);
  }
  return controller._detailedEvaluationAutosave;
}
