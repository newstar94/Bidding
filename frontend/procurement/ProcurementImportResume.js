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
  const lease = captureWorkspaceLease(this.model);
  const storage = this.model?.workspaceStorage;
  const isCurrentFlow = () => (
    isWorkspaceLeaseCurrent(this.model, lease)
    && this.model?.workspaceStorage === storage
    && this[flowSlot] === flow
    && String(this[flowSlot]?.session?.sessionId || "") === sessionId
  );
  let remoteCancelled = true;
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
        "Không thể cập nhật trạng thái phiên nhập trên máy chủ; phiên sẽ tự hết hạn.",
        "warning",
      );
    }
  } finally {
    if (isCurrentFlow()) {
      flow.controller.cancel();
      this[flowSlot] = null;
      forgetProcurementImportSession(this, { storage });
    }
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
  const assertCurrentWorkspace = () => {
    if (
      !isWorkspaceLeaseCurrent(this.model, lease)
      || this.model?.workspaceStorage !== storage
    ) {
      throw workspaceChangedError();
    }
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
    const shouldResume = await this.view?.customConfirm?.(
      "Tiếp tục nhập từ Mua Sắm Công",
      `Phiên nhập ${session.familyNo} đang dở ở phiên bản ${currentRevision.revisionNumber}. Bạn có muốn tiếp tục không?`,
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
