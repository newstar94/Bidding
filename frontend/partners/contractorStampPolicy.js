/** Stamps are editable whenever the contractor record is creatable/editable. */
export function canWriteContractorStamp(model, recordId = "", isReadOnly = false) {
  if (isReadOnly) return false;
  const userId = model?.state?.activeuser?.id;
  if (!userId) return false;
  return model.hasPermission?.(userId, "nhathau", recordId ? "edit" : "view") === true;
}
