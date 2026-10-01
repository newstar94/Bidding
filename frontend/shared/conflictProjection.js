// Rejected input belongs only to the current model/role. Canonical reads still
// run and authorize normally; their returned rows determine what may be shown.
const retainedByModel = new WeakMap();

function currentProjection(model) {
  const projection = retainedByModel.get(model);
  if (!projection) return null;
  if (projection.state !== model.state
    || projection.token !== String(model.getWorkspaceToken?.() || "")
    || projection.role !== String(model.state?.activerole || "")) {
    retainedByModel.delete(model);
    return null;
  }
  return projection;
}

function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && sameValue(left[key], right[key]));
}

export function rememberConflictProjection(model, recordsByTable = {}) {
  let projection = currentProjection(model);
  if (!projection) {
    projection = {
      state: model.state,
      token: String(model.getWorkspaceToken?.() || ""),
      role: String(model.state?.activerole || ""),
      tables: new Map(),
    };
    retainedByModel.set(model, projection);
  }
  for (const [table, records] of Object.entries(recordsByTable)) {
    const rows = projection.tables.get(table) || new Map();
    for (const record of records || []) {
      if (record?.id !== undefined && record?.id !== null) {
        rows.set(String(record.id), structuredClone(record));
      }
    }
    projection.tables.set(table, rows);
  }
}

export function retainedConflictRecord(model, table, id) {
  return currentProjection(model)?.tables.get(table)?.get(String(id)) || null;
}

export function updateRetainedConflictRecord(model, table, record) {
  const rows = currentProjection(model)?.tables.get(table);
  const id = String(record?.id || "");
  if (!rows?.has(id)) return false;
  rows.set(id, structuredClone(record));
  return true;
}

export function forgetConflictProjection(model, table = null, ids = []) {
  if (!table) {
    retainedByModel.delete(model);
    return;
  }
  const rows = currentProjection(model)?.tables.get(table);
  for (const id of ids) rows?.delete(String(id));
}

export function retainAuthorizedConflictRecord(model, table, record) {
  const retained = retainedConflictRecord(model, table, record?.id);
  return retained ? structuredClone(retained) : record;
}

export function filterConflictReplay(model, table, records, { patch = false } = {}) {
  return (Array.isArray(records) ? records : [records]).filter((record) => {
    if (!record) return false;
    const retained = retainedConflictRecord(model, table, record.id);
    if (!retained) return true;
    // A later explicit correction becomes its own mutation. Merely persisting
    // the visible rejected projection must not create another outbox receipt.
    const unchanged = patch
      ? Object.keys(record).every((key) => sameValue(retained[key], record[key]))
      : sameValue(retained, record);
    if (unchanged) return false;
    forgetConflictProjection(model, table, [record.id]);
    return true;
  });
}

export function hasConflictProjection(model, table = null) {
  const projection = currentProjection(model);
  return table ? Boolean(projection?.tables.get(table)?.size)
    : Boolean(projection && [...projection.tables.values()].some((rows) => rows.size));
}

export function canonicalConflictPersistence(model, table, records, storedRecords = []) {
  const canonicalById = new Map(storedRecords.map((record) => [String(record.id), record]));
  return records.flatMap((record) => {
    const retained = retainedConflictRecord(model, table, record.id);
    if (!retained || !sameValue(retained, record)) return [record];
    const canonical = canonicalById.get(String(record.id));
    return canonical ? [canonical] : [];
  });
}
