const GROUP_FIELDS = Object.freeze({
  byRootId: (record) => record.rootId || record.id,
  byPlanId: (record) => record.keHoachId,
  byPackageId: (record) => record.goiThauId,
  byOpeningId: (record) => record.thongTinMoThauId,
  byContractorId: (record) => record.nhaThauId || record.thanhVienNhaThauId,
  byLotId: (record) => record.phanLoId,
});

function addGrouped(map, value, record) {
  if (value === void 0 || value === null || String(value) === "") return;
  const key = String(value);
  const group = map.get(key);
  if (group) group.push(record);
  else map.set(key, [record]);
}

export class EntityIndexes {
  constructor(getRecords, onInvalidate = null) {
    if (typeof getRecords !== "function") {
      throw new TypeError("EntityIndexes requires a record source.");
    }
    this.getRecords = getRecords;
    this.onInvalidate = typeof onInvalidate === "function" ? onInvalidate : null;
    this.cache = new Map();
  }

  invalidate(table = null, { notify = true } = {}) {
    if (table) this.cache.delete(table);
    else this.cache.clear();
    if (notify) this.onInvalidate?.(table);
  }

  indexesFor(table) {
    const records = this.getRecords(table);
    const source = Array.isArray(records) ? records : [];
    const cached = this.cache.get(table);
    if (cached && cached.source === source && cached.length === source.length) {
      return cached.indexes;
    }
    const indexes = {
      byId: new Map(),
      ...Object.fromEntries(
        Object.keys(GROUP_FIELDS).map((name) => [name, new Map()])
      ),
    };
    for (const record of source) {
      if (!record || typeof record !== "object") continue;
      if (record.id !== void 0 && record.id !== null) {
        indexes.byId.set(String(record.id), record);
      }
      for (const [name, select] of Object.entries(GROUP_FIELDS)) {
        addGrouped(indexes[name], select(record), record);
      }
    }
    this.cache.set(table, { source, length: source.length, indexes });
    return indexes;
  }

  byId(table) { return this.indexesFor(table).byId; }
  byRootId(table) { return this.indexesFor(table).byRootId; }
  byPlanId(table) { return this.indexesFor(table).byPlanId; }
  byPackageId(table) { return this.indexesFor(table).byPackageId; }
  byOpeningId(table) { return this.indexesFor(table).byOpeningId; }
  byContractorId(table) { return this.indexesFor(table).byContractorId; }
  byLotId(table) { return this.indexesFor(table).byLotId; }
}
