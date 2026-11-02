import { versionRootId } from "./versionResolver.js";

const TYPES = new Set(["kehoach", "goithau", "hopdong"]);
const PAGE_KEYS = new Set(["page", "pageSize", "cursor", "sortBy", "sortOrder", "pagination", "includeTotal"]);
const NAMES = { kehoach: "tenKeHoach", goithau: "tenGoiThau", hopdong: "tenHopDong" };
const CODES = { kehoach: "maKeHoach", goithau: "maGoiThau", hopdong: "soHopDong" };
const READ_CONCURRENCY = 4;

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
function cleanQuery(query = {}) {
  const result = {};
  for (const [key, value] of Object.entries(query)) {
    if (PAGE_KEYS.has(key) || key === "table" || value == null || value === "") continue;
    result[key] = key === "filters" && typeof value !== "string" ? JSON.stringify(value) : value;
  }
  return result;
}

/** Short human label used by bulk confirmations and export summaries. */
export function bulkTargetLabel(record, type) {
  const code = String(record?.[CODES[type]] || "").trim();
  const name = String(record?.[NAMES[type]] || "").trim();
  return [code, name].filter(Boolean).join(" – ") || String(record?.id || "");
}

function normalizeDescriptor(value, maxRecords) {
  const descriptor = structuredClone(value);
  if (!descriptor || !TYPES.has(descriptor.type) || !["explicit", "query"].includes(descriptor.mode)
    || !Number.isSafeInteger(descriptor.count) || descriptor.count < 1
    || !Array.isArray(descriptor.selectedVersions) || !Array.isArray(descriptor.excludedRootIds)) {
    fail("BULK_ACTION_SELECTION_INVALID", "Vui lòng chọn dữ liệu cần xử lý.");
  }
  if (descriptor.count > maxRecords) {
    fail("BULK_ACTION_TOO_LARGE", `Mỗi lần chỉ xử lý tối đa ${maxRecords.toLocaleString("vi-VN")} bản ghi. Vui lòng giảm số dòng đã chọn.`);
  }
  const roots = new Set();
  const ids = new Set();
  for (const selected of descriptor.selectedVersions) {
    selected.id = stringId(selected.id);
    selected.rootId = stringId(selected.rootId);
    if (!selected.id || !selected.rootId || roots.has(selected.rootId) || ids.has(selected.id)) {
      fail("BULK_ACTION_SELECTION_INVALID", "Danh sách lựa chọn chứa bản ghi trùng hoặc không hợp lệ. Vui lòng chọn lại.");
    }
    roots.add(selected.rootId);
    ids.add(selected.id);
  }
  descriptor.excludedRootIds = descriptor.excludedRootIds.map(stringId);
  const exclusions = new Set(descriptor.excludedRootIds);
  if (exclusions.size !== descriptor.excludedRootIds.length || exclusions.has("")
    || [...roots].some((root) => exclusions.has(root))
    || (descriptor.mode === "explicit" && (descriptor.count !== roots.size || exclusions.size))) {
    fail("BULK_ACTION_SELECTION_INVALID", "Danh sách lựa chọn đã thay đổi. Vui lòng chọn lại.");
  }
  if (descriptor.mode === "query" && (!Number.isSafeInteger(descriptor.totalItems)
    || descriptor.totalItems - exclusions.size !== descriptor.count)) {
    fail("BULK_ACTION_SELECTION_CHANGED", "Số kết quả đã thay đổi. Vui lòng tải lại danh sách và chọn lại.");
  }
  return descriptor;
}

