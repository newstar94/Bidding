import { persistAndSync, replaceTableProjection, stageLocalRecords } from "../shared/MutationService.js";
import { isConfirmedRowVersionConflict } from "../shared/DraftRecoveryStore.js";
import { aggregateDetailedEvaluationReport } from "./detailedEvaluationAggregation.js";
import { mergeConfiguredCriteria } from "./DetailedEvaluationCriteriaController.js";
import {
  applyHierarchicalDetailedEvaluationResults,
  markHierarchicalDetailedEvaluationCriteria,
} from "./detailedEvaluationHierarchy.js";
import {
  collectActiveGroupRows,
  collectConfiguredDetailedEvaluationCriteria,
} from "./DetailedEvaluationPanelController.js";
import {
  applyDetailedEvaluationProjection,
  parseDetailedEvaluationMetadata,
} from "./DetailedEvaluationState.js";
import { detailedEvaluationAutosaveFor } from "./DetailedEvaluationDraftAutosave.js";
import { serializeEvaluationMetadata } from "./evaluationMetadata.js";
import {
  validateDetailedEvaluationGroup,
  validateDetailedEvaluationReport,
} from "./detailedEvaluationValidation.js";
import {
  getBidderGoodsForBid,
  getBidderGoodsRequirements,
  isOfficialBidderGoodsRow,
} from "./bidderGoodsSelectors.js";
import { validateBidderGoodsSubmission } from "./bidderGoodsValidation.js";
import { supportsGoodsWorkflow } from "./goodsWorkflowSupport.js";

export function shouldValidateBidderGoodsOnCompletion(state, completeReport) {
  return Boolean(completeReport)
    && supportsGoodsWorkflow(state?.pkg)
    && ["single", "financial"].includes(state?.roundType);
}

export function getNextDetailedEvaluationTabAfterCompletion({
  configuredGroups = [],
  activeGroup = "",
  groupResult = "",
  completeGroup = false,
} = {}) {
  if (!completeGroup || groupResult !== "Đạt") return "";
  const activeIndex = configuredGroups.indexOf(activeGroup);
  return activeIndex >= 0 ? configuredGroups[activeIndex + 1] || "" : "";
}

function persistCriteriaOnSave(pkg, roundType, criteria, context = {}) {
  const metadata = parseDetailedEvaluationMetadata(pkg.danhGiaHsdtMetadata);
  const templateInfo = {
    templateId: context.templateId || criteria.find((item) => item.templateId)?.templateId || "",
    templateVersion: context.templateVersion
      || criteria.find((item) => item.templateVersion)?.templateVersion
      || null,
  };
  if (roundType === "single") {
    metadata.criteria = criteria;
    if (context.configuredGroups?.includes("technical") && context.technicalEvaluationMethod) {
      metadata.technicalEvaluationMethod = context.technicalEvaluationMethod;
    }
    if (templateInfo.templateId && !metadata.templateId) metadata.templateId = templateInfo.templateId;
    if (templateInfo.templateVersion && !metadata.templateVersion) {
      metadata.templateVersion = templateInfo.templateVersion;
    }
  } else {
    metadata.is1G2T = true;
    metadata[roundType] = metadata[roundType] && typeof metadata[roundType] === "object"
      ? metadata[roundType]
      : {};
    metadata[roundType].criteria = criteria;
    if (context.configuredGroups?.includes("technical") && context.technicalEvaluationMethod) {
      metadata[roundType].technicalEvaluationMethod = context.technicalEvaluationMethod;
    }
    if (templateInfo.templateId && !metadata[roundType].templateId) {
      metadata[roundType].templateId = templateInfo.templateId;
    }
    if (templateInfo.templateVersion && !metadata[roundType].templateVersion) {
      metadata[roundType].templateVersion = templateInfo.templateVersion;
    }
  }
  pkg.danhGiaHsdtMetadata = serializeEvaluationMetadata(metadata);
}

function findInvalidConfiguredCriterion(criteria) {
  return criteria.find((criterion) => (
    !String(criterion.name || "").trim()
    || !/^\d+(?:\.\d+)*$/.test(String(criterion.stt || ""))
  ));
}

