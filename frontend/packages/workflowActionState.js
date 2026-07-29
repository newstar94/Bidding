export const WORKFLOW_ACTION_MODE = Object.freeze({
  SAVE: "save",
  EDIT: "edit",
  HIDDEN: "hidden",
});

export function resolveWorkflowActionMode({
  isCompleted = false,
  isEditing = false,
  isNextStepSaved = false,
  isFinal = false,
} = {}) {
  if (isFinal || isNextStepSaved) return WORKFLOW_ACTION_MODE.HIDDEN;
  if (isCompleted && !isEditing) return WORKFLOW_ACTION_MODE.EDIT;
  return WORKFLOW_ACTION_MODE.SAVE;
}

export function setWorkflowActionVisibility(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.disabled = !visible;
}
