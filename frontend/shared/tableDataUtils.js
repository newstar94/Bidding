import { getJson } from "./apiClient.js";

export function parseYearMonth(dateStr) {
  if (!dateStr) return { year: null, month: null };
  const cleaned = String(dateStr).replace(/\s*-\s*/, " ").trim();
  if (cleaned.match(/^\d{4}-\d{2}-\d{2}/)) {
    return {
      year: cleaned.substring(0, 4),
      month: parseInt(cleaned.substring(5, 7), 10).toString()
    };
  }
  if (cleaned.match(/^\d{2}\/\d{2}\/\d{4}/)) {
    const parts = cleaned.split(" ")[0].split("/");
    return {
      year: parts[2],
      month: parseInt(parts[1], 10).toString()
    };
  }
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      year: parsed.getFullYear().toString(),
      month: (parsed.getMonth() + 1).toString()
    };
  }
  return { year: null, month: null };
}
export function collectYearMonthOptions(records, getDate) {
  const years = new Set();
  const months = new Set();
  (records || []).forEach((record) => {
    const parsed = parseYearMonth(getDate(record));
    if (parsed.year) years.add(parsed.year);
    if (parsed.month) months.add(parsed.month);
  });
  return {
    years: [...years].sort((a, b) => Number(b) - Number(a)),
    months: [...months].sort((a, b) => Number(b) - Number(a))
  };
}

export function matchesYearMonth(value, year = "", month = "") {
  if (!year && !month) return true;
  const parsed = parseYearMonth(value);
  if (!parsed.year || !parsed.month) return false;
  return (!year || parsed.year === String(year)) && (!month || parsed.month === String(month));
}

export function paginateRecords(records, currentPage, pageSize) {
  const startIndex = (Math.max(1, Number(currentPage) || 1) - 1) * pageSize;
  return (records || []).slice(startIndex, startIndex + pageSize);
}

export async function loadPaginatedRecords(model, table, params = {}) {
  const query = new URLSearchParams({ table });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });
  model._paginationRequests ||= new Map();
  model._paginationRequests.get(table)?.abort();
  const controller = new AbortController();
  model._paginationRequests.set(table, controller);
  try {
    const data = await getJson(`/api/paginate?${query}`, { signal: controller.signal });
    return {
      items: cachePaginatedRecords(model, table, data?.items || []),
      totalItems: Number(data?.totalItems || 0),
      nextCursor: data?.nextCursor || null,
      hasMore: Boolean(data?.hasMore)
    };
  } finally {
    if (model._paginationRequests.get(table) === controller) {
      model._paginationRequests.delete(table);
    }
  }
}
export function sortRecords(records, field, order = "asc") {
  if (!field) return records;
  const direction = order === "desc" ? -1 : 1;
  records.sort((a, b) => {
    let valA = a[field] ?? "";
    let valB = b[field] ?? "";
    if (typeof valA === "string") valA = valA.toLowerCase();
    if (typeof valB === "string") valB = valB.toLowerCase();
    if (valA < valB) return -1 * direction;
    if (valA > valB) return 1 * direction;
    return 0;
  });
  return records;
}
export function cachePaginatedRecords(model, key, records) {
  const normalized = (typeof model?.normalizeRecordKeys === "function"
    ? (records || []).map((record) => model.normalizeRecordKeys(record, key))
    : records || []
  ).map((record) => ({ ...record, referenceOnly: false }));
  if (!Array.isArray(model.state[key])) {
    model.state[key] = [];
  }
  normalized.forEach((record) => {
    const index = model.state[key].findIndex((item) => String(item.id) === String(record.id));
    if (index >= 0) {
      model.state[key][index] = record;
    } else {
      model.state[key].push(record);
    }
  });
  if (normalized.length > 0 && model.db && typeof model.db.putRecords === "function") {
    model.db.putRecords(key, normalized).catch((err) => {
      console.error(`Failed to cache paginated ${key} records:`, err);
    });
  }
  return normalized;
}
