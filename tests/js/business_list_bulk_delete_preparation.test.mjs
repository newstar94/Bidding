import assert from "node:assert/strict";
import test from "node:test";
import { prepareBusinessListBulkDelete } from "../../frontend/shared/BusinessListBulkDeletePreparation.js";

const row = (id, rootId = id, version = "00", extra = {}) => ({
  id, rootId, phienBan: version, rowVersion: 3, isLatest: 1,
  tenKeHoach: `Kế hoạch ${id}`, tenGoiThau: `Gói ${id}`, tenHopDong: `Hợp đồng ${id}`,
  allVersions: [{ id, phienBan: version }], ...extra,
});
function descriptor(type, rows, extra = {}) {
  return { type, mode: "explicit", count: rows.length, totalItems: rows.length, query: {},
    selectedVersions: rows.map((item) => ({ id: item.id, rootId: item.rootId, version: item.phienBan })),
    excludedRootIds: [], ...extra };
}
function readers(data, { lists = {}, versions = [7, 7], transformRecord, transformPage, assertCurrent = () => {} } = {}) {
  const calls = [];
  let versionIndex = 0;
  const readRecord = async (table, id) => {
    calls.push(["record", table, id]);
    const item = data[table]?.find((record) => record.id === id) || null;
    return transformRecord ? transformRecord(item, table, id) : structuredClone(item);
  };
  const readPage = async (table, params) => {
    calls.push(["page", table, structuredClone(params)]);
    const key = `${table}:${params.keHoachId || ""}`;
    const rows = lists[key] || [];
    const offset = Number(params.cursor || 0);
    const items = rows.slice(offset, offset + params.pageSize);
    const hasMore = offset + items.length < rows.length;
    const result = { items, totalItems: rows.length, hasMore,
      nextCursor: hasMore ? String(offset + items.length) : "" };
    return transformPage ? transformPage(result, table, params) : result;
  };
  return { calls, readRecord, readPage, assertCurrent,
    readSyncVersion: async () => versions[Math.min(versionIndex++, versions.length - 1)] };
}
function family(...records) {
  const metadata = records.map(({ id, phienBan }) => ({ id, phienBan }));
  records.forEach((record) => { record.allVersions = metadata; });
  return records;
}

test("contract latest/all preview freezes exact canonical revisions without modifying reader rows", async () => {
  const records = family(row("c-old", "c-root", "00", { isLatest: 0 }), row("c-new", "c-root", "01", { rowVersion: 11 }));
  const snapshot = structuredClone(records);
  const preparation = await prepareBusinessListBulkDelete({ descriptor: descriptor("hopdong", [records[1]]), ...readers({ hopdong: records }) });
  assert.equal(preparation.selectedCount, 1);
  assert.deepEqual(preparation.choices.latest.deletions, [{ table: "hopdong", id: "c-new", expectedVersion: 11 }]);
  assert.equal(preparation.choices.all.versionCount, 2);
  assert.equal(preparation.syncVersion, 7);
  assert.equal(Object.isFrozen(preparation.choices.all.deletions[0]), true);
  assert.throws(() => { preparation.choices.latest.deletions[0].id = "unconfirmed"; }, TypeError);
  assert.deepEqual(records, snapshot);
});

test("plan historical selection is preserved while each explicit delete mode names its canonical family", async () => {
  const records = family(row("p-old", "p-root", "00", { isLatest: 0 }), row("p-new", "p-root", "01"));
  const preparation = await prepareBusinessListBulkDelete({ descriptor: descriptor("kehoach", [records[0]]), ...readers({ kehoach: records }) });
  assert.equal(preparation.selectedRecords[0].id, "p-old");
  assert.equal(preparation.choices.latest.deletions[0].id, "p-new");
  assert.equal(preparation.choices.all.versionCount, 2);
});

