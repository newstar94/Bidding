import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { SequentialRevisionController } from "./SequentialRevisionController.js";
import {
  captureWorkspaceLease,
  isWorkspaceLeaseCurrent,
  workspaceChangedError,
} from "../app/workspaceLease.js";
import { discardPlanVersionDraftForImportSession } from "../plans/PlanVersionDraftSession.js";

const RESUME_KEY = "procurement_import_resume_v1";
const ACTIVE_STATUSES = new Set(["READY", "EDITING_REVISION", "WAITING_NEXT_CONFIRMATION"]);

function recordRevisionAuthority(record) {
  if (!record) return null;
  return {
    id: String(record.id || ""),
    rootId: String(record.rootId || record.id_goc || record.id || ""),
    localVersion: Number(record.localVersion ?? record.phienBan ?? 0),
    rowVersion: Number(record.rowVersion ?? 0),
  };
}

function recoverMaterializedDraftAuthorities(model, sessionId) {
  const sessionRows = (model?.planVersionDraftSessions || []).flatMap((draft) => {
    const aggregate = draft?.aggregate || {};
    return (aggregate.kehoach || [])
      .filter((plan) => (
        String(plan?.sourceRevision?.sessionId || "") === String(sessionId || "")
      ))
      .map((plan) => ({ plan, aggregate }));
  });
  const latest = sessionRows.sort((left, right) => (
    Number(right.plan?.sourceRevision?.revisionNumber ?? right.plan?.phienBan ?? 0)
    - Number(left.plan?.sourceRevision?.revisionNumber ?? left.plan?.phienBan ?? 0)
  ))[0];
  if (!latest) return {};
  const packages = (latest.aggregate.goithau || []).filter((pkg) => (
    String(pkg?.keHoachId || "") === String(latest.plan.id || "")
    && String(pkg?.sourceRevision?.sessionId || "") === String(sessionId || "")
  ));
  return {
    materializedPlanAuthority: recordRevisionAuthority(latest.plan),
    materializedPackageAuthorities: packages.map(recordRevisionAuthority),
  };
}

export class ProcurementImportResumeStore {
  constructor(storage) {
    this.storage = storage;
  }

  save(value) {
    if (!this.storage || !value?.sessionId) return;
    this.storage.setItem(RESUME_KEY, JSON.stringify({
      sessionId: String(value.sessionId),
      kind: String(value.kind || "PLAN").toUpperCase(),
      familyNo: String(value.familyNo || ""),
      revisionNumber: String(value.revisionNumber || ""),
      savedAt: new Date().toISOString(),
    }));
  }

  load() {
    try {
      const value = JSON.parse(this.storage?.getItem?.(RESUME_KEY) || "null");
      return value?.sessionId ? value : null;
    } catch {
      return null;
    }
  }

  clear() {
    this.storage?.removeItem?.(RESUME_KEY);
  }
}

export function rememberProcurementImportSession(
  controller, flow, {
    revisionNumber,
    storage = controller?.model?.workspaceStorage,
  } = {},
) {
  new ProcurementImportResumeStore(storage).save({
    sessionId: flow?.session?.sessionId,
    kind: flow?.session?.kind,
    familyNo: flow?.session?.familyNo,
    revisionNumber: revisionNumber ?? flow?.currentDraft?.revisionNumber,
  });
}

export function forgetProcurementImportSession(
  controller, { storage = controller?.model?.workspaceStorage } = {},
) {
  new ProcurementImportResumeStore(storage).clear();
}

