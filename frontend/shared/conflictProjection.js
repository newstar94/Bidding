// A rejected mutation is never a second source of truth.  The server response
// and the next canonical pull are authoritative, so there is no local
// conflict projection to retain or replay.

export function rememberConflictProjection(model, recordsByTable = {}) {
  // Kept as a compatibility no-op for callers being removed incrementally.
  void model;
  void recordsByTable;
}

export function retainedConflictRecord(model, table, id) {
  void model;
  void table;
  void id;
  return null;
}

export function updateRetainedConflictRecord(model, table, record) {
  void model;
  void table;
  void record;
  return false;
}

export function forgetConflictProjection(model, table = null, ids = []) {
  void model;
  void table;
  void ids;
}

export function retainAuthorizedConflictRecord(model, table, record) {
  void model;
  void table;
  return record;
}

export function filterConflictReplay(model, table, records, { patch = false } = {}) {
  void model;
  void table;
  void patch;
  return (Array.isArray(records) ? records : [records]).filter(Boolean);
}

export function hasConflictProjection(model, table = null) {
  void model;
  void table;
  return false;
}

export function canonicalConflictPersistence(model, table, records, storedRecords = []) {
  void model;
  void table;
  void storedRecords;
  return Array.isArray(records) ? records : [];
}
