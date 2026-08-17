import { escapeHtml } from "../shared/view_helpers.js";
import { isNextEvaluationStepSaved } from "./bidProcessValidation.js";
import { resolvePackageResultStatus } from "./lotEvaluationScope.js";
import { isViolationConfirmed, VIOLATION_NOT_CHECKED } from "./openingContractorLookup.js";
import { resolveWorkflowActionMode, WORKFLOW_ACTION_MODE } from "./workflowActionState.js";

export function buildOpeningActionState({
  pkg,
  hasSavedOpeningData = false,
  isEditing = false,
  effectiveStatus = resolvePackageResultStatus(pkg),
} = {}) {
  const isNextStepSaved = isNextEvaluationStepSaved(pkg);
  const isCompleted = Boolean(
    hasSavedOpeningData
    || (
      pkg?.trangThai !== "Đang mời thầu"
      && pkg?.trangThai !== "Đã mở thầu"
      && isNextStepSaved
    ),
  );
  const isFinal = effectiveStatus === "Đã có kết quả" || effectiveStatus === "Hủy thầu";
  const actionMode = resolveWorkflowActionMode({
    isCompleted,
    isEditing,
    isNextStepSaved,
    isFinal,
  });
  return {
    actionMode,
    isCompleted,
    isEditable: actionMode === WORKFLOW_ACTION_MODE.SAVE,
    isFinal,
    isNextStepSaved,
    isReadOnly: actionMode !== WORKFLOW_ACTION_MODE.SAVE,
  };
}

export function buildOpeningContractorIdentity({
  value,
  className,
  contractorVersionId = "",
  violationStatus = VIOLATION_NOT_CHECKED,
} = {}) {
  const violationConfirmed = isViolationConfirmed(violationStatus);
  const violationClass = violationConfirmed ? " bidder-name--violator" : "";
  const linkColorClass = violationConfirmed ? "" : " text-blue";
  return contractorVersionId
    ? `<a href="#" data-bf-action="show-contractor" data-id="${escapeHtml(contractorVersionId)}" class="${className} link-hover${linkColorClass}${violationClass}">${value}</a>`
    : `<span class="${className}${violationClass}">${value}</span>`;
}
