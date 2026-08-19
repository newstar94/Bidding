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
  shareBidEvaluationDirtyState,
} from "./BidEvaluationDraftRecovery.js";
import {
  getPackageEvaluationLotsStrict,
  isBidWithinEvaluationLotDetails,
} from "./lotEvaluationScope.js";
import { resolveLatestPackage } from "./detail/PackageDetailState.js";

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

const EVALUATION_SHAPE_FIELDS = [
  "phuongThucLuaChon",
  "hinhThucLuaChon",
  "phuongPhapDanhGia",
  "quyTrinhDanhGia",
];

const EVALUATION_SHAPE_DEFAULTS = {
  quyTrinhDanhGia: "quytrinh1",
};

function evaluationShapeChanged(requestedPackage, authoritativePackage) {
  return EVALUATION_SHAPE_FIELDS.some((field) => (
    String(requestedPackage?.[field] || EVALUATION_SHAPE_DEFAULTS[field] || "")
      !== String(authoritativePackage?.[field] || EVALUATION_SHAPE_DEFAULTS[field] || "")
  ));
}

function normalizedBidLotIdentity(bid, pkg) {
  if (pkg?.phanLo !== "Có") return "__whole_package__";
  const lotCode = String(bid?.maPhanLo || bid?.ma_phan_lo || "")
    .trim()
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ");
  if (lotCode) return lotCode;
  const lotId = String(bid?.phanLoId || bid?.lotId || bid?.lot_id || "").trim();
  if (!lotId) return "";
  try {
    const lot = getPackageEvaluationLotsStrict(pkg).find((item) => item.id === lotId);
    return String(lot?.code || "").trim().toLocaleLowerCase("vi-VN").replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

function logicalBidIdentity(bid, pkg) {
  const contractorId = String(bid?.nhaThauId || "").trim();
  const lotIdentity = normalizedBidLotIdentity(bid, pkg);
  return contractorId && lotIdentity ? `${contractorId}\u0000${lotIdentity}` : "";
}

function resolveDirtyBidTargets({
  dirtyBidIds,
  capturedBids,
  authoritativeBids,
  requestedPackage,
  authoritativePackage,
}) {
  const capturedById = new Map(
    capturedBids.map((bid) => [String(bid?.id || ""), bid]),
  );
  const authoritativeById = new Map(
    authoritativeBids.map((bid) => [String(bid?.id || ""), bid]),
  );
  const authoritativeByIdentity = new Map();
  authoritativeBids.forEach((bid) => {
    const identity = logicalBidIdentity(bid, authoritativePackage);
    if (!identity) return;
    const candidates = authoritativeByIdentity.get(identity) || [];
    candidates.push(bid);
    authoritativeByIdentity.set(identity, candidates);
  });

  const targets = new Map();
  for (const dirtyBidId of dirtyBidIds) {
    const sourceId = String(dirtyBidId || "");
    const source = capturedById.get(sourceId);
    const exact = authoritativeById.get(sourceId);
    if (exact) {
      const sourceIdentity = logicalBidIdentity(source, requestedPackage);
      const targetIdentity = logicalBidIdentity(exact, authoritativePackage);
      if ((sourceIdentity || targetIdentity) && sourceIdentity !== targetIdentity) {
        return { ok: false, targets: new Map() };
      }
      targets.set(sourceId, exact);
      continue;
    }
    const identity = logicalBidIdentity(source, requestedPackage);
    const candidates = identity ? authoritativeByIdentity.get(identity) || [] : [];
    if (candidates.length !== 1) return { ok: false, targets: new Map() };
    targets.set(sourceId, candidates[0]);
  }
  return { ok: true, targets };
}

function collectRetargetedBidPatches({ rows, bids, dirtyState, targets, parseMoney }) {
  const sourceIdByTargetId = new Map();
  targets.forEach((target, sourceId) => {
    sourceIdByTargetId.set(String(target?.id || ""), sourceId);
  });
  const retargetedRows = rows.map((row) => {
    const sourceId = String(row?.getAttribute?.("data-bid-id") || "");
    const target = targets.get(sourceId);
    if (!target) return row;
    return {
      getAttribute: (name) => (
        name === "data-bid-id" ? String(target.id) : row.getAttribute?.(name)
      ),
      querySelector: (selector) => row.querySelector?.(selector),
    };
  });
  return collectBidEvaluationDraftPatches({
    rows: retargetedRows,
    bids,
    dirtyState: {
      fieldsForBid: (targetId) => dirtyState.fieldsForBid(
        sourceIdByTargetId.get(String(targetId || "")) || targetId,
      ),
    },
    parseMoney,
  });
}

function saveRetargetedRecovery({
  controller,
  recovery,
  recoveryKey,
  targetRecoveryKey,
  recoverySaved,
  targetResolution,
  targetPackageId,
  round,
  requestedLotIds,
  reportDraft,
  bidPatches,
}) {
  if (!targetResolution.ok) {
    return {
      recoverySaved,
      activeRecoveryKey: recoveryKey,
      recoveryKeys: [recoveryKey],
    };
  }
  const recoveryKeys = targetRecoveryKey === recoveryKey
    ? [recoveryKey]
    : [recoveryKey, targetRecoveryKey];
  if (targetRecoveryKey !== recoveryKey) {
    shareBidEvaluationDirtyState(controller, recoveryKey, targetRecoveryKey);
  }
  const targetRecoverySaved = recovery.save(targetRecoveryKey, {
    packageId: targetPackageId,
    round,
    lotIds: requestedLotIds,
    report: reportDraft,
    bidderPatches: bidPatches,
  });
  return {
    recoverySaved: recoverySaved || targetRecoverySaved,
    activeRecoveryKey: targetRecoverySaved ? targetRecoveryKey : recoveryKey,
    recoveryKeys,
  };
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
  const capturedBids = (model.state.thongtinmothau || []).filter(
    (bid) => String(bid?.goiThauId || "") === packageId,
  );
  const capturedRecoveryBidPatches = collectBidEvaluationDraftPatches({
    rows,
    bids: capturedBids,
    dirtyState,
    parseMoney: (value) => model.parseVND(value),
  });
  const boundaryChecked = typeof controller.awaitAuthoritativeMutationBoundary === "function";
  try {
    if (boundaryChecked) await controller.awaitAuthoritativeMutationBoundary();
  } catch (error) {
    await notifyDraftFailure(controller, error, false);
    return false;
  }
  if (!workspaceIsCurrent(model, workspaceToken)) return false;

  const resolvedPackage = boundaryChecked
    ? resolveLatestPackage(model, pkg)
    : canonicalRecord(model.state, "goithau", packageId) || pkg;
  const canonicalPackage = resolvedPackage
    ? canonicalRecord(model.state, "goithau", resolvedPackage.id)
      || (!boundaryChecked ? resolvedPackage : null)
    : null;
  const targetPackageId = String(canonicalPackage?.id || packageId);
  const targetRecoveryKey = canonicalPackage
    ? buildBidEvaluationRecoveryKey({
        controller,
        pkg: canonicalPackage,
        round,
        lotIds: requestedLotIds,
      })
    : recoveryKey;
  const capturedReportDraft = buildReportDraft({
    controller,
    pkg,
    report,
    includeExtraFields,
  });
  let recoverySaved = recovery.save(recoveryKey, {
    packageId,
    round,
    lotIds: requestedLotIds,
    report: capturedReportDraft,
    bidderPatches: capturedRecoveryBidPatches,
  });
  let activeRecoveryKey = recoveryKey;
  let recoveryKeys = [recoveryKey];
  let failedStatus = recoverySaved
    ? "Chưa đồng bộ máy chủ · bản khôi phục vẫn còn trên thiết bị"
    : "Chưa đồng bộ máy chủ · khôi phục cục bộ không khả dụng";

  if (!canonicalPackage) {
    controller._bidEvaluationSaveStatusByKey ||= new Map();
    controller._bidEvaluationSaveStatusByKey.set(activeRecoveryKey, failedStatus);
    controller._renderBidEvaluationProgress?.();
    await notifyDraftFailure(
      controller,
      new Error("Gói thầu không còn khả dụng sau khi làm mới dữ liệu."),
      recoverySaved,
    );
    return false;
  }

  const bids = (model.state.thongtinmothau || []).filter(
    (bid) => String(bid?.goiThauId || "") === targetPackageId,
  );
  const dirtyBidIds = [...(checkpoint.bidFields?.keys?.() || [])];
  let authoritativeLotScope;
  try {
    authoritativeLotScope = resolveAuthoritativeDraftLotDetails(canonicalPackage, lotDetails);
  } catch (error) {
    authoritativeLotScope = { ok: false, error };
  }
  const authoritativeLotDetails = authoritativeLotScope.ok
    ? authoritativeLotScope.details
    : null;
  const authoritativeBids = authoritativeLotScope.ok && authoritativeLotDetails
    ? bids.filter((bid) => isBidWithinEvaluationLotDetails(bid, authoritativeLotDetails))
    : (authoritativeLotScope.ok ? bids : []);
  const targetResolution = authoritativeLotScope.ok
    ? resolveDirtyBidTargets({
        dirtyBidIds,
        capturedBids,
        authoritativeBids,
        requestedPackage: pkg,
        authoritativePackage: canonicalPackage,
      })
    : { ok: false, targets: new Map() };
  const bidPatches = targetResolution.ok
    ? collectRetargetedBidPatches({
        rows,
        bids: authoritativeBids,
        dirtyState,
        targets: targetResolution.targets,
        parseMoney: (value) => model.parseVND(value),
      })
    : [];
  const reportDraft = buildReportDraft({
    controller,
    pkg: canonicalPackage,
    report,
    includeExtraFields,
  });
  ({ recoverySaved, activeRecoveryKey, recoveryKeys } = saveRetargetedRecovery({
    controller,
    recovery,
    recoveryKey,
    targetRecoveryKey,
    recoverySaved,
    targetResolution,
    targetPackageId,
    round,
    requestedLotIds,
    reportDraft,
    bidPatches,
  }));
  failedStatus = recoverySaved
    ? "Chưa đồng bộ máy chủ · bản khôi phục vẫn còn trên thiết bị"
    : "Chưa đồng bộ máy chủ · khôi phục cục bộ không khả dụng";
  if (evaluationShapeChanged(pkg, canonicalPackage)) {
    controller._bidEvaluationSaveStatusByKey ||= new Map();
    controller._bidEvaluationSaveStatusByKey.set(activeRecoveryKey, failedStatus);
    controller._renderBidEvaluationProgress?.();
    await notifyDraftFailure(
      controller,
      new Error("Phương thức hoặc quy trình đánh giá đã thay đổi ở phiên bản gói thầu mới nhất. Vui lòng kiểm tra lại trước khi lưu."),
      recoverySaved,
    );
    return false;
  }

  if (!authoritativeLotScope.ok) {
    controller._bidEvaluationSaveStatusByKey ||= new Map();
    controller._bidEvaluationSaveStatusByKey.set(activeRecoveryKey, failedStatus);
    controller._renderBidEvaluationProgress?.();
    await notifyDraftFailure(
      controller,
      new Error("Phạm vi phần lô đã thay đổi sau khi làm mới dữ liệu. Vui lòng kiểm tra lại phần lô trước khi lưu."),
      recoverySaved,
    );
    return false;
  }

  if (!targetResolution.ok) {
    controller._bidEvaluationSaveStatusByKey ||= new Map();
    controller._bidEvaluationSaveStatusByKey.set(activeRecoveryKey, failedStatus);
    controller._renderBidEvaluationProgress?.();
    await notifyDraftFailure(
      controller,
      new Error("Danh sách hoặc phạm vi hồ sơ dự thầu đã thay đổi sau khi làm mới dữ liệu. Vui lòng kiểm tra lại trước khi lưu."),
      recoverySaved,
    );
    return false;
  }
  const lotIds = authoritativeLotDetails?.lotIds || [];
  const nextMetadata = buildBidEvaluationDraftMetadata({
    existing: canonicalPackage.danhGiaHsdtMetadata,
    round,
    lotIds,
    report: reportDraft,
  });
  const packagePatch = {
    id: targetPackageId,
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
    controller._bidEvaluationSaveStatusByKey.set(activeRecoveryKey, "Đang lưu nháp trên máy chủ…");
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
      controller._bidEvaluationSaveStatusByKey.set(activeRecoveryKey, failedStatus);
      controller._renderBidEvaluationProgress?.();
      await notifyDraftFailure(controller, error, recoverySaved);
      return false;
    }
    if (!result?.ok || !workspaceIsCurrent(model, workspaceToken)) {
      controller._bidEvaluationSaveStatusByKey.set(activeRecoveryKey, failedStatus);
      controller._renderBidEvaluationProgress?.();
      if (!result?.workspaceChanged && workspaceIsCurrent(model, workspaceToken)) {
        await notifyDraftFailure(controller, null, recoverySaved);
      }
      return false;
    }
    dirtyState.acknowledge(checkpoint, result);
    recoveryKeys.forEach((key) => recovery.acknowledge(key, result));
    controller._bidEvaluationSaveStatusByKey.set(
      activeRecoveryKey,
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