test("plan dependency guard blocks only the modes containing directly linked snapshots", async () => {
  const records = family(row("p-old", "p-root", "00", { isLatest: 0 }), row("p-new", "p-root", "01"));
  const preparation = await prepareBusinessListBulkDelete({ descriptor: descriptor("kehoach", [records[1]]),
    ...readers({ kehoach: records }, { lists: { "goithau:p-old": [row("pkg", "pkg", "00", { keHoachId: "p-old" })] } }) });
  assert.equal(preparation.choices.latest.blockedReason, "");
  assert.match(preparation.choices.all.blockedReason, /gói thầu/u);
  assert.deepEqual(preparation.choices.all.blockedRecords.map((record) => record.id), ["p-old"]);
});

test("all filtered results resolve every fresh page and honor exclusions and exact selected overrides", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => row(`c-${String(index).padStart(3, "0")}`));
  const selection = descriptor("hopdong", [rows[0]], { mode: "query", count: 204, totalItems: 205,
    excludedRootIds: [rows[204].rootId], query: { filters: [{ field: "trangThaiHopDong", operator: "in", value: ["Đang thực hiện"] }], search: "hợp đồng", page: 8, sortOrder: "desc" } });
  const session = readers({ hopdong: rows }, { lists: { "hopdong:": rows } });
  const preparation = await prepareBusinessListBulkDelete({ descriptor: selection, ...session });
  const pages = session.calls.filter(([kind]) => kind === "page");
  assert.equal(pages.length, 2);
  assert.equal(pages[0][2].sortBy, "id");
  assert.equal(pages[0][2].page, undefined);
  assert.equal(typeof pages[0][2].filters, "string");
  assert.equal(preparation.selectedCount, 204);
  assert.equal(preparation.choices.latest.deletions.some(({ id }) => id === rows[204].id), false);
});

test("query mode preserves a chosen historical plan rather than silently replacing its selected identity", async () => {
  const plans = family(row("old", "root", "00", { isLatest: 0 }), row("new", "root", "01"));
  const preparation = await prepareBusinessListBulkDelete({ descriptor: descriptor("kehoach", [plans[0]], { mode: "query" }),
    ...readers({ kehoach: plans }, { lists: { "kehoach:": [plans[1]] } }) });
  assert.equal(preparation.selectedRecords[0].id, "old");
  assert.equal(preparation.choices.latest.deletions[0].id, "new");
});

test("selection count drift, missing exclusions, duplicated records and incomplete cursor pages reject the entire preview", async () => {
  const rows = [row("c-one"), row("c-two")];
  const cases = [
    { selection: descriptor("hopdong", [rows[0]], { mode: "query", count: 1, totalItems: 1 }), lists: rows },
    { selection: descriptor("hopdong", [rows[0]], { mode: "query", count: 1, totalItems: 2, excludedRootIds: ["gone"] }), lists: rows },
    { selection: descriptor("hopdong", [rows[0]], { mode: "query", count: 2, totalItems: 2 }), lists: [rows[0], rows[0]] },
    { selection: descriptor("hopdong", [rows[0]], { mode: "query", count: 2, totalItems: 2 }), lists: rows,
      transformPage: () => ({ items: [rows[0]], totalItems: 2, hasMore: true, nextCursor: "" }) },
  ];
  for (const current of cases) {
    await assert.rejects(prepareBusinessListBulkDelete({ descriptor: current.selection,
      ...readers({ hopdong: rows }, { lists: { "hopdong:": current.lists }, transformPage: current.transformPage }) }),
    (error) => ["BULK_DELETE_SELECTION_CHANGED", "BULK_DELETE_UNCONFIRMED"].includes(error.code));
  }
});

test("canonical lookup substitution, absent records, archived records and missing revisions cannot silently reduce a deletion", async () => {
  const contract = row("chosen", "root", "01");
  const substitutions = [null, { ...contract, id: "latest-instead" }, { ...contract, rootId: "other-root" },
    { ...contract, phienBan: "02" }, { ...contract, archivedAt: "2026-10-02" }, { ...contract, rowVersion: undefined }];
  for (const substitute of substitutions) {
    await assert.rejects(prepareBusinessListBulkDelete({ descriptor: descriptor("hopdong", [contract]),
      ...readers({ hopdong: [contract] }, { transformRecord: () => substitute }) }), { code: "BULK_DELETE_RECORD_CHANGED" });
  }
});

