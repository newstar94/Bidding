import { getPackageDeleteContext } from "../packages/packageDeleteHelpers.js";
import { selectLatestVersion, versionRootId } from "./versionResolver.js";

const TYPES = new Set(["kehoach", "goithau", "hopdong"]);
const PAGE_KEYS = new Set(["page", "pageSize", "cursor", "sortBy", "sortOrder", "pagination", "includeTotal"]);
const NAMES = { kehoach: "tenKeHoach", goithau: "tenGoiThau", hopdong: "tenHopDong" };

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function stringId(value) { return String(value ?? "").trim(); }
function versionMatches(actual, expected) {
  if (expected == null || String(expected) === "") return true;
  return String(actual ?? "") === String(expected)
    || (/^\d+$/u.test(String(actual)) && /^\d+$/u.test(String(expected)) && Number(actual) === Number(expected));
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function identity(record, type) {
  return { id: stringId(record.id), rootId: versionRootId(record), version: String(record.phienBan ?? ""),
    name: String(record[NAMES[type]] || record.soHopDong || record.maKeHoach || record.maGoiThau || record.id) };
}
function verifyRecord(record, { id, rootId, version } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record) || !stringId(record.id)
    || (id && stringId(record.id) !== stringId(id))
    || (rootId && versionRootId(record) !== stringId(rootId))
    || !versionMatches(record.phienBan, version)
    || record.archivedAt || record.archived_at
    || !Number.isSafeInteger(record.rowVersion) || record.rowVersion < 1) {
    fail("BULK_DELETE_RECORD_CHANGED", "Bản ghi hoặc phiên bản đã thay đổi. Vui lòng tải lại danh sách và chọn lại.");
  }
  return record;
}
function cleanQuery(query = {}) {
  const result = {};
  for (const [key, value] of Object.entries(query)) {
    if (PAGE_KEYS.has(key) || key === "table" || value == null || value === "") continue;
    result[key] = key === "filters" && typeof value !== "string" ? JSON.stringify(value) : value;
  }
  return result;
}
function normalizeDescriptor(value, maxOperations) {
  const descriptor = structuredClone(value);
  if (!descriptor || !TYPES.has(descriptor.type) || !["explicit", "query"].includes(descriptor.mode)
    || !Number.isSafeInteger(descriptor.count) || descriptor.count < 1
    || !Array.isArray(descriptor.selectedVersions) || !Array.isArray(descriptor.excludedRootIds)) {
    fail("BULK_DELETE_SELECTION_INVALID", "Vui lòng chọn dữ liệu cần xóa.");
  }
  if (descriptor.count > maxOperations) fail("BULK_DELETE_TOO_LARGE", `Mỗi lần chỉ xử lý tối đa ${maxOperations} bản ghi. Vui lòng giảm số dòng đã chọn.`);
  const roots = new Set();
  const ids = new Set();
  for (const selected of descriptor.selectedVersions) {
    selected.id = stringId(selected.id);
    selected.rootId = stringId(selected.rootId);
    if (!selected.id || !selected.rootId || roots.has(selected.rootId) || ids.has(selected.id)) {
      fail("BULK_DELETE_SELECTION_INVALID", "Danh sách lựa chọn chứa bản ghi trùng hoặc không hợp lệ. Vui lòng chọn lại.");
    }
    roots.add(selected.rootId);
    ids.add(selected.id);
  }
  descriptor.excludedRootIds = descriptor.excludedRootIds.map(stringId);
  const exclusions = new Set(descriptor.excludedRootIds);
  if (exclusions.size !== descriptor.excludedRootIds.length || exclusions.has("")
    || [...roots].some((root) => exclusions.has(root))
    || (descriptor.mode === "explicit" && (descriptor.count !== roots.size || exclusions.size))) {
    fail("BULK_DELETE_SELECTION_INVALID", "Danh sách lựa chọn đã thay đổi. Vui lòng chọn lại.");
  }
  if (descriptor.mode === "query" && (!Number.isSafeInteger(descriptor.totalItems)
    || descriptor.totalItems - exclusions.size !== descriptor.count)) {
    fail("BULK_DELETE_SELECTION_CHANGED", "Số kết quả đã thay đổi. Vui lòng tải lại danh sách và chọn lại.");
  }
  return descriptor;
}

