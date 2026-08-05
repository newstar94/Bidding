function versionMetadata(record) {
  return Array.isArray(record?.allVersions) ? record.allVersions : [];
}

export async function hydrateVersionFamily(controller, tableKey, record) {
  const records = controller?.model?.state?.[tableKey];
  if (!Array.isArray(records) || typeof controller?.fetchRecordByLookup !== "function") {
    return records || [];
  }

  const loadedIds = new Set(records.map((item) => String(item?.id || "")));
  const missingIds = versionMetadata(record)
    .map((version) => String(version?.id || ""))
    .filter((id) => id && !loadedIds.has(id));

  if (missingIds.length > 0) {
    await Promise.all(missingIds.map((id) => controller.fetchRecordByLookup(tableKey, id)));
  }
  return controller.model.state[tableKey] || records;
}
