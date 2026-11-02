import assert from "node:assert/strict";
import test from "node:test";
import { bulkTargetLabel, resolveBusinessListBulkTargets } from "../../frontend/shared/BusinessListBulkTargets.js";

function record(type, index, overrides = {}) {
  return {
    id: `${type}-${index}`, rootId: `${type}-${index}`, phienBan: "00", isLatest: 1, rowVersion: index + 1,
    soHopDong: `HD-${index}`, tenHopDong: `Hợp đồng ${index}`, maGoiThau: `GT-${index}`, tenGoiThau: `Gói ${index}`,
    ...overrides,
  };
}

function fixture(records, { pages = null, versions = ["5", "5"], plans = {} } = {}) {
  const reads = [];
  const byId = new Map(records.map((item) => [item.id, item]));
  const versionQueue = [...versions];
  return {
    reads,
    assertCurrent() {},
    async readSyncVersion() { return versionQueue.shift() ?? "5"; },
    async readRecord(table, id) {
      reads.push(`${table}:${id}`);
      return table === "kehoach" ? plans[id] : structuredClone(byId.get(id));
    },
    async readPage(table, params) {
      reads.push(`page:${table}:${params.cursor || ""}`);
      return pages.shift();
    },
  };
}

const explicit = (type, rows) => ({
  type, mode: "explicit", count: rows.length, totalItems: rows.length, query: {},
  selectedVersions: rows.map((row) => ({ id: row.id, rootId: row.rootId, version: row.phienBan })), excludedRootIds: [],
});

test("explicit selections resolve to fresh current-version records in selection order", async () => {
  const rows = [record("hopdong", 1), record("hopdong", 2), record("hopdong", 3)];
  const session = fixture(rows);
  const result = await resolveBusinessListBulkTargets({ descriptor: explicit("hopdong", rows), ...session });
  assert.deepEqual(result.records.map((row) => row.id), ["hopdong-1", "hopdong-2", "hopdong-3"]);
  assert.equal(result.syncVersion, 5);
  assert.ok(Object.isFrozen(result.records[0]));
});

test("a historical version or a package of an older plan cancels the whole batch", async () => {
  const historical = [record("hopdong", 1), record("hopdong", 2, { isLatest: 0 })];
  await assert.rejects(
    resolveBusinessListBulkTargets({ descriptor: explicit("hopdong", historical), ...fixture(historical) }),
    { code: "BULK_ACTION_HISTORICAL_SELECTION" },
  );
  const packages = [record("goithau", 1, { keHoachId: "plan-old" })];
  await assert.rejects(
    resolveBusinessListBulkTargets({ descriptor: explicit("goithau", packages),
      ...fixture(packages, { plans: { "plan-old": { id: "plan-old", isLatest: 0 } } }) }),
    { code: "BULK_ACTION_HISTORICAL_SELECTION" },
  );
  const current = [record("goithau", 2, { keHoachId: "plan-new" })];
  const resolved = await resolveBusinessListBulkTargets({ descriptor: explicit("goithau", current),
    ...fixture(current, { plans: { "plan-new": { id: "plan-new", isLatest: 1 } } }) });
  assert.equal(resolved.records.length, 1);
});

test("select-all resolves every page, honours exclusions and explicit overrides", async () => {
  const rows = [1, 2, 3, 4].map((index) => record("goithau", index));
  const pages = [
    { items: rows.slice(0, 2), totalItems: 4, hasMore: true, nextCursor: "c1" },
    { items: rows.slice(2), totalItems: 4, hasMore: false },
  ];
  const session = fixture(rows, { pages });
  const descriptor = {
    type: "goithau", mode: "query", count: 3, totalItems: 4, query: { search: "gói" },
    selectedVersions: [{ id: "goithau-2", rootId: "goithau-2", version: "00" }], excludedRootIds: ["goithau-3"],
  };
  const result = await resolveBusinessListBulkTargets({ descriptor, ...session });
  assert.deepEqual(result.records.map((row) => row.id), ["goithau-1", "goithau-2", "goithau-4"]);
  assert.ok(session.reads.includes("page:goithau:c1"));
});

test("drift in result count, sync version or record version is rejected", async () => {
  const rows = [record("hopdong", 1), record("hopdong", 2)];
  const changedCount = { type: "hopdong", mode: "query", count: 2, totalItems: 2, query: {}, selectedVersions: [], excludedRootIds: [] };
  await assert.rejects(resolveBusinessListBulkTargets({ descriptor: changedCount,
    ...fixture(rows, { pages: [{ items: rows, totalItems: 3, hasMore: false }] }) }), { code: "BULK_ACTION_SELECTION_CHANGED" });
  await assert.rejects(resolveBusinessListBulkTargets({ descriptor: explicit("hopdong", rows),
    ...fixture(rows, { versions: ["5", "6"] }) }), { code: "BULK_ACTION_SELECTION_CHANGED" });
  const stale = explicit("hopdong", rows);
  stale.selectedVersions[0].version = "01";
  await assert.rejects(resolveBusinessListBulkTargets({ descriptor: stale, ...fixture(rows) }), { code: "BULK_ACTION_RECORD_CHANGED" });
  await assert.rejects(resolveBusinessListBulkTargets({ descriptor: explicit("hopdong", rows), ...fixture(rows), maxRecords: 1 }),
    { code: "BULK_ACTION_TOO_LARGE" });
});

test("labels combine record code and name for confirmations", () => {
  assert.equal(bulkTargetLabel(record("hopdong", 7), "hopdong"), "HD-7 – Hợp đồng 7");
  assert.equal(bulkTargetLabel({ id: "only-id" }, "kehoach"), "only-id");
});