export async function cancelActiveProcurementImportSession() {
  const flow = this.procurementPlanImport || this.procurementPackageImport;
  if (!flow?.controller) return false;
  const kind = this.procurementPlanImport ? "plan" : "notice";
  const flowSlot = kind === "plan"
    ? "procurementPlanImport"
    : "procurementPackageImport";
  const sessionId = String(flow.session?.sessionId || "");
  const lease = flow.importWorkspaceLease;
  const storage = flow.importWorkspaceStorage;
  if (!lease || !Object.hasOwn(flow, "importWorkspaceStorage")) return false;
  const isCurrentFlow = () => (
    isWorkspaceLeaseCurrent(this.model, lease)
    && this.model?.workspaceStorage === storage
    && this[flowSlot] === flow
    && String(this[flowSlot]?.session?.sessionId || "") === sessionId
  );
  let remoteCancelled = true;
  if (kind === "plan") {
    await discardPlanVersionDraftForImportSession(this.model, sessionId);
  }
  try {
    await (flow.client || new ProcurementImportClient()).cancelImportSession(
      sessionId,
      {
        workspaceLease: lease.token || null,
        kind,
      },
    );
  } catch (_error) {
    remoteCancelled = false;
    if (isCurrentFlow()) {
      this.view?.showToast?.(
        "Đã hủy bản nháp trên máy",
        "Chưa thể hủy phiên trên máy chủ. Phiên vẫn được giữ để bạn thử hủy lại.",
        "warning",
      );
    }
  }
  if (remoteCancelled && isCurrentFlow()) {
    flow.controller.cancel();
    this[flowSlot] = null;
    forgetProcurementImportSession(this, { storage });
  }
  return remoteCancelled;
}