async function retainConfirmedConflictInput(appController, state, report, recovery, workspaceToken, result, completionSummaryCheckpoint) {
  if (!isConfirmedRowVersionConflict(result) || result?.workspaceChanged
    || (workspaceToken && appController.model.isWorkspaceCurrent?.(workspaceToken) === false)) return;
  const retainedInput = {
    ...report,
    trangThai: state.report.trangThai,
    hoanThanhLuc: state.report.hoanThanhLuc,
    ketLuan: state.report.ketLuan,
    extension: {
      ...(report.extension || {}),
      completedGroups: [...(state.report.extension?.completedGroups || [])],
      groupResults: { ...(state.report.extension?.groupResults || {}) },
    },
  };
  appController._detailedEvaluationDrafts.set(state.draftKey, retainedInput);
  // Keep the entered rows, not the optimistic official completion. Limit the
  // normalization to this report; never replace a newly fetched canonical bid.
  const normalizeReport = (bid) => {
    if (!bid) return;
    bid.baoCaoDanhGiaChiTietList = (bid.baoCaoDanhGiaChiTietList || []).map((item) => (
      item.id === report.id && item.loaiVong === state.roundType ? retainedInput : item
    ));
    for (const [field, prior] of Object.entries(completionSummaryCheckpoint || {})) {
      if (prior.present) bid[field] = prior.value;
      else delete bid[field];
    }
  };
  normalizeReport(state.bid);
  const currentBid = (appController.model.state.thongtinmothau || []).find((bid) => String(bid.id) === String(state.bid.id));
  if (currentBid !== state.bid && appController.model.hasRetainedConflictRecord?.("thongtinmothau", state.bid.id)) {
    normalizeReport(currentBid);
  }
  appController.model.updateRetainedConflictRecord?.("thongtinmothau", currentBid || state.bid);
  const held = recovery.holdUntilReload(state.draftKey, retainedInput);
  if (!held.durableRemoval) {
    await appController.view.customAlert?.("Bộ nhớ bản nháp chưa an toàn",
      "Không thể xác nhận đã loại bản khôi phục xung đột khỏi bộ nhớ. Hãy giữ tab mở và khôi phục bộ nhớ trước khi tải lại.", "alert-triangle");
  }
}

async function alertInvalidCriterion(appController, root, criterion) {
  const row = root.querySelector(`[data-detailed-criterion-id="${criterion.id}"]`);
  const fieldName = !String(criterion.name || "").trim() ? "name" : "stt";
  const field = row?.querySelector(`[data-detailed-config-field="${fieldName}"]`);
  field?.focus?.();
  await appController.view.customAlert(
    "Tiêu chí chưa hợp lệ",
    fieldName === "name"
      ? "Vui lòng nhập nội dung tiêu chí đánh giá."
      : "STT phải có dạng 1, 2.1 hoặc 2.1.1.",
    "alert-triangle",
    field,
  );
}

async function commitDetailedChanges(appController, commit, upserts, bases, boundaryChecked) {
  const model = appController.model;
  const mutation = model.beginWorkspaceMutation?.() || null;
  try {
    for (const [table, rows] of Object.entries(upserts)) {
      const baseRows = bases[table] || [];
      const baseById = new Map(baseRows.map((row) => [String(row.id), row]));
      // The UI may have been rebound to fresh canonical objects during the
      // authority wait. Do not silently adopt their version for older input.
      const staged = rows.map((row) => {
        const base = baseById.get(String(row.id));
        if (!base) return row;
        const versioned = { ...row };
        if (base.rowVersion !== undefined) versioned.rowVersion = base.rowVersion;
        else delete versioned.rowVersion;
        return versioned;
      });
      stageLocalRecords(model, table, staged, mutation, baseRows);
    }
    return await commit(appController, Object.keys(upserts), {
      authoritativeBoundaryChecked: boundaryChecked,
      changes: { upserts },
      workspaceMutation: mutation,
      releaseBeforeRemoteSync: Boolean(mutation),
    });
  } finally {
    model.finishWorkspaceMutation?.(mutation);
  }
}

function applyInvalidatedGoodsProjection(model, bid, rows) {
  const changedById = new Map(rows.map((row) => [String(row.id), row]));
  replaceTableProjection(model, "hanghoaduthaunhathau", (
    model.state.hanghoaduthaunhathau || []
  ).map((row) => changedById.get(String(row.id)) || row));
  bid.trangThaiTinhUuDai = "stale";
}

