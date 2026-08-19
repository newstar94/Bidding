import { persistAndSync } from "../shared/MutationService.js";
import {
  applyBidEvaluationPatches,
  buildBidEvaluationDraftMetadata,
  collectBidEvaluationDraftPatches,
} from "./BidEvaluationDraftState.js";
import {
  bidEvaluationDirtyStateFor,
  buildBidEvaluationRecoveryKey,
  generalBidEvaluationRecoveryFor,
} from "./BidEvaluationDraftRecovery.js";
import {
  getPackageEvaluationLotsStrict,
  isBidWithinEvaluationLotDetails,
} from "./lotEvaluationScope.js";

function collectLetters(view, model, containerId) {
  const letters = [];
  view.getActiveElement(containerId)?.querySelectorAll?.(".letter-row")?.forEach((row) => {
    const soCv = row.querySelector(".letter-so-cv")?.value.trim() || "";
    const rawDate = row.querySelector(".letter-ngay-cv")?.value.trim() || "";
    if (soCv || rawDate) {
      letters.push({ soCv, ngayCv: rawDate ? model.convertDMYToYMD(rawDate) : "" });
    }
  });
  return letters;
}

function buildReportDraft({ controller, pkg, report, includeExtraFields }) {
  const result = {
    soBaoCao: report.soBaoCao,
    ngayBaoCao: report.ngayBaoCao,
    cvLamRo: collectLetters(controller.view, controller.model, "list-cv-lamro"),
    cvTraLoi: collectLetters(controller.view, controller.model, "list-cv-traloi"),
    cvGuiCdt: collectLetters(controller.view, controller.model, "list-cv-guicdt"),
    quyTrinhDanhGia: pkg.quyTrinhDanhGia || "quytrinh1",
  };
  if (includeExtraFields) {
    result.ngayMoiDoiChieu = report.ngayMoiDoiChieu;
    result.ngayDoiChieu = report.ngayDoiChieu;
  }
  return result;
}

function stagePartialDraftMutations(model, pkgPatch, bidPatches, workspaceMutation = null) {
  const stage = (table, records) => {
    if (workspaceMutation && typeof model.commitWorkspaceMutation === "function") {
      model.commitWorkspaceMutation(workspaceMutation, table, { mode: "patch", records });
    } else {
      model.commitLocalMutation?.(table, { mode: "patch", records });
    }
  };
  stage("goithau", [pkgPatch]);
  if (bidPatches.length) {
    stage("thongtinmothau", bidPatches);
  }
}

function workspaceTokenFor(model) {
  return model?.getWorkspaceToken?.() || "";
}

function workspaceIsCurrent(model, token) {
  return !token || model?.isWorkspaceCurrent?.(token) !== false;
}

function canonicalRecord(state, table, id) {
  return (state?.[table] || []).find((record) => String(record?.id || "") === String(id || "")) || null;
}

