/** Stamps are editable whenever the contractor record is creatable/editable. */
export function canWriteContractorStamp(model, recordId = "", isReadOnly = false) {
  if (isReadOnly) return false;
  const userId = model?.state?.activeuser?.id;
  if (!userId) return false;
  const record = model.state?.nhathau?.find((item) => String(item.id) === String(recordId));
  if (recordId && record?.canEdit === true
      && model.hasPermission?.(userId, "nhathau", "view") === true) return true;
  return model.hasPermission?.(userId, "nhathau", recordId ? "edit" : "view") === true;
}