/** Resolve and freeze a delete preview using fresh canonical, scope-fenced reads only. */
export async function prepareBusinessListBulkDelete({
  descriptor: inputDescriptor, readPage, readRecord, readSyncVersion, assertCurrent,
  maxOperations = 2000,
}) {
  if (![readPage, readRecord, readSyncVersion, assertCurrent].every((fn) => typeof fn === "function")
    || !Number.isSafeInteger(maxOperations) || maxOperations < 1) throw new TypeError("Thiếu dữ liệu để chuẩn bị thao tác xóa.");
  const descriptor = normalizeDescriptor(inputDescriptor, maxOperations);
  const type = descriptor.type;
  const recordCache = new Map();
  const pageCache = new Map();
  const familyCache = new Map();
  // Related plan snapshots can contain unrelated rows. Bound preparation as well
  // as the eventual sync command; never truncate either set to fit a limit.
  const scanLimit = maxOperations * 5;
  let scannedRecords = 0;
  async function checkedRead(reader, ...args) {
    assertCurrent();
    const result = await reader(...args);
    assertCurrent();
    return result;
  }
  async function syncVersion() {
    const version = await checkedRead(readSyncVersion);
    if (!Number.isSafeInteger(Number(version)) || Number(version) < 0 || version == null || version === "") {
      fail("BULK_DELETE_UNCONFIRMED", "Chưa thể xác nhận dữ liệu với máy chủ. Vui lòng thử lại.");
    }
    return Number(version);
  }
  const initialSyncVersion = await syncVersion();
  async function canonical(table, expected) {
    const key = `${table}:${stringId(expected.id)}`;
    if (!recordCache.has(key)) {
      if (recordCache.size >= scanLimit) fail("BULK_DELETE_TOO_LARGE", "Dữ liệu liên quan vượt giới hạn chuẩn bị. Vui lòng giảm số dòng đã chọn.");
      const result = await checkedRead(readRecord, table, stringId(expected.id));
      recordCache.set(key, structuredClone(verifyRecord(result, expected)));
    }
    return verifyRecord(recordCache.get(key), expected);
  }
  async function allPages(table, query = {}) {
    const cleaned = cleanQuery(query);
    const key = `${table}:${JSON.stringify(cleaned)}`;
    if (pageCache.has(key)) return pageCache.get(key);
    const items = [];
    const ids = new Set();
    const cursors = new Set();
    let cursor = "";
    let expectedTotal;
    do {
      const page = await checkedRead(readPage, table, {
        ...cleaned, pageSize: 200, pagination: "cursor", sortBy: "id", sortOrder: "asc", includeTotal: "1",
        ...(cursor ? { cursor } : {}),
      });
      if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.totalItems)
        || page.totalItems < 0 || typeof page.hasMore !== "boolean") {
        fail("BULK_DELETE_UNCONFIRMED", "Máy chủ chưa trả đầy đủ danh sách cần kiểm tra. Vui lòng thử lại.");
      }
      if (expectedTotal !== undefined && expectedTotal !== page.totalItems) {
        fail("BULK_DELETE_SELECTION_CHANGED", "Danh sách thay đổi trong lúc chuẩn bị. Vui lòng tải lại và chọn lại.");
      }
      expectedTotal = page.totalItems;
      if (expectedTotal > scanLimit || scannedRecords + page.items.length > scanLimit) {
        fail("BULK_DELETE_TOO_LARGE", "Dữ liệu liên quan vượt giới hạn chuẩn bị. Vui lòng giảm số dòng đã chọn.");
      }
      scannedRecords += page.items.length;
      for (const item of page.items) {
        const id = stringId(item?.id);
        if (!id || ids.has(id)) fail("BULK_DELETE_SELECTION_CHANGED", "Máy chủ trả bản ghi trùng hoặc thiếu định danh. Vui lòng tải lại danh sách.");
        ids.add(id);
        items.push(structuredClone(item));
      }
      if (items.length > expectedTotal) fail("BULK_DELETE_SELECTION_CHANGED", "Danh sách kết quả đã thay đổi. Vui lòng tải lại và chọn lại.");
      if (!page.hasMore) break;
      const nextCursor = stringId(page.nextCursor);
      if (!page.items.length || !nextCursor || cursors.has(nextCursor)) {
        fail("BULK_DELETE_UNCONFIRMED", "Không thể đọc đầy đủ các trang dữ liệu. Vui lòng thử lại.");
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);
    if (items.length !== expectedTotal) fail("BULK_DELETE_SELECTION_CHANGED", "Danh sách chưa đầy đủ hoặc đã thay đổi. Vui lòng tải lại và chọn lại.");
    pageCache.set(key, items);
    return items;
  }
  async function versionFamily(table, target) {
    const key = `${table}:${versionRootId(target)}`;
    if (familyCache.has(key)) return familyCache.get(key);
    if (!Array.isArray(target.allVersions) || !target.allVersions.length) {
      fail("BULK_DELETE_UNCONFIRMED", "Chưa thể xác nhận đầy đủ các phiên bản. Vui lòng tải lại danh sách.");
    }
    const ids = new Set();
    const family = [];
    for (const metadata of target.allVersions) {
      const id = stringId(metadata?.id);
      if (!id || ids.has(id)) fail("BULK_DELETE_RECORD_CHANGED", "Dữ liệu phiên bản bị trùng hoặc không hợp lệ. Vui lòng tải lại.");
      ids.add(id);
      family.push(await canonical(table, { id, rootId: versionRootId(target), version: metadata.phienBan }));
    }
    if (!ids.has(stringId(target.id))) fail("BULK_DELETE_RECORD_CHANGED", "Phiên bản đã chọn không còn trong danh sách hiện tại. Vui lòng chọn lại.");
    familyCache.set(key, family);
    return family;
  }

  const explicitByRoot = new Map(descriptor.selectedVersions.map((entry) => [entry.rootId, entry]));
  const selected = [];
  if (descriptor.mode === "query") {
    const matches = await allPages(type, descriptor.query);
    if (matches.length !== descriptor.totalItems) fail("BULK_DELETE_SELECTION_CHANGED", "Số kết quả đã thay đổi từ khi chọn tất cả. Vui lòng tải lại danh sách và chọn lại.");
    const roots = new Set();
    const excluded = new Set(descriptor.excludedRootIds);
    for (const match of matches) {
      const rootId = versionRootId(match);
      if (roots.has(rootId)) fail("BULK_DELETE_SELECTION_CHANGED", "Danh sách chứa nhiều dòng của cùng một nhóm phiên bản. Vui lòng tải lại.");
      roots.add(rootId);
      if (excluded.has(rootId)) continue;
      const override = explicitByRoot.get(rootId);
      if (type !== "kehoach" && override && override.id !== stringId(match.id)) {
        fail("BULK_DELETE_HISTORICAL_SELECTION", "Gói thầu và hợp đồng chỉ được xóa từ phiên bản hiện tại. Vui lòng chọn lại phiên bản mới nhất.");
      }
      selected.push(await canonical(type, override || { id: match.id, rootId, version: match.phienBan }));
    }
    if (selected.length !== descriptor.count || [...explicitByRoot.keys(), ...excluded].some((root) => !roots.has(root))) {
      fail("BULK_DELETE_SELECTION_CHANGED", "Một số lựa chọn không còn trong kết quả lọc. Vui lòng tải lại và chọn lại.");
    }
  } else {
    for (const entry of descriptor.selectedVersions) selected.push(await canonical(type, entry));
  }

  function choice(records, dependencies = [], blockedRecords = []) {
    const commands = new Map();
    const add = (table, record) => {
      verifyRecord(record);
      commands.set(`${table}:${record.id}`, { table, id: stringId(record.id), expectedVersion: record.rowVersion });
    };
    records.forEach((record) => add(type, record));
    dependencies.forEach((record) => add("thongtinmothau", record));
    const deletions = [...commands.values()];
    const blockedReasons = [];
    if (blockedRecords.length) blockedReasons.push("Không thể xóa kế hoạch vì có gói thầu đang liên kết trực tiếp. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.");
    if (commands.size > maxOperations) blockedReasons.push(`Phạm vi này gồm quá ${maxOperations} bản ghi và dữ liệu liên quan. Vui lòng giảm số dòng đã chọn${type === "goithau" ? "." : " hoặc chọn xóa phiên bản gần nhất."}`);
    return {
      deletions, versionCount: deletions.filter((entry) => entry.table === type).length,
      dependencyCount: deletions.filter((entry) => entry.table !== type).length,
      blockedRecords: blockedRecords.map((record) => identity(record, type)),
      blockedReason: blockedReasons.join("\n"),
    };
  }

  let choices;
  if (type === "goithau") {
    const packages = new Map();
    const bids = new Map();
    for (const target of selected) {
      const planId = stringId(target.keHoachId);
      let plans = [];
      let candidates = [];
      if (planId) {
        const plan = await canonical("kehoach", { id: planId });
        plans = await versionFamily("kehoach", plan);
        const latestPlan = selectLatestVersion(plans);
        for (const snapshot of plans) {
          candidates.push(...await allPages("goithau", { keHoachId: snapshot.id }));
        }
        const currentFamily = candidates.filter((pkg) => versionRootId(pkg) === versionRootId(target)
          && stringId(pkg.keHoachId) === stringId(latestPlan?.id));
        if (stringId(selectLatestVersion(currentFamily)?.id) !== stringId(target.id)) {
          fail("BULK_DELETE_HISTORICAL_SELECTION", "Gói thầu chỉ được xóa từ phiên bản hiện tại của kế hoạch. Vui lòng chọn lại phiên bản mới nhất.");
        }
      } else {
        candidates = await versionFamily(type, target);
        if (stringId(selectLatestVersion(candidates)?.id) !== stringId(target.id)) {
          fail("BULK_DELETE_HISTORICAL_SELECTION", "Gói thầu chỉ được xóa từ phiên bản hiện tại. Vui lòng chọn lại phiên bản mới nhất.");
        }
      }
      const context = getPackageDeleteContext(candidates, target.id, plans);
      if (!context || !context.versionRefs.length) fail("BULK_DELETE_RECORD_CHANGED", "Không thể xác nhận nhóm phiên bản của gói thầu. Vui lòng tải lại.");
      const references = new Map();
      function addReference(reference, owner) {
        const id = stringId(reference?.id);
        if (!id) fail("BULK_DELETE_RECORD_CHANGED", "Nhóm phiên bản gói thầu thiếu định danh. Vui lòng tải lại.");
        const expected = { ...reference, id, rootId: owner ? versionRootId(owner) : reference.rootId || versionRootId(target),
          keHoachId: owner?.keHoachId };
        const previous = references.get(id);
        if (previous && (previous.rootId !== expected.rootId || !versionMatches(previous.phienBan, expected.phienBan))) {
          fail("BULK_DELETE_RECORD_CHANGED", "Dữ liệu phiên bản gói thầu không nhất quán. Vui lòng tải lại.");
        }
        references.set(id, expected);
      }
      for (const reference of context.versionRefs) {
        const candidate = candidates.find((item) => stringId(item.id) === stringId(reference.id));
        addReference(reference, candidate || target);
      }
      // Every matching plan snapshot has its own metadata. Include each one's
      // historical versions, including legacy split lineages matched by the
      // existing package delete helper, rather than using only target metadata.
      for (const candidate of context.relatedPackages) {
        if (!Array.isArray(candidate.allVersions) || !candidate.allVersions.length) {
          fail("BULK_DELETE_UNCONFIRMED", "Chưa thể xác nhận đầy đủ phiên bản gói thầu trong các kế hoạch. Vui lòng tải lại.");
        }
        const metadataIds = new Set();
        for (const metadata of candidate.allVersions) {
          const id = stringId(metadata?.id);
          if (!id || metadataIds.has(id)) fail("BULK_DELETE_RECORD_CHANGED", "Danh sách phiên bản gói thầu bị trùng hoặc thiếu định danh.");
          metadataIds.add(id);
          addReference(metadata, candidate);
        }
        if (!metadataIds.has(stringId(candidate.id))) fail("BULK_DELETE_RECORD_CHANGED", "Phiên bản gói thầu không còn trong kế hoạch liên quan.");
      }
      const relatedIds = new Set(references.keys());
      for (const reference of references.values()) {
        const record = await canonical(type, { id: reference.id, version: reference.phienBan, rootId: reference.rootId });
        if (reference.keHoachId !== undefined && stringId(record.keHoachId) !== stringId(reference.keHoachId)) {
          fail("BULK_DELETE_RECORD_CHANGED", "Nhóm phiên bản gói thầu đã thay đổi.");
        }
        packages.set(stringId(record.id), record);
      }
      const packageIds = relatedIds;
      for (const relatedPlanId of context.planIds) {
        for (const bid of await allPages("thongtinmothau", relatedPlanId ? { keHoachId: relatedPlanId } : {})) {
          if (!packageIds.has(stringId(bid.goiThauId))) continue;
          const record = await canonical("thongtinmothau", { id: bid.id });
          if (!packageIds.has(stringId(record.goiThauId))) fail("BULK_DELETE_RECORD_CHANGED", "Hồ sơ mở thầu đã thay đổi liên kết. Vui lòng tải lại.");
          bids.set(stringId(record.id), record);
        }
      }
    }
    const all = choice([...packages.values()], [...bids.values()]);
    choices = { latest: all, all };
  } else {
    const latestRecords = [];
    const allRecords = [];
    const blockedIds = new Set();
    for (const target of selected) {
      const family = await versionFamily(type, target);
      const latest = selectLatestVersion(family);
      if (type === "hopdong" && stringId(latest?.id) !== stringId(target.id)) {
        fail("BULK_DELETE_HISTORICAL_SELECTION", "Hợp đồng chỉ được xóa từ phiên bản hiện tại. Vui lòng chọn lại phiên bản mới nhất.");
      }
      latestRecords.push(latest);
      allRecords.push(...family);
      if (type === "kehoach") {
        for (const plan of family) {
          // The existing plan-delete guard needs only existence, not a hydrated
          // local copy of every linked package.
          const page = await checkedRead(readPage, "goithau", { keHoachId: plan.id, pageSize: 1,
            pagination: "cursor", sortBy: "id", sortOrder: "asc", includeTotal: "1" });
          if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.totalItems) || page.totalItems < 0
            || Boolean(page.items.length) !== Boolean(page.totalItems)) {
            fail("BULK_DELETE_UNCONFIRMED", "Chưa thể kiểm tra đầy đủ gói thầu liên quan. Vui lòng thử lại.");
          }
          if (page.totalItems) blockedIds.add(stringId(plan.id));
        }
      }
    }
    choices = {
      latest: choice(latestRecords, [], latestRecords.filter((record) => blockedIds.has(stringId(record.id)))),
      all: choice(allRecords, [], allRecords.filter((record) => blockedIds.has(stringId(record.id)))),
    };
  }
  if (await syncVersion() !== initialSyncVersion) {
    fail("BULK_DELETE_SELECTION_CHANGED", "Dữ liệu thay đổi trong lúc chuẩn bị. Vui lòng tải lại danh sách và chọn lại.");
  }
  assertCurrent();
  return freeze({ type, selectedCount: selected.length, selectedRecords: selected.map((record) => identity(record, type)),
    choices, syncVersion: initialSyncVersion });
}
