import { persistAndSync } from "../shared/MutationService.js";
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
import {
  validateDetailedEvaluationGroup,
  validateDetailedEvaluationReport,
} from "./detailedEvaluationValidation.js";

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
    if (templateInfo.templateId && !metadata[roundType].templateId) {
      metadata[roundType].templateId = templateInfo.templateId;
    }
    if (templateInfo.templateVersion && !metadata[roundType].templateVersion) {
      metadata[roundType].templateVersion = templateInfo.templateVersion;
    }
  }
  pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
}

function findInvalidConfiguredCriterion(criteria) {
  return criteria.find((criterion) => (
    !String(criterion.name || "").trim()
    || !/^\d+(?:\.\d+)*$/.test(String(criterion.stt || ""))
  ));
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

export async function executeDetailedEvaluationSave({
  appController,
  state,
  root,
  activeGroup,
  completeGroup = false,
  completeReport = false,
  commit = persistAndSync,
} = {}) {
  if (!appController?.view || !state?.bid || !state?.report || !root || state.readOnly) {
    return false;
  }
  if (typeof commit !== "function") {
    throw new TypeError("Detailed evaluation save workflow requires a commit adapter.");
  }
  const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
    collectConfiguredDetailedEvaluationCriteria(root, state.criteria),
  );
  const groupCriteria = configuredCriteria.filter((criterion) => criterion.group === activeGroup);
  const configuredBaseCriteria = mergeConfiguredCriteria(state.baseCriteria, configuredCriteria);
  appController._detailedEvaluationCriteriaOverrides.set(state.criteriaKey, configuredBaseCriteria);
  const invalidCriterion = findInvalidConfiguredCriterion(groupCriteria);
  if (invalidCriterion) {
    await alertInvalidCriterion(appController, root, invalidCriterion);
    return false;
  }

  const groupsToCheck = completeReport
    ? state.context.editableGroups
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
    chiTietList: collectActiveGroupRows(root, state.report, groupCriteria),
  }, configuredCriteria);
  report.extension = {
    ...(report.extension || {}),
    completedGroups: [...new Set([
      ...(report.extension?.completedGroups || []),
      ...(completeGroup ? [activeGroup] : []),
    ])],
  };
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
    const field = row?.querySelector(`[data-detailed-field="${first.field}"]`);
    field?.focus?.();
    await appController.view.customAlert(
      "Dữ liệu chưa hợp lệ",
      first.message,
      "alert-triangle",
      field,
    );
    return false;
  }
  if (completeReport) {
    report.ketLuan = aggregateDetailedEvaluationReport({
      report,
      criteria: configuredCriteria,
      groups: state.context.editableGroups,
    }).overall.status;
  }

  const allReports = (state.bid.baoCaoDanhGiaChiTietList || []).filter(
    (item) => item.loaiVong !== state.roundType,
  );
  allReports.push(report);
  persistCriteriaOnSave(
    state.pkg,
    state.roundType,
    configuredBaseCriteria,
    state.context,
  );
  state.bid.baoCaoDanhGiaChiTietList = allReports;
  if (completeReport) {
    Object.assign(
      state.bid,
      applyDetailedEvaluationProjection(
        state.bid,
        report,
        configuredCriteria,
        state.context.editableGroups,
      ),
    );
  }
  const result = await commit(appController, ["goithau", "thongtinmothau"]);
  if (!result?.ok) return false;
  appController._detailedEvaluationDrafts.set(state.draftKey, report);
  appController._editingDetailedEvaluationKey = null;
  appController._detailedEvaluationDirty = false;
  await appController.view.customAlert(
    "Lưu thành công",
    completeReport
      ? "Báo cáo chi tiết đã hoàn thành và cập nhật báo cáo tổng quát."
      : completeGroup
        ? "Tab đánh giá đã hoàn thành."
        : "Đã lưu bản nháp báo cáo chi tiết.",
    "check-circle",
  );
  appController.renderDetailedEvaluation();
  return true;
}