test("incomplete or duplicate version metadata rejects family expansion", async () => {
  for (const metadata of [[], [{ id: "other", phienBan: "00" }], [{ id: "chosen", phienBan: "00" }, { id: "chosen", phienBan: "00" }]]) {
    const contract = row("chosen", "root", "00", { allVersions: metadata });
    await assert.rejects(prepareBusinessListBulkDelete({ descriptor: descriptor("hopdong", [contract]),
      ...readers({ hopdong: [contract, row("other", "root")] }) }),
    (error) => ["BULK_DELETE_RECORD_CHANGED", "BULK_DELETE_UNCONFIRMED"].includes(error.code));
  }
});

test("historical contract selections retain current latest-only action rules", async () => {
  const rows = family(row("old", "root", "00", { isLatest: 0 }), row("new", "root", "01"));
  for (const mode of ["explicit", "query"]) {
    await assert.rejects(prepareBusinessListBulkDelete({ descriptor: descriptor("hopdong", [rows[0]], { mode }),
      ...readers({ hopdong: rows }, { lists: { "hopdong:": [rows[1]] } }) }), { code: "BULK_DELETE_HISTORICAL_SELECTION" });
  }
});

test("package delete includes every plan snapshot version and opening record while retaining unrelated packages", async () => {
  const plans = family(row("plan-old", "plan", "00", { isLatest: 0 }), row("plan-new", "plan", "01"));
  const oldPackage = row("package-old", "package", "00", { isLatest: 0, keHoachId: "plan-old" });
  const newPackage = row("package-new", "package", "01", { keHoachId: "plan-new", rowVersion: 9 });
  const unrelated = row("unrelated", "unrelated", "00", { keHoachId: "plan-new" });
  const openings = [row("opening-old", "opening-old", "00", { goiThauId: oldPackage.id }),
    row("opening-new", "opening-new", "00", { goiThauId: newPackage.id, rowVersion: 12 }),
    row("opening-unrelated", "opening-unrelated", "00", { goiThauId: unrelated.id })];
  const preparation = await prepareBusinessListBulkDelete({ descriptor: descriptor("goithau", [newPackage]),
    ...readers({ kehoach: plans, goithau: [oldPackage, newPackage, unrelated], thongtinmothau: openings }, { lists: {
      "goithau:plan-old": [oldPackage], "goithau:plan-new": [newPackage, unrelated],
      "thongtinmothau:plan-old": [openings[0]], "thongtinmothau:plan-new": openings.slice(1),
    } }) });
  assert.equal(preparation.choices.latest, preparation.choices.all);
  assert.equal(preparation.choices.all.versionCount, 2);
  assert.equal(preparation.choices.all.dependencyCount, 2);
  assert.deepEqual(preparation.choices.all.deletions.map(({ id }) => id).sort(), ["opening-new", "opening-old", "package-new", "package-old"]);
  assert.equal(preparation.choices.all.deletions.find(({ id }) => id === "opening-new").expectedVersion, 12);
});

test("legacy split package roots preserve existing unique-name plan-family deletion semantics", async () => {
  const plans = family(row("plan-old", "plan", "00", { isLatest: 0 }), row("plan-new", "plan", "01"));
  const oldPackage = row("legacy-old", "legacy-old", "00", { tenGoiThau: "Thiết bị y tế", keHoachId: "plan-old" });
  const newPackage = row("legacy-new", "legacy-new", "00", { tenGoiThau: "THIET BI Y TE", keHoachId: "plan-new" });
  const preparation = await prepareBusinessListBulkDelete({ descriptor: descriptor("goithau", [newPackage]),
    ...readers({ kehoach: plans, goithau: [oldPackage, newPackage] }, { lists: {
      "goithau:plan-old": [oldPackage], "goithau:plan-new": [newPackage],
    } }) });
  assert.deepEqual(preparation.choices.all.deletions.map(({ id }) => id).sort(), ["legacy-new", "legacy-old"]);
});