async function mapInOrder(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Resolve a list selection to fresh, exact, current-version records.
 * Bulk updates and exports act on the current version only, as row actions do;
 * a historical selection or any drift during preparation cancels the batch.
 */
export async function resolveBusinessListBulkTargets({
  descriptor: inputDescriptor, readPage, readRecord, readSyncVersion, assertCurrent,
  maxRecords = 2000,
}) {
  if (![readPage, readRecord, readSyncVersion, assertCurrent].every((fn) => typeof fn === "function")
    || !Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new TypeError("Thiếu dữ liệu để chuẩn bị thao tác hàng loạt.");
  const descriptor = normalizeDescriptor(inputDescriptor, maxRecords);
  const { type } = descriptor;
  async function checkedRead(reader, ...args) {
    assertCurrent();
    const result = await reader(...args);
    assertCurrent();
    return result;
  }
  async function syncVersion() {
    const version = await checkedRead(readSyncVersion);
    if (version == null || version === "" || !Number.isSafeInteger(Number(version)) || Number(version) < 0) {
      fail("BULK_ACTION_UNCONFIRMED", "Chưa thể xác nhận dữ liệu với máy chủ. Vui lòng thử lại.");
    }
    return Number(version);
  }
  const initialSyncVersion = await syncVersion();

  let expected;
  if (descriptor.mode === "query") {
    const query = cleanQuery(descriptor.query);
    const matches = [];
    const ids = new Set();
    const cursors = new Set();
    let cursor = "";
    let total;
    do {
      const page = await checkedRead(readPage, type, {
        ...query, pageSize: 200, pagination: "cursor", sortBy: "id", sortOrder: "asc", includeTotal: "1",
        ...(cursor ? { cursor } : {}),
      });
      if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.totalItems) || typeof page.hasMore !== "boolean") {
        fail("BULK_ACTION_UNCONFIRMED", "Máy chủ chưa trả đầy đủ danh sách cần kiểm tra. Vui lòng thử lại.");
      }
      if (total !== undefined && total !== page.totalItems) {
        fail("BULK_ACTION_SELECTION_CHANGED", "Danh sách thay đổi trong lúc chuẩn bị. Vui lòng tải lại và chọn lại.");
      }
      total = page.totalItems;
      if (total !== descriptor.totalItems) {
        fail("BULK_ACTION_SELECTION_CHANGED", "Số kết quả đã thay đổi từ khi chọn tất cả. Vui lòng tải lại danh sách và chọn lại.");
      }
      for (const item of page.items) {
        const id = stringId(item?.id);
        if (!id || ids.has(id)) fail("BULK_ACTION_SELECTION_CHANGED", "Máy chủ trả bản ghi trùng hoặc thiếu định danh. Vui lòng tải lại danh sách.");
        ids.add(id);
        matches.push(item);
      }
      if (matches.length > total) fail("BULK_ACTION_SELECTION_CHANGED", "Danh sách kết quả đã thay đổi. Vui lòng tải lại và chọn lại.");
      if (!page.hasMore) break;
      const nextCursor = stringId(page.nextCursor);
      if (!page.items.length || !nextCursor || cursors.has(nextCursor)) {
        fail("BULK_ACTION_UNCONFIRMED", "Không thể đọc đầy đủ các trang dữ liệu. Vui lòng thử lại.");
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);
    if (matches.length !== descriptor.totalItems) {
      fail("BULK_ACTION_SELECTION_CHANGED", "Danh sách chưa đầy đủ hoặc đã thay đổi. Vui lòng tải lại và chọn lại.");
    }
    const explicitByRoot = new Map(descriptor.selectedVersions.map((entry) => [entry.rootId, entry]));
    const excluded = new Set(descriptor.excludedRootIds);
    const roots = new Set();
    expected = [];
    for (const match of matches) {
      const rootId = versionRootId(match);
      if (roots.has(rootId)) fail("BULK_ACTION_SELECTION_CHANGED", "Danh sách chứa nhiều dòng của cùng một nhóm phiên bản. Vui lòng tải lại.");
      roots.add(rootId);
      if (excluded.has(rootId)) continue;
      expected.push(explicitByRoot.get(rootId) || { id: stringId(match.id), rootId, version: match.phienBan });
    }
    if (expected.length !== descriptor.count || [...explicitByRoot.keys(), ...excluded].some((root) => !roots.has(root))) {
      fail("BULK_ACTION_SELECTION_CHANGED", "Một số lựa chọn không còn trong kết quả lọc. Vui lòng tải lại và chọn lại.");
    }
  } else {
    expected = descriptor.selectedVersions;
  }

  const plans = new Map();
  async function currentPlan(planId) {
    if (!plans.has(planId)) plans.set(planId, checkedRead(readRecord, "kehoach", planId));
    return plans.get(planId);
  }
  const records = await mapInOrder(expected, READ_CONCURRENCY, async (entry) => {
    const record = await checkedRead(readRecord, type, entry.id);
    if (!record || stringId(record.id) !== entry.id || versionRootId(record) !== entry.rootId
      || !versionMatches(record.phienBan, entry.version) || record.archivedAt || record.archived_at
      || !Number.isSafeInteger(record.rowVersion) || record.rowVersion < 1) {
      fail("BULK_ACTION_RECORD_CHANGED", "Bản ghi hoặc phiên bản đã thay đổi. Vui lòng tải lại danh sách và chọn lại.");
    }
    const planId = type === "goithau" ? stringId(record.keHoachId) : "";
    const current = Number(record.isLatest) === 1
      && (!planId || Number((await currentPlan(planId))?.isLatest) === 1);
    if (!current) {
      fail("BULK_ACTION_HISTORICAL_SELECTION", `Thao tác hàng loạt chỉ áp dụng cho phiên bản hiện tại. Vui lòng chọn lại ${bulkTargetLabel(record, type)} ở phiên bản mới nhất.`);
    }
    return structuredClone(record);
  });
  if (await syncVersion() !== initialSyncVersion) {
    fail("BULK_ACTION_SELECTION_CHANGED", "Dữ liệu thay đổi trong lúc chuẩn bị. Vui lòng tải lại danh sách và chọn lại.");
  }
  assertCurrent();
  return freeze({ type, records, syncVersion: initialSyncVersion });
}
