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

function criterionStt(criterion) {
  return String(criterion.stt || criterion.sourceStt || "").trim().replace(/\.$/, "");
}

function isDescendantCriterion(criterion, parent) {
  return criterion.group === parent.group
    && criterionStt(criterion).startsWith(`${criterionStt(parent)}.`);
}

function nextChildStt(criteria, parent) {
  const parentStt = criterionStt(parent);
  const suffixes = criteria.filter((criterion) => isDescendantCriterion(criterion, parent))
    .map((criterion) => criterionStt(criterion).slice(parentStt.length + 1))
    .filter((suffix) => /^\d+$/.test(suffix))
    .map(Number);
  return `${parentStt}.${(suffixes.length ? Math.max(...suffixes) : 0) + 1}`;
}

export async function addDetailedEvaluationCriterion(appController, parentCriterionId = "") {
  const state = resolveDetailedEvaluationState(appController);
  if (!state?.bid || !state.report || state.readOnly) return false;
  const activeGroup = appController.selectedDetailedEvaluationTab;
  if (!(state.context.editableGroups || []).includes(activeGroup)) return false;
  const detail = appController.view.getActiveElement("danhgiahsdt-detail-view");
  const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
    detail
      ? collectConfiguredDetailedEvaluationCriteria(detail, state.criteria)
      : state.criteria,
  );
  const configuredBaseCriteria = mergeConfiguredCriteria(state.baseCriteria, configuredCriteria);
  const parent = parentCriterionId
    ? configuredCriteria.find((criterion) => String(criterion.id) === String(parentCriterionId))
    : null;
  if (parentCriterionId && (activeGroup !== "technical" || parent?.group !== activeGroup
    || !/^\d+(?:\.\d+)*$/.test(criterionStt(parent)))) return false;
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
  const stt = parent
    ? nextChildStt(configuredCriteria, parent)
    : nextDetailedEvaluationStt(configuredCriteria, activeGroup);
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
  const nextCriteria = [...configuredBaseCriteria];
  let insertionIndex = nextCriteria.length;
  if (parent) {
    insertionIndex = nextCriteria.findIndex((item) => String(item.id) === String(parent.id)) + 1;
    nextCriteria.forEach((item, index) => {
      if (isDescendantCriterion(item, parent)) insertionIndex = Math.max(insertionIndex, index + 1);
    });
  }
  nextCriteria.splice(insertionIndex, 0, criterion);
  appController._detailedEvaluationCriteriaOverrides.set(state.criteriaKey,
    nextCriteria.map((item, index) => ({ ...item, order: index })));
  appController._detailedEvaluationDrafts.set(state.draftKey, {
    ...state.report,
    chiTietList: [
      ...currentRows,
      buildDetailedEvaluationRow(state.report.id, criterionId),
    ],
  });
  if (activeGroup === "technical") {
    appController._detailedEvaluationEditingCriteria ||= new Map();
    const editing = appController._detailedEvaluationEditingCriteria.get(state.draftKey) || new Set();
    editing.add(criterionId);
    appController._detailedEvaluationEditingCriteria.set(state.draftKey, editing);
  }
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
  const activeGroup = appController.selectedDetailedEvaluationTab;
  if (!(state.context.editableGroups || []).includes(activeGroup)) return false;
  const detail = appController.view.getActiveElement("danhgiahsdt-detail-view");
  const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
    detail
      ? collectConfiguredDetailedEvaluationCriteria(detail, state.criteria)
      : state.criteria,
  );
  const configuredBaseCriteria = mergeConfiguredCriteria(state.baseCriteria, configuredCriteria);
  const criterion = configuredCriteria.find((item) => String(item.id) === String(criterionId));
  if (!criterion || criterion.group !== activeGroup) return false;
  const descendants = activeGroup === "technical"
    ? configuredCriteria.filter((item) => isDescendantCriterion(item, criterion))
    : [];
  if (descendants.length && !await appController.view.customConfirm(
    "Xóa tiêu chí và tiêu chí con",
    `Tiêu chí này có ${descendants.length} tiêu chí con. Xóa tiêu chí sẽ xóa cả các tiêu chí con và kết quả đánh giá tương ứng. Bạn có muốn tiếp tục?`,
    "trash-2",
  )) return false;
  const removedIds = new Set([criterion, ...descendants].map((item) => String(item.id)));
  const activeCriteria = configuredCriteria.filter(
    (item) => item.group === activeGroup,
  );
  const currentRows = detail
    ? collectActiveGroupRows(detail, state.report, activeCriteria)
    : state.report.chiTietList || [];
  appController._detailedEvaluationCriteriaOverrides.set(
    state.criteriaKey,
    configuredBaseCriteria.filter((item) => !removedIds.has(String(item.id))),
  );
  appController._detailedEvaluationDrafts.set(state.draftKey, {
    ...state.report,
    chiTietList: currentRows.filter(
      (row) => !removedIds.has(String(row.tieuChiDanhGiaId)),
    ),
  });
  const editing = appController._detailedEvaluationEditingCriteria?.get(state.draftKey);
  removedIds.forEach((id) => editing?.delete(id));
  appController._detailedEvaluationDirty = true;
  await appController.renderDetailedEvaluation();
  return true;
}
