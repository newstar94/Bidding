import { markHierarchicalDetailedEvaluationCriteria } from "./detailedEvaluationHierarchy.js";
import {
  collectActiveGroupRows,
  collectConfiguredDetailedEvaluationCriteria,
} from "./DetailedEvaluationPanelController.js";
import {
  buildDetailedEvaluationRow,
  resolveDetailedEvaluationState,
} from "./DetailedEvaluationState.js";

export function mergeConfiguredCriteria(baseCriteria, configuredCriteria) {
  const configured = new Map(configuredCriteria.map((criterion) => [
    String(criterion.id),
    criterion,
  ]));
  return baseCriteria.map((criterion) => {
    const visible = configured.get(String(criterion.id));
    if (!visible) return criterion;
    return {
      ...criterion,
      name: visible.name,
      stt: visible.stt,
      sourceStt: visible.stt,
      requirement: visible.requirement || "",
      resultType: visible.resultType || criterion.resultType,
      maxScore: visible.maxScore ?? null,
      minScore: visible.minScore ?? null,
    };
  });
}

function nextDetailedEvaluationStt(criteria, group) {
  const topLevels = criteria
    .filter((criterion) => criterion.group === group)
    .map((criterion) => Number(String(criterion.stt || "").split(".")[0]))
    .filter(Number.isInteger);
  return String((topLevels.length > 0 ? Math.max(...topLevels) : 0) + 1);
}

export async function addDetailedEvaluationCriterion(appController) {
  const state = resolveDetailedEvaluationState(appController);
  if (!state?.bid || !state.report || state.readOnly) return false;
  const detail = appController.view.getActiveElement("danhgiahsdt-detail-view");
  const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
    detail
      ? collectConfiguredDetailedEvaluationCriteria(detail, state.criteria)
      : state.criteria,
  );
  const configuredBaseCriteria = mergeConfiguredCriteria(state.baseCriteria, configuredCriteria);
  const activeGroup = appController.selectedDetailedEvaluationTab;
  const activeCriteria = configuredCriteria.filter((criterion) => criterion.group === activeGroup);
  const currentRows = detail
    ? collectActiveGroupRows(detail, state.report, activeCriteria)
    : state.report.chiTietList || [];
  appController._detailedEvaluationCriterionSequence = (
    appController._detailedEvaluationCriterionSequence || 0
  ) + 1;
  const criterionId = [
    "evaluation-criterion",
    state.pkg.id,
    state.roundType,
    activeGroup,
    Date.now(),
    appController._detailedEvaluationCriterionSequence,
  ].join(":");
  const stt = nextDetailedEvaluationStt(configuredCriteria, activeGroup);
  const criterion = {
    id: criterionId,
    code: `CUSTOM_${appController._detailedEvaluationCriterionSequence}`,
    name: "",
    group: activeGroup,
    resultType: activeGroup === "technical" && state.context.technicalEvaluationMethod === "score"
      ? "score"
      : "pass_fail",
    required: true,
    maxScore: null,
    minScore: null,
    requirement: "",
    stt,
    sourceStt: stt,
    order: configuredBaseCriteria.length,
    source: "custom",
    isCustom: true,
  };
  appController._detailedEvaluationCriteriaOverrides.set(
    state.criteriaKey,
    [...configuredBaseCriteria, criterion],
  );
  appController._detailedEvaluationDrafts.set(state.draftKey, {
    ...state.report,
    chiTietList: [
      ...currentRows,
      buildDetailedEvaluationRow(state.report.id, criterionId),
    ],
  });
  appController._detailedEvaluationDirty = true;
  await appController.renderDetailedEvaluation();
  appController.view.getActiveElement("danhgiahsdt-detail-view")?.querySelector(
    `[data-detailed-criterion-id="${criterionId}"] [data-detailed-config-field="name"]`,
  )?.focus?.();
  return true;
}

export async function removeDetailedEvaluationCriterion(appController, criterionId) {
  const state = resolveDetailedEvaluationState(appController);
  if (!state?.report || state.readOnly) return false;
  const detail = appController.view.getActiveElement("danhgiahsdt-detail-view");
  const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
    detail
      ? collectConfiguredDetailedEvaluationCriteria(detail, state.criteria)
      : state.criteria,
  );
  const configuredBaseCriteria = mergeConfiguredCriteria(state.baseCriteria, configuredCriteria);
  const activeCriteria = configuredCriteria.filter(
    (criterion) => criterion.group === appController.selectedDetailedEvaluationTab,
  );
  const currentRows = detail
    ? collectActiveGroupRows(detail, state.report, activeCriteria)
    : state.report.chiTietList || [];
  appController._detailedEvaluationCriteriaOverrides.set(
    state.criteriaKey,
    configuredBaseCriteria.filter((criterion) => String(criterion.id) !== String(criterionId)),
  );
  appController._detailedEvaluationDrafts.set(state.draftKey, {
    ...state.report,
    chiTietList: currentRows.filter(
      (row) => String(row.tieuChiDanhGiaId) !== String(criterionId),
    ),
  });
  appController._detailedEvaluationDirty = true;
  await appController.renderDetailedEvaluation();
  return true;
}