function uniqueIds(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function sameIds(left = [], right = []) {
  const a = uniqueIds(left).sort();
  const b = uniqueIds(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function resolveAuthoritativeDraftLotDetails(pkg, requestedDetails) {
  const packageLots = getPackageEvaluationLotsStrict(pkg);
  if (!requestedDetails) {
    return packageLots.length === 0
      ? { ok: true, details: null }
      : { ok: false, details: null };
  }

  const requestedLotIds = uniqueIds(requestedDetails.lotIds);
  const packageLotIds = packageLots.map((lot) => lot.id);
  const previousPackageLotIds = (requestedDetails.packageLots || []).map((lot) => lot.id);
  const knownLots = new Map(packageLots.map((lot) => [lot.id, lot]));
  const selectedLots = requestedLotIds.map((lotId) => knownLots.get(lotId)).filter(Boolean);
  const wholeScopeChanged = requestedDetails.mode !== "selected"
    && previousPackageLotIds.length > 0
    && !sameIds(previousPackageLotIds, packageLotIds);
  if (
    requestedLotIds.length === 0
    || selectedLots.length !== requestedLotIds.length
    || wholeScopeChanged
  ) {
    return { ok: false, details: null };
  }

  return {
    ok: true,
    details: {
      ...requestedDetails,
      packageLots,
      selectedLots,
      lotIds: requestedLotIds,
      lotCodes: selectedLots.map((lot) => lot.code),
      isWholePackage: sameIds(requestedLotIds, packageLotIds),
    },
  };
}

async function notifyDraftFailure(controller, error = null, recoverySaved = true) {
  const message = error?.message
    || (recoverySaved
      ? "Bản nháp vẫn được giữ trên thiết bị và sẽ không bị mất. Vui lòng kiểm tra kết nối rồi thử lại."
      : "Không thể lưu trên máy chủ và bộ nhớ khôi phục cục bộ hiện không khả dụng. Vui lòng giữ tab này mở rồi thử lại.");
  await controller.view.customAlert?.(
    "Chưa thể lưu nháp trên máy chủ",
    message,
    "alert-triangle",
  );
}

export async function executeBidEvaluationDraftSave({
  controller,
  pkg,
  rows = [],
  round = "single",
  lotDetails = null,
  report,
  includeExtraFields = true,
  commit = persistAndSync,
} = {}) {
  if (!controller?.model || !controller?.view || !pkg?.id || typeof commit !== "function") {
    throw new TypeError("Bid evaluation draft workflow received an invalid context.");
  }
  const model = controller.model;
  const workspaceToken = workspaceTokenFor(model);
  const packageId = String(pkg.id);
  const requestedLotIds = uniqueIds(lotDetails?.lotIds);
  const recoveryKey = buildBidEvaluationRecoveryKey({
    controller,
    pkg,
    round,
    lotIds: requestedLotIds,
  });
  const dirtyState = bidEvaluationDirtyStateFor(controller, recoveryKey);
  const checkpoint = dirtyState.checkpoint();
  const recovery = generalBidEvaluationRecoveryFor(controller);
  const boundaryChecked = typeof controller.awaitAuthoritativeMutationBoundary === "function";
  try {
    if (boundaryChecked) await controller.awaitAuthoritativeMutationBoundary();
  } catch (error) {
    await notifyDraftFailure(controller, error, false);
    return false;
  }
  if (!workspaceIsCurrent(model, workspaceToken)) return false;

  const canonicalPackage = canonicalRecord(model.state, "goithau", packageId)
    || (!boundaryChecked ? pkg : null);
  const bids = model.state.thongtinmothau || [];
  const recoveryBidPatches = collectBidEvaluationDraftPatches({
    rows,
    bids,
    dirtyState,
    parseMoney: (value) => model.parseVND(value),
  });
  const reportDraft = buildReportDraft({
    controller,
    pkg: canonicalPackage || pkg,
    report,
    includeExtraFields,
  });
  const recoverySaved = recovery.save(recoveryKey, {
    packageId,
    round,
    lotIds: requestedLotIds,
    report: reportDraft,
    bidderPatches: recoveryBidPatches,
  });
  const failedStatus = recoverySaved
    ? "Chưa đồng bộ máy chủ · bản khôi phục vẫn còn trên thiết bị"
    : "Chưa đồng bộ máy chủ · khôi phục cục bộ không khả dụng";

  if (!canonicalPackage) {
    controller._bidEvaluationSaveStatusByKey ||= new Map();
    controller._bidEvaluationSaveStatusByKey.set(recoveryKey, failedStatus);
    controller._renderBidEvaluationProgress?.();
    await notifyDraftFailure(
      controller,
      new Error("Gói thầu không còn khả dụng sau khi làm mới dữ liệu."),
      recoverySaved,
    );
    return false;
  }

  let authoritativeLotScope;
  try {
    authoritativeLotScope = resolveAuthoritativeDraftLotDetails(canonicalPackage, lotDetails);
  } catch (error) {
    authoritativeLotScope = { ok: false, error };
  }
  if (!authoritativeLotScope.ok) {
    controller._bidEvaluationSaveStatusByKey ||= new Map();
    controller._bidEvaluationSaveStatusByKey.set(recoveryKey, failedStatus);
    controller._renderBidEvaluationProgress?.();
    await notifyDraftFailure(
      controller,
      new Error("Phạm vi phần lô đã thay đổi sau khi làm mới dữ liệu. Vui lòng kiểm tra lại phần lô trước khi lưu."),
      recoverySaved,
    );
    return false;
  }

  const authoritativeLotDetails = authoritativeLotScope.details;
  const authoritativeBids = authoritativeLotDetails
    ? bids.filter((bid) => isBidWithinEvaluationLotDetails(bid, authoritativeLotDetails))
    : bids;
  const authoritativeBidIds = new Set(authoritativeBids.map((bid) => String(bid?.id || "")));
  const bidPatches = recoveryBidPatches.filter(
    (patch) => authoritativeBidIds.has(String(patch?.id || "")),
  );
  const lotIds = authoritativeLotDetails?.lotIds || [];
  const nextMetadata = buildBidEvaluationDraftMetadata({
    existing: canonicalPackage.danhGiaHsdtMetadata,
    round,
    lotIds,
    report: reportDraft,
  });
  const packagePatch = {
    id: packageId,
    ...(Number.isInteger(canonicalPackage.rowVersion) ? { rowVersion: canonicalPackage.rowVersion } : {}),
    danhGiaHsdtMetadata: nextMetadata,
  };

  const ownsMutation = typeof model.beginWorkspaceMutation === "function";
  const workspaceMutation = ownsMutation ? model.beginWorkspaceMutation() : null;
  if (workspaceMutation) model.assertWorkspaceMutation?.(workspaceMutation);

  try {
    if (!workspaceIsCurrent(model, workspaceToken)) return false;
    canonicalPackage.danhGiaHsdtMetadata = nextMetadata;
    applyBidEvaluationPatches(bids, bidPatches);
    stagePartialDraftMutations(model, packagePatch, bidPatches, workspaceMutation);
    const changedBidIds = new Set(bidPatches.map((patch) => String(patch.id)));
    const persistedBids = bids.filter((bid) => changedBidIds.has(String(bid.id)));
    const tableKeys = ["goithau", ...(persistedBids.length ? ["thongtinmothau"] : [])];
    controller._bidEvaluationSaveStatusByKey ||= new Map();
    controller._bidEvaluationSaveStatusByKey.set(recoveryKey, "Đang lưu nháp trên máy chủ…");
    controller._renderBidEvaluationProgress?.();
    let result;
    try {
      result = await commit(controller, tableKeys, {
        authoritativeBoundaryChecked: boundaryChecked,
        ...(workspaceMutation ? { workspaceMutation } : {}),
        changes: {
          upserts: {
            goithau: [canonicalPackage],
            ...(persistedBids.length ? { thongtinmothau: persistedBids } : {}),
          },
        },
      });
    } catch (error) {
      controller._bidEvaluationSaveStatusByKey.set(recoveryKey, failedStatus);
      controller._renderBidEvaluationProgress?.();
      await notifyDraftFailure(controller, error, recoverySaved);
      return false;
    }
    if (!result?.ok || !workspaceIsCurrent(model, workspaceToken)) {
      controller._bidEvaluationSaveStatusByKey.set(recoveryKey, failedStatus);
      controller._renderBidEvaluationProgress?.();
      if (!result?.workspaceChanged && workspaceIsCurrent(model, workspaceToken)) {
        await notifyDraftFailure(controller, null, recoverySaved);
      }
      return false;
    }
    dirtyState.acknowledge(checkpoint, result);
    recovery.acknowledge(recoveryKey, result);
    controller._bidEvaluationSaveStatusByKey.set(
      recoveryKey,
      `Đã lưu nháp lúc ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`,
    );
    controller._renderBidEvaluationProgress?.();
    const successMessage = "Bản nháp báo cáo đánh giá đã được lưu trên máy chủ.";
    if (typeof controller.view.showToast === "function") {
      controller.view.showToast("Đã lưu nháp", successMessage, "success");
    } else {
      await controller.view.customAlert?.(
        "Đã lưu nháp",
        successMessage,
        "check-circle",
      );
    }
    return true;
  } finally {
    if (ownsMutation) model.finishWorkspaceMutation?.(workspaceMutation);
  }
}
