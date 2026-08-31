import { DraftRecoveryStore } from "../shared/DraftRecoveryStore.js";
import { createBidEvaluationDirtyState } from "./BidEvaluationDraftState.js";
import {
  BID_EVALUATION_FIELD_BY_SELECTOR,
  BID_EVALUATION_SELECTOR_BY_FIELD,
  collectBidEvaluationDraftPatches,
} from "./BidEvaluationDraftState.js";
import { addEvaluationLetterRow } from "./bidEvaluationRender.js";

const STORAGE_KEY = "bf_general_evaluation_drafts_v1";

function keyPart(value, fallback) {
  return encodeURIComponent(String(value || fallback));
}

export function buildBidEvaluationRecoveryKey({
  controller,
  pkg,
  round = "single",
  lotIds = [],
  context = "general",
} = {}) {
  const workspace = controller?.model?.workspaceScope || {};
  const lotScope = [...new Set((lotIds || []).map(String).filter(Boolean))].sort().join(",") || "all";
  return [
    keyPart(workspace.userId, "anonymous"),
    keyPart(workspace.organizationId || workspace.token, "no-workspace"),
    keyPart(pkg?.id, "no-package"),
    keyPart(round, "single"),
    keyPart(lotScope, "all"),
    keyPart(context, "general"),
  ].join("|");
}

export function generalBidEvaluationRecoveryFor(controller) {
  const storage = controller?.model?.workspaceStorage || globalThis.localStorage;
  if (!controller._generalBidEvaluationRecovery
    || controller._generalBidEvaluationRecovery.storage !== storage) {
    controller._generalBidEvaluationRecovery = new DraftRecoveryStore(storage, {
      storageKey: STORAGE_KEY,
      payloadField: "draft",
      onError: (error) => {
        console.warn("Bid evaluation local recovery is unavailable.", error);
        if (!controller._generalBidEvaluationRecoveryWarningShown) {
          controller._generalBidEvaluationRecoveryWarningShown = true;
          controller.view?.showToast?.(
            "Không thể tạo bản khôi phục",
            "Bộ nhớ cục bộ không khả dụng. Hãy lưu nháp lên máy chủ và giữ tab mở nếu đang mất mạng.",
            "warning",
          );
        }
      },
    });
  }
  return controller._generalBidEvaluationRecovery;
}

export function bidEvaluationDirtyStateFor(controller, recoveryKey) {
  controller._bidEvaluationDirtyStates = controller._bidEvaluationDirtyStates || new Map();
  if (!controller._bidEvaluationDirtyStates.has(recoveryKey)) {
    controller._bidEvaluationDirtyStates.set(recoveryKey, createBidEvaluationDirtyState());
  }
  return controller._bidEvaluationDirtyStates.get(recoveryKey);
}

export function shareBidEvaluationDirtyState(controller, sourceKey, targetKey) {
  if (!controller || !sourceKey || !targetKey || sourceKey === targetKey) {
    return bidEvaluationDirtyStateFor(controller, sourceKey || targetKey);
  }
  const source = bidEvaluationDirtyStateFor(controller, sourceKey);
  controller._bidEvaluationDirtyStates.set(targetKey, source);
  return source;
}

const REPORT_FIELDS = Object.freeze({
  "danhgiahsdt-so-baocao": "soBaoCao",
  "danhgiahsdt-ngay-baocao": "ngayBaoCao",
  "danhgiahsdt-ngay-moi-doichieu": "ngayMoiDoiChieu",
  "danhgiahsdt-ngay-doichieu": "ngayDoiChieu",
});

const LETTER_CONTAINERS = Object.freeze({
  "list-cv-lamro": "cvLamRo",
  "list-cv-traloi": "cvTraLoi",
  "list-cv-guicdt": "cvGuiCdt",
});

function letterSnapshot(controller, containerId) {
  return Array.from(
    controller.view.getActiveElement(containerId)?.querySelectorAll?.(".letter-row") || [],
  ).map((row) => ({
    soCv: String(row.querySelector?.(".letter-so-cv")?.value || "").trim(),
    ngayCv: String(row.querySelector?.(".letter-ngay-cv")?.value || "").trim(),
  })).filter((letter) => letter.soCv || letter.ngayCv);
}

function reportSnapshot(controller) {
  return {
    ...Object.fromEntries(Object.entries(REPORT_FIELDS).map(([id, field]) => [
    field,
    String(controller.view.getActiveElement(id)?.value || "").trim(),
    ])),
    ...Object.fromEntries(Object.entries(LETTER_CONTAINERS).map(([id, field]) => [
      field,
      letterSnapshot(controller, id),
    ])),
  };
}

function bindOnce(element, bindingKey, eventNames, callback) {
  if (!element?.addEventListener) return;
  element.__bfEvaluationDraftBindings = element.__bfEvaluationDraftBindings || new Set();
  if (element.__bfEvaluationDraftBindings.has(bindingKey)) return;
  element.__bfEvaluationDraftBindings.add(bindingKey);
  eventNames.forEach((eventName) => element.addEventListener(eventName, callback));
}

