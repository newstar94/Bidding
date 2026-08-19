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

function stagePartialDraftMutations(model, pkgPatch, bidPatches) {
  model.commitLocalMutation?.("goithau", { records: [pkgPatch] });
  if (bidPatches.length) {
    model.commitLocalMutation?.("thongtinmothau", { records: bidPatches });
  }
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
  const lotIds = lotDetails?.lotIds || [];
  const recoveryKey = buildBidEvaluationRecoveryKey({ controller, pkg, round, lotIds });
  const dirtyState = bidEvaluationDirtyStateFor(controller, recoveryKey);
  const checkpoint = dirtyState.checkpoint();
  const bids = controller.model.state.thongtinmothau || [];
  const bidPatches = collectBidEvaluationDraftPatches({
    rows,
    bids,
    dirtyState,
    parseMoney: (value) => controller.model.parseVND(value),
  });
  const reportDraft = buildReportDraft({
    controller,
    pkg,
    report,
    includeExtraFields,
  });
  const nextMetadata = buildBidEvaluationDraftMetadata({
    existing: pkg.danhGiaHsdtMetadata,
    round,
    lotIds,
    report: reportDraft,
  });
  const packagePatch = {
    id: pkg.id,
    ...(Number.isInteger(pkg.rowVersion) ? { rowVersion: pkg.rowVersion } : {}),
    danhGiaHsdtMetadata: nextMetadata,
  };
  const recovery = generalBidEvaluationRecoveryFor(controller);
  const recoverySaved = recovery.save(recoveryKey, {
    packageId: pkg.id,
    round,
    lotIds,
    report: reportDraft,
    bidderPatches: bidPatches,
  });
  const failedStatus = recoverySaved
    ? "Chưa đồng bộ máy chủ · bản khôi phục vẫn còn trên thiết bị"
    : "Chưa đồng bộ máy chủ · khôi phục cục bộ không khả dụng";

  pkg.danhGiaHsdtMetadata = nextMetadata;
  applyBidEvaluationPatches(bids, bidPatches);
  stagePartialDraftMutations(controller.model, packagePatch, bidPatches);
  const changedBidIds = new Set(bidPatches.map((patch) => String(patch.id)));
  const persistedBids = bids.filter((bid) => changedBidIds.has(String(bid.id)));
  const tableKeys = ["goithau", ...(persistedBids.length ? ["thongtinmothau"] : [])];
  let result;
  controller._bidEvaluationSaveStatusByKey ||= new Map();
  controller._bidEvaluationSaveStatusByKey.set(recoveryKey, "Đang lưu nháp trên máy chủ…");
  controller._renderBidEvaluationProgress?.();
  try {
    result = await commit(controller, tableKeys, {
      changes: {
        upserts: {
          goithau: [pkg],
          ...(persistedBids.length ? { thongtinmothau: persistedBids } : {}),
        },
      },
    });
  } catch (error) {
    controller._bidEvaluationSaveStatusByKey.set(
      recoveryKey,
      failedStatus,
    );
    controller._renderBidEvaluationProgress?.();
    await notifyDraftFailure(controller, error, recoverySaved);
    return false;
  }
  if (!result?.ok) {
    controller._bidEvaluationSaveStatusByKey.set(
      recoveryKey,
      failedStatus,
    );
    controller._renderBidEvaluationProgress?.();
    await notifyDraftFailure(controller, null, recoverySaved);
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
}