export async function executeDetailedEvaluationSave({
  appController,
  state,
  root,
  activeGroup,
  completeGroup = false,
  completeReport = false,
  notify = true,
  commit = persistAndSync,
} = {}) {
  if (!appController?.view || !state?.bid || !state?.report || !root || state.readOnly) {
    return false;
  }
  const recovery = detailedEvaluationAutosaveFor(appController);
  const workspaceToken = appController.model.getWorkspaceToken?.() || "";
  const bases = {
    goithau: [structuredClone(state.pkg)],
    thongtinmothau: [structuredClone(state.bid)],
  };
  const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
    collectConfiguredDetailedEvaluationCriteria(root, state.criteria),
  );
  const groupCriteria = configuredCriteria.filter((criterion) => criterion.group === activeGroup);
  const enteredRows = collectActiveGroupRows(root, state.report, groupCriteria);
  const boundaryChecked = typeof appController.awaitAuthoritativeMutationBoundary === "function";
  if (boundaryChecked) {
    await appController.awaitAuthoritativeMutationBoundary();
    if (workspaceToken && appController.model.isWorkspaceCurrent?.(workspaceToken) === false) return false;
    const pkg = (appController.model.state.goithau || []).find((row) => String(row.id) === String(state.pkg.id));
    const bid = (appController.model.state.thongtinmothau || []).find((row) => String(row.id) === String(state.bid.id));
    if (!pkg || !bid || String(bid.goiThauId) !== String(pkg.id)) return false;
    state = { ...state, pkg, bid };
  }
  if (shouldValidateBidderGoodsOnCompletion(state, completeReport)) {
    const bidderGoodsRows = getBidderGoodsForBid(appController.model, state.pkg, state.bid);
    const bidderGoodsRequirements = getBidderGoodsRequirements(appController.model, state.pkg, state.bid);
    const bidderGoodsValidation = validateBidderGoodsSubmission({
      rows: bidderGoodsRows,
      requirements: bidderGoodsRequirements,
      bidPrice: state.bid?.giaDuThau,
    });
    const hasDraftRows = bidderGoodsRows.some((row) => !isOfficialBidderGoodsRow(row));
    if (!bidderGoodsValidation.valid || hasDraftRows) {
      await appController.view.customAlert(
        "Chưa thể hoàn thành đánh giá",
        hasDraftRows
          ? "Hàng hóa dự thầu phải được lưu chính thức và đồng bộ trước khi hoàn thành đánh giá."
          : bidderGoodsValidation.errors[0],
        "alert-triangle",
      );
      return false;
    }
  }
  if (typeof commit !== "function") {
    throw new TypeError("Detailed evaluation save workflow requires a commit adapter.");
  }
  if (!state.context.visibleGroups.includes(activeGroup)) {
    await appController.view.customAlert(
      "Chưa đủ điều kiện",
      "Tab đánh giá này chưa được mở theo kết quả đã lưu của phần trước.",
      "alert-triangle",
    );
    return false;
  }
  const configuredBaseCriteria = mergeConfiguredCriteria(state.baseCriteria, configuredCriteria);
  appController._detailedEvaluationCriteriaOverrides.set(state.criteriaKey, configuredBaseCriteria);
  const invalidCriterion = findInvalidConfiguredCriterion(groupCriteria);
  if (invalidCriterion) {
    await alertInvalidCriterion(appController, root, invalidCriterion);
    return false;
  }

  const evaluationGroups = state.context.editableGroups.filter((group) => group !== "bidder_goods");
  const groupsToCheck = completeReport
    ? evaluationGroups
    : completeGroup ? [activeGroup] : [];
  const emptyGroup = groupsToCheck.find((group) => !configuredCriteria.some(
    (criterion) => criterion.group === group,
  ));
  if (emptyGroup) {
    await appController.view.customAlert(
      "Chưa có tiêu chí đánh giá",
      "Vui lòng thêm dòng hoặc nhập dữ liệu từ Excel trước khi hoàn thành.",
      "alert-triangle",
    );
    return false;
  }

  const report = applyHierarchicalDetailedEvaluationResults({
    ...state.report,
    trangThai: completeReport ? "completed" : "draft",
    hoanThanhLuc: completeReport ? new Date().toISOString() : null,
    chiTietList: enteredRows,
  }, configuredCriteria);
  report.extension = {
    ...(report.extension || {}),
    workflowVersion: 2,
    ...(state.context.technicalEvaluationMethod
      ? { technicalEvaluationMethod: state.context.technicalEvaluationMethod }
      : {}),
    completedGroups: [...new Set([
      ...(report.extension?.completedGroups || []),
      ...(completeGroup ? [activeGroup] : []),
    ])],
  };
  if (completeReport) {
    const configured = state.context.configuredGroups || [];
    const accessible = state.context.visibleGroups || [];
    if (configured.some((group) => !accessible.includes(group))) {
      await appController.view.customAlert(
        "Chưa đủ điều kiện",
        "Hãy hoàn thành tuần tự các tab và bảo đảm Danh mục hàng hóa dự thầu đã sẵn sàng.",
        "alert-triangle",
      );
      return false;
    }
  }
  let invalidatedBidderGoods = false;
  let changedBidderGoods = [];
  if (!completeGroup && !completeReport) {
    const configured = state.context.configuredGroups || state.context.editableGroups;
    const activeIndex = configured.indexOf(activeGroup);
    const invalidated = new Set(activeIndex >= 0 ? configured.slice(activeIndex) : [activeGroup]);
    report.extension.completedGroups = report.extension.completedGroups.filter(
      (group) => !invalidated.has(group),
    );
    report.extension.groupResults = Object.fromEntries(
      Object.entries(report.extension.groupResults || {}).filter(([group]) => !invalidated.has(group)),
    );
    if (configured.slice(Math.max(0, activeIndex + 1)).includes("bidder_goods")) {
      changedBidderGoods = (appController.model.state.hanghoaduthaunhathau || [])
        .filter((row) => String(row.thongTinMoThauId || "") === String(state.bid.id))
        .map((row) => ({ ...row, trangThaiUuDai: "stale" }));
      bases.hanghoaduthaunhathau = structuredClone((appController.model.state.hanghoaduthaunhathau || [])
        .filter((row) => String(row.thongTinMoThauId || "") === String(state.bid.id)));
      invalidatedBidderGoods = true;
    }
  }
  if (completeReport) delete report.extension.projectionPending;
  const validation = completeReport
    ? validateDetailedEvaluationReport(report, state.context, configuredCriteria)
    : validateDetailedEvaluationGroup(
      report.chiTietList,
      groupCriteria,
      { completing: completeGroup },
    );
  if (!validation.valid) {
    const first = validation.errors[0];
    const row = root.querySelector(`[data-detailed-criterion-id="${first.criterionId}"]`);
    const field = row?.querySelector(`[data-detailed-field="${first.field}"]`)
      || row?.querySelector(`[data-detailed-config-field="${first.field}"]`);
    field?.focus?.();
    await appController.view.customAlert(
      "Dữ liệu chưa hợp lệ",
      first.message,
      "alert-triangle",
      field,
    );
    return false;
  }
  let completedGroupResult = "";
  if (completeGroup) {
    completedGroupResult = aggregateDetailedEvaluationReport({
      report,
      criteria: configuredCriteria,
      groups: [activeGroup],
    }).byGroup[activeGroup]?.status || "";
    report.extension.groupResults = {
      ...(report.extension.groupResults || {}),
      [activeGroup]: completedGroupResult,
    };
    report.extension.workflowVersion = 2;
  }
  if (completeReport) {
    report.ketLuan = aggregateDetailedEvaluationReport({
      report,
      criteria: configuredCriteria,
      groups: evaluationGroups,
    }).overall.status;
  }

  const allReports = (state.bid.baoCaoDanhGiaChiTietList || []).filter(
    (item) => item.loaiVong !== state.roundType,
  );
  allReports.push(report);
  if (invalidatedBidderGoods) {
    applyInvalidatedGoodsProjection(appController.model, state.bid, changedBidderGoods);
  }
  persistCriteriaOnSave(
    state.pkg,
    state.roundType,
    configuredBaseCriteria,
    state.context,
  );
  state.bid.baoCaoDanhGiaChiTietList = allReports;
  let completionSummaryCheckpoint = null;
  if (completeReport) {
    const projected = applyDetailedEvaluationProjection(state.bid, report, configuredCriteria, evaluationGroups, state.pkg);
    completionSummaryCheckpoint = Object.fromEntries(Object.entries(projected)
      .filter(([field, value]) => !Object.is(state.bid[field], value))
      .map(([field]) => [field, { present: Object.prototype.hasOwnProperty.call(state.bid, field), value: state.bid[field] }]));
    Object.assign(state.bid, projected);
  }
  const result = await commitDetailedChanges(appController, commit, {
    goithau: [state.pkg],
    thongtinmothau: [state.bid],
    ...(invalidatedBidderGoods ? { hanghoaduthaunhathau: changedBidderGoods } : {}),
  }, bases, boundaryChecked);
  if (!result?.ok) {
    await retainConfirmedConflictInput(appController, state, report, recovery, workspaceToken, result, completionSummaryCheckpoint);
    return false;
  }
  appController._detailedEvaluationDrafts.set(state.draftKey, report);
  detailedEvaluationAutosaveFor(appController).clear(state.draftKey);
  appController._editingDetailedEvaluationKey = null;
  appController._detailedEvaluationDirty = false;
  const nextTab = getNextDetailedEvaluationTabAfterCompletion({
    configuredGroups: state.context.configuredGroups || [],
    activeGroup,
    groupResult: completedGroupResult,
    completeGroup,
  });
  if (nextTab) appController.selectedDetailedEvaluationTab = nextTab;
  await appController.renderDetailedEvaluation();
  if (notify) {
    await appController.view.customAlert(
      "Lưu thành công",
      completeReport
        ? "Báo cáo chi tiết đã hoàn thành và cập nhật báo cáo tổng quát."
        : completeGroup
          ? nextTab
            ? "Tab đánh giá đã hoàn thành. Hệ thống đã chuyển sang tab tiếp theo."
            : "Tab đánh giá đã hoàn thành."
          : "Đã lưu bản nháp báo cáo chi tiết.",
      "check-circle",
    );
  }
  return true;
}