test("package deletion expands metadata from every historical plan snapshot, including its earlier package versions", async () => {
  const plans = family(row("old-plan", "plan", "00", { isLatest: 0 }), row("new-plan", "plan", "01"));
  const oldFirst = row("old-first", "package", "00", { isLatest: 0, keHoachId: "old-plan" });
  const oldLast = row("old-last", "package", "01", { keHoachId: "old-plan" });
  family(oldFirst, oldLast);
  const current = row("current", "package", "02", { keHoachId: "new-plan" });
  const opening = row("old-opening", "old-opening", "00", { goiThauId: oldFirst.id });
  const preparation = await prepareBusinessListBulkDelete({ descriptor: descriptor("goithau", [current]),
    ...readers({ kehoach: plans, goithau: [oldFirst, oldLast, current], thongtinmothau: [opening] }, { lists: {
      "goithau:old-plan": [oldLast], "goithau:new-plan": [current], "thongtinmothau:old-plan": [opening],
    } }) });
  assert.deepEqual(preparation.choices.all.deletions.map(({ id }) => id).sort(), ["current", "old-first", "old-last", "old-opening"]);
  assert.equal(preparation.choices.all.versionCount, 3);
  assert.equal(preparation.choices.all.dependencyCount, 1);
});

test("package selection from an older plan snapshot is rejected without changing the selected version", async () => {
  const plans = family(row("old-plan", "plan", "00", { isLatest: 0 }), row("new-plan", "plan", "01"));
  const oldPackage = row("old-package", "pkg", "00", { keHoachId: "old-plan" });
  const newPackage = row("new-package", "pkg", "00", { keHoachId: "new-plan" });
  await assert.rejects(prepareBusinessListBulkDelete({ descriptor: descriptor("goithau", [oldPackage]),
    ...readers({ kehoach: plans, goithau: [oldPackage, newPackage] }, { lists: {
      "goithau:old-plan": [oldPackage], "goithau:new-plan": [newPackage],
    } }) }), { code: "BULK_DELETE_HISTORICAL_SELECTION" });
});

test("oversized selection is rejected and oversized package commands are blocked in full", async () => {
  const packages = [row("package")];
  const opening = row("opening", "opening", "00", { goiThauId: "package" });
  await assert.rejects(prepareBusinessListBulkDelete({ descriptor: descriptor("hopdong", [row("a"), row("b")]),
    ...readers({ hopdong: [] }), maxOperations: 1 }), { code: "BULK_DELETE_TOO_LARGE" });
  const preparation = await prepareBusinessListBulkDelete({ descriptor: descriptor("goithau", packages),
    ...readers({ goithau: packages, thongtinmothau: [opening] }, { lists: { "thongtinmothau:": [opening] } }), maxOperations: 1 });
  assert.equal(preparation.choices.all.deletions.length, 2);
  assert.match(preparation.choices.all.blockedReason, /quá 1 bản ghi/u);
  assert.equal(preparation.choices.latest.blockedReason, preparation.choices.all.blockedReason);
});

test("oversized all-version command keeps a valid latest-version choice available", async () => {
  const records = family(row("old", "root", "00", { isLatest: 0 }), row("new", "root", "01"));
  const preparation = await prepareBusinessListBulkDelete({ descriptor: descriptor("hopdong", [records[1]]),
    ...readers({ hopdong: records }), maxOperations: 1 });
  assert.equal(preparation.choices.latest.blockedReason, "");
  assert.equal(preparation.choices.latest.deletions.length, 1);
  assert.equal(preparation.choices.all.deletions.length, 2);
  assert.match(preparation.choices.all.blockedReason, /quá 1 bản ghi/u);
});

test("server membership drift and workspace changes prevent any prepared command", async () => {
  const contract = row("contract");
  await assert.rejects(prepareBusinessListBulkDelete({ descriptor: descriptor("hopdong", [contract]),
    ...readers({ hopdong: [contract] }, { versions: [7, 8] }) }), { code: "BULK_DELETE_SELECTION_CHANGED" });
  let currentChecks = 0;
  await assert.rejects(prepareBusinessListBulkDelete({ descriptor: descriptor("hopdong", [contract]),
    ...readers({ hopdong: [contract] }, { assertCurrent: () => {
      if (++currentChecks === 4) throw Object.assign(new Error("workspace changed"), { code: "WORKSPACE_CHANGED" });
    } }) }), { code: "WORKSPACE_CHANGED" });
});
