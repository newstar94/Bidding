import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { SequentialRevisionController } from "./SequentialRevisionController.js";
import { currentWorkspaceToken, workspaceChangedError } from "../app/workspaceLease.js";

const RESUME_KEY = "procurement_import_resume_v1";
const ACTIVE_STATUSES = new Set(["READY", "EDITING_REVISION", "WAITING_NEXT_CONFIRMATION"]);

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

export function rememberProcurementImportSession(controller, flow) {
  new ProcurementImportResumeStore(controller?.model?.workspaceStorage).save({
    sessionId: flow?.session?.sessionId,
    kind: flow?.session?.kind,
    familyNo: flow?.session?.familyNo,
    revisionNumber: flow?.currentDraft?.revisionNumber,
  });
}

export function forgetProcurementImportSession(controller) {
  new ProcurementImportResumeStore(controller?.model?.workspaceStorage).clear();
}

export async function cancelActiveProcurementImportSession() {
  const flow = this.procurementPlanImport || this.procurementPackageImport;
  if (!flow?.controller) return false;
  const kind = this.procurementPlanImport ? "plan" : "notice";
  let remoteCancelled = true;
  try {
    await (flow.client || new ProcurementImportClient()).cancelImportSession(
      flow.session.sessionId,
      {
        workspaceLease: currentWorkspaceToken(this.model) || null,
        kind,
      },
    );
  } catch (_error) {
    remoteCancelled = false;
    this.view?.showToast?.(
      "Đã hủy bản nháp trên máy",
      "Không thể cập nhật trạng thái phiên nhập trên máy chủ; phiên sẽ tự hết hạn.",
      "warning",
    );
  } finally {
    flow.controller.cancel();
    if (kind === "plan") this.procurementPlanImport = null;
    else this.procurementPackageImport = null;
    forgetProcurementImportSession(this);
  }
  return remoteCancelled;
}

export async function resumeProcurementImportSession({
  client = new ProcurementImportClient(),
} = {}) {
  const store = new ProcurementImportResumeStore(this.model?.workspaceStorage);
  const pointer = store.load();
  if (!pointer || this.procurementPlanImport || this.procurementPackageImport) return false;
  const workspaceLease = currentWorkspaceToken(this.model);
  const assertCurrentWorkspace = () => {
    if (currentWorkspaceToken(this.model) !== workspaceLease) throw workspaceChangedError();
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
    const currentIndex = Math.min(
      Math.max(0, Number(session.currentIndex) || 0),
      Math.max(0, revisions.length - 1),
    );
    const currentRevision = revisions[currentIndex];
    if (!currentRevision) {
      store.clear();
      return false;
    }
    const shouldResume = await this.view?.customConfirm?.(
      "Tiếp tục nhập từ Mua Sắm Công",
      `Phiên nhập ${session.familyNo} đang dở ở phiên bản ${currentRevision.revisionNumber}. Bạn có muốn tiếp tục không?`,
      "rotate-ccw",
    );
    assertCurrentWorkspace();
    if (!shouldResume) {
      try {
        await client.cancelImportSession(session.sessionId, {
          workspaceLease: workspaceLease || null,
          kind: session.kind === "PACKAGE" ? "notice" : "plan",
        });
        assertCurrentWorkspace();
      } finally {
        store.clear();
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
    await start?.call(this, {
      session, controller: sequential, currentDraft, client,
    });
    assertCurrentWorkspace();
    return true;
  } catch (error) {
    if (["PROCUREMENT_SESSION_EXPIRED", "PROCUREMENT_REVISION_INVALID"].includes(error?.code)) {
      store.clear();
      return false;
    }
    throw error;
  }
}