function applyRecoveredDraft({ controller, rows, dirtyState, recovered }) {
  const draft = recovered?.draft;
  if (!draft) return false;
  Object.entries(draft.report || {}).forEach(([field, value]) => {
    const id = Object.keys(REPORT_FIELDS).find((key) => REPORT_FIELDS[key] === field);
    const control = id ? controller.view.getActiveElement(id) : null;
    if (!control) return;
    control.value = value || "";
    dirtyState.markReportField(field);
  });
  Object.entries(LETTER_CONTAINERS).forEach(([containerId, field]) => {
    if (!Array.isArray(draft.report?.[field])) return;
    const container = controller.view.getActiveElement(containerId);
    if (!container) return;
    container.replaceChildren?.();
    draft.report[field].forEach((letter) => addEvaluationLetterRow({
      view: controller.view,
      model: controller.model,
      containerId,
      letter,
      readOnly: false,
    }));
    dirtyState.markReportField(field);
  });
  const rowsById = new Map((rows || []).map((row) => [
    String(row.getAttribute?.("data-bid-id") || ""), row,
  ]));
  (draft.bidderPatches || []).forEach((patch) => {
    const row = rowsById.get(String(patch.id || ""));
    if (!row) return;
    Object.entries(patch).forEach(([field, value]) => {
      const selector = BID_EVALUATION_SELECTOR_BY_FIELD[field];
      if (field === "chapThuanGiaDeNghiTrungThauDuoi50") {
        row.querySelectorAll?.(selector)?.forEach((radio) => {
          radio.checked = String(radio.value) === String(value);
        });
        dirtyState.markBidField(patch.id, field);
        return;
      }
      const control = selector ? row.querySelector?.(selector) : null;
      if (!control) return;
      control.value = value ?? "";
      dirtyState.markBidField(patch.id, field);
    });
  });
  return true;
}

export function bindBidEvaluationDraftTracking({
  controller,
  pkg,
  rows = [],
  bids = [],
  round = "single",
  lotIds = [],
  onChange = () => {},
} = {}) {
  const recoveryKey = buildBidEvaluationRecoveryKey({ controller, pkg, round, lotIds });
  const dirtyState = bidEvaluationDirtyStateFor(controller, recoveryKey);
  const recovery = generalBidEvaluationRecoveryFor(controller);
  const scheduleRecovery = () => {
    const capturedSnapshot = structuredClone({
      packageId: pkg.id,
      round,
      lotIds: [...lotIds],
      report: reportSnapshot(controller),
      bidderPatches: collectBidEvaluationDraftPatches({
        rows,
        bids,
        dirtyState,
        parseMoney: (value) => controller.model.parseVND(value),
      }),
    });
    const workspaceToken = String(controller.model.getWorkspaceToken?.() || "");
    controller._pendingBidEvaluationDraftSnapshots ||= new Map();
    const pendingEntry = { snapshot: capturedSnapshot, workspaceToken };
    controller._pendingBidEvaluationDraftSnapshots.set(recoveryKey, pendingEntry);
    recovery.schedule(recoveryKey, () => {
      if (controller._pendingBidEvaluationDraftSnapshots?.get(recoveryKey) === pendingEntry) {
        controller._pendingBidEvaluationDraftSnapshots.delete(recoveryKey);
      }
      return capturedSnapshot;
    });
    onChange();
  };
  Object.entries(REPORT_FIELDS).forEach(([id, field]) => {
    const control = controller.view.getActiveElement(id);
    bindOnce(control, `${recoveryKey}:${field}`, ["input", "change"], () => {
      dirtyState.markReportField(field);
      scheduleRecovery();
    });
  });
  Object.entries(LETTER_CONTAINERS).forEach(([containerId, field]) => {
    const container = controller.view.getActiveElement(containerId);
    bindOnce(container, `${recoveryKey}:${field}`, ["input", "change"], () => {
      dirtyState.markReportField(field);
      scheduleRecovery();
    });
  });
  (rows || []).forEach((row) => {
    const bidId = String(row.getAttribute?.("data-bid-id") || "");
    bindOnce(row, `${recoveryKey}:${bidId}:delegated`, ["input", "change"], (event) => {
      const target = event.target;
      const match = Object.entries(BID_EVALUATION_FIELD_BY_SELECTOR).find(
        ([selector]) => target?.matches?.(selector),
      );
      if (!match) return;
      dirtyState.markBidField(bidId, match[1]);
      scheduleRecovery();
    });
  });
  controller._restoredBidEvaluationDraftBodies ||= new Map();
  const renderedBody = controller.view.getActiveElement("danhgiahsdt-table-tbody");
  let restoredBodies = controller._restoredBidEvaluationDraftBodies.get(recoveryKey);
  if (!restoredBodies) {
    restoredBodies = new WeakSet();
    controller._restoredBidEvaluationDraftBodies.set(recoveryKey, restoredBodies);
  }
  const pendingEntry = controller._pendingBidEvaluationDraftSnapshots?.get(recoveryKey);
  // The evaluation renderer reuses the same tbody element while replacing
  // its controls. A pending in-memory draft must therefore be reapplied even
  // when this body was seen before; the WeakSet only suppresses repeated
  // restoration of an older durable draft.
  const shouldRestore = renderedBody
    && (!restoredBodies.has(renderedBody)
      || Boolean(pendingEntry)
      || dirtyState.hasChanges());
  let restored = false;
  if (shouldRestore) {
    restoredBodies.add(renderedBody);
    const currentWorkspaceToken = String(controller.model.getWorkspaceToken?.() || "");
    const pendingRecovery = pendingEntry
      && (!pendingEntry.workspaceToken || pendingEntry.workspaceToken === currentWorkspaceToken)
      ? { draft: pendingEntry.snapshot }
      : null;
    restored = applyRecoveredDraft({
      controller,
      rows,
      dirtyState,
      recovered: pendingRecovery || recovery.restore(recoveryKey),
    });
    if (restored) {
      controller._bidEvaluationSaveStatusByKey ||= new Map();
      controller._bidEvaluationSaveStatusByKey.set(
        recoveryKey,
        "Đã khôi phục thay đổi cục bộ · chưa đồng bộ máy chủ",
      );
    }
  }
  return { recoveryKey, dirtyState, recovery, restored };
}