export async function resumeProcurementImportSession({
  client = new ProcurementImportClient(),
} = {}) {
  const store = new ProcurementImportResumeStore(this.model?.workspaceStorage);
  const pointer = store.load();
  if (!pointer || this.procurementPlanImport || this.procurementPackageImport) return false;
  const lease = captureWorkspaceLease(this.model);
  const workspaceLease = lease.token;
  const storage = this.model?.workspaceStorage;
  const resumeIdentity = Object.freeze({});
  const importFlowIdentity = Object.freeze({});
  let startingFlow = false;
  this._procurementImportResumeIdentity = resumeIdentity;
  const isCurrentResume = () => (
    isWorkspaceLeaseCurrent(this.model, lease)
    && this.model?.workspaceStorage === storage
    && this._procurementImportResumeIdentity === resumeIdentity
    && (startingFlow
      ? [this.procurementPlanImport, this.procurementPackageImport].every(
        (flow) => !flow || flow.importFlowIdentity === importFlowIdentity,
      )
      : !this.procurementPlanImport && !this.procurementPackageImport)
  );
  const assertCurrentWorkspace = () => {
    if (!isCurrentResume()) throw workspaceChangedError();
  };
  try {
    const session = await client.getImportSession(pointer.sessionId, {
      workspaceLease: workspaceLease || null,
      kind: pointer.kind === "PACKAGE" ? "notice" : "plan",
    });
    assertCurrentWorkspace();
    if (!ACTIVE_STATUSES.has(String(session?.status || ""))) {
      store.clear();
      return false;
    }
    const revisions = session.revisions || [];
    const serverIndex = Math.min(
      Math.max(0, Number(session.currentIndex) || 0),
      Math.max(0, revisions.length - 1),
    );
    const pointerIndex = revisions.findIndex((revision) => (
      String(revision?.revisionNumber || "") === String(pointer.revisionNumber || "")
    ));
    let currentIndex = serverIndex;
    if (session.kind === "PLAN" && pointerIndex > serverIndex) {
      const durableRevisionNumbers = new Set(
        (this.model?.planVersionDraftSessions || []).flatMap((draft) => (
          (draft.aggregate?.kehoach || [])
            .filter((plan) => (
              String(plan?.sourceRevision?.sessionId || "")
              === String(session.sessionId || "")
            ))
            .map((plan) => String(plan?.sourceRevision?.revisionNumber || ""))
        )),
      );
      const durablePrefix = revisions.slice(serverIndex, pointerIndex).every(
        (revision) => durableRevisionNumbers.has(
          String(revision?.revisionNumber || ""),
        ),
      );
      if (durablePrefix) currentIndex = pointerIndex;
    }
    const currentRevision = revisions[currentIndex];
    if (!currentRevision) {
      store.clear();
      return false;
    }
    // A reload restores the import pointer before the normal workflow data
    // hydration finishes. Resume must wait for the same data boundary used by
    // the edit form (especially the investor/contractor catalogs); otherwise
    // materialization can fail before the form is opened and the background
    // startup task only reports the failure to the console.
    const resumeWorkflowMethod = session.kind === "PACKAGE"
      ? "editGoiThau"
      : "editKeHoach";
    if (typeof this.ensureWorkflowReady === "function") {
      await this.ensureWorkflowReady(resumeWorkflowMethod);
      assertCurrentWorkspace();
    }
    const hasLocalPlanDraft = session.kind === "PLAN" && (
      this.model?.planVersionDraftSessions || []
    ).some((draft) => (
      [
        ...(draft.aggregate?.kehoach || []),
        ...(draft.aggregate?.goithau || []),
      ].some((row) => (
        String(row?.sourceRevision?.sessionId || "") === String(session.sessionId || "")
      ))
    ));
    const shouldResume = await this.view?.customConfirm?.(
      "Tiếp tục lấy dữ liệu tự động",
      `Phiên nhập ${session.familyNo} đang dở ở phiên bản ${currentRevision.revisionNumber}. `
        + (hasLocalPlanDraft
          ? "Nếu không tiếp tục, toàn bộ bản nháp của lần nhập này sẽ bị hủy và xóa. "
          : "Nếu không tiếp tục, phiên nhập sẽ dừng; mọi phiên bản đã lưu được giữ nguyên. ")
        + "Bạn có muốn tiếp tục không?",
      "rotate-ccw",
    );
    assertCurrentWorkspace();
    if (!shouldResume) {
      if (session.kind !== "PACKAGE") {
        await discardPlanVersionDraftForImportSession(
          this.model, session.sessionId,
        );
        assertCurrentWorkspace();
        this.view?.renderKeHoachTable?.();
        this.view?.renderGoiThauTable?.();
      }
      let remoteCancelled = false;
      try {
        await client.cancelImportSession(session.sessionId, {
          workspaceLease: workspaceLease || null,
          kind: session.kind === "PACKAGE" ? "notice" : "plan",
        });
        assertCurrentWorkspace();
        remoteCancelled = true;
      } finally {
        if (remoteCancelled) store.clear();
      }
      return false;
    }
    const sequential = new SequentialRevisionController({
      revisions,
      loadRevision: (revision) => client.getPlanRevisionDraft(
        session.sessionId,
        revision.revisionNumber,
        {
          workspaceLease: workspaceLease || null,
          kind: session.kind === "PACKAGE" ? "notice" : "plan",
        },
      ),
      saveRevision: async () => ({ ok: true }),
    });
    sequential.currentIndex = currentIndex;
    const currentDraft = await sequential.loadCurrent();
    assertCurrentWorkspace();
    const start = session.kind === "PACKAGE"
      ? this.startProcurementPackageImport
      : this.startProcurementPlanImport;
    const recoveredAuthorities = session.kind === "PLAN"
      ? recoverMaterializedDraftAuthorities(this.model, session.sessionId)
      : {};
    startingFlow = true;
    await start?.call(this, {
      session, controller: sequential, currentDraft, client,
      importWorkspaceLease: lease,
      importWorkspaceStorage: storage,
      importFlowIdentity,
      ...recoveredAuthorities,
    });
    assertCurrentWorkspace();
    return true;
  } catch (error) {
    if (["PROCUREMENT_SESSION_EXPIRED", "PROCUREMENT_REVISION_INVALID"].includes(error?.code)) {
      if (isCurrentResume()) store.clear();
      return false;
    }
    throw error;
  } finally {
    if (this._procurementImportResumeIdentity === resumeIdentity) {
      delete this._procurementImportResumeIdentity;
    }
  }
}
