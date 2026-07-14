export function upsertEntity(state, type, record, normalizeRecord) {
  const collection = Array.isArray(state[type]) ? state[type] : [];
  const normalizedRecord = normalizeRecord(record, type);
  const index = collection.findIndex((item) => item.id === normalizedRecord.id);

  if (index === -1) collection.push(normalizedRecord);
  else collection[index] = normalizedRecord;
  state[type] = collection;
  return normalizedRecord;
}

export function removeEntity(state, type, recordId) {
  const collection = Array.isArray(state[type]) ? state[type] : [];
  const removed = collection.find((item) => item.id === recordId) || null;
  state[type] = collection.filter((item) => item.id !== recordId);
  return removed;
}
