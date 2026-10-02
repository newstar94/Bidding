import { businessListState, canonicalListQuery } from "./BusinessListState.js";

const PAGE_KEYS = new Set(["page", "pageSize", "cursor", "sortBy", "sortOrder", "pagination"]);
function selectionState(model, type) { return businessListState(model, type).selection; }
function identity(record, rootId) {
  return { rootId: String(rootId || record?.rootId || record?.id || ""), id: String(record?.id || ""), version: String(record?.phienBan ?? "") };
}
function normalizedQuery(query) {
  const result = {};
  for (const [key, value] of Object.entries(query || {})) {
    if (PAGE_KEYS.has(key) || value == null || value === "") continue;
    if (key === "filters") {
      const conditions = typeof value === "string" ? JSON.parse(value) : value;
      result.filters = conditions.map((condition) => ({ ...condition,
        value: Array.isArray(condition.value) ? [...condition.value].sort() : condition.value,
      })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    } else result[key] = value;
  }
  return canonicalListQuery(result);
}
function reset(selection) {
  selection.mode = "explicit";
  selection.selected.clear();
  selection.excluded.clear();
}

export function getBusinessListSelection(model, type) {
  const state = selectionState(model, type);
  return {
    type, mode: state.mode,
    count: state.mode === "query" ? Math.max(0, state.totalItems - state.excluded.size) : state.selected.size,
    query: structuredClone(state.query), totalItems: state.totalItems,
    selectedVersions: [...state.selected.values()].map((entry) => ({ ...entry })),
    excludedRootIds: [...state.excluded],
    versionPolicy: state.mode === "query" ? "latest-with-explicit-overrides" : "explicit",
  };
}

function notify(model, type) {
  const descriptor = getBusinessListSelection(model, type);
  if (globalThis.window?.dispatchEvent && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("bf:business-list-selection-changed", { detail: { model, ...descriptor } }));
  }
  return descriptor;
}

export function clearBusinessListSelection(model, type) {
  reset(selectionState(model, type));
  return notify(model, type);
}

// Canonical deletions can change both explicit IDs and select-all exclusions.
// Retire only that table's selection; absence from a paginated page is not proof
// of deletion and must never be used to clear another page's selection.
export function clearDeletedBusinessListSelections(model, deletionsByTable = {}) {
  const cleared = [];
  for (const type of ["kehoach", "goithau", "hopdong"]) {
    const values = deletionsByTable[type];
    const records = Array.isArray(values) ? values : values == null ? [] : [values];
    if (!records.some((record) => {
      const id = record && typeof record === "object" ? record.id : record;
      return id != null && String(id) !== "";
    })) continue;
    clearBusinessListSelection(model, type);
    cleared.push(type);
  }
  return cleared;
}

export function setBusinessListPage(model, type, { items = [], totalItems = 0, query = {} }) {
  const state = selectionState(model, type);
  const normalized = normalizedQuery(query);
  const key = JSON.stringify(normalized);
  if (state.queryKey !== key) reset(state);
  state.queryKey = key;
  state.query = normalized;
  state.items = items;
  state.totalItems = Math.max(0, Number(totalItems) || 0);
  if (!state.totalItems) reset(state);
  return getBusinessListSelection(model, type);
}

export function isBusinessListRowSelected(model, type, record, rootId) {
  const state = selectionState(model, type);
  const row = identity(record, rootId);
  if (!row.id || state.excluded.has(row.rootId)) return false;
  const selected = state.selected.get(row.rootId);
  return selected ? selected.id === row.id : state.mode === "query";
}

// Displaying another version must never silently replace the selected version.
export function reconcileBusinessListRowVersion(model, type, record, rootId) {
  const state = selectionState(model, type);
  const row = identity(record, rootId);
  const previous = state.selected.get(row.rootId);
  if (previous && previous.id !== row.id) {
    state.selected.delete(row.rootId);
    if (state.mode === "query") state.excluded.add(row.rootId);
    return true;
  }
  if (state.mode === "query" && !state.excluded.has(row.rootId) && row.id) state.selected.set(row.rootId, row);
  return false;
}

export function toggleBusinessListRow(model, type, record, checked, rootId) {
  const state = selectionState(model, type);
  const row = identity(record, rootId);
  if (!row.id || !row.rootId) return getBusinessListSelection(model, type);
  if (checked) {
    state.selected.set(row.rootId, row);
    state.excluded.delete(row.rootId);
  } else {
    state.selected.delete(row.rootId);
    if (state.mode === "query") state.excluded.add(row.rootId);
  }
  if (state.mode === "query" && state.excluded.size >= state.totalItems) reset(state);
  return notify(model, type);
}

export function selectBusinessListPage(model, type, items, checked = true) {
  const state = selectionState(model, type);
  for (const record of items) {
    const row = identity(record);
    if (!row.id) continue;
    if (checked) { state.selected.set(row.rootId, row); state.excluded.delete(row.rootId); }
    else { state.selected.delete(row.rootId); if (state.mode === "query") state.excluded.add(row.rootId); }
  }
  if (state.mode === "query" && state.excluded.size >= state.totalItems) reset(state);
  return notify(model, type);
}

export function selectAllBusinessListResults(model, type, displayedItems = []) {
  const state = selectionState(model, type);
  if (!state.totalItems) return getBusinessListSelection(model, type);
  state.mode = "query";
  state.excluded.clear();
  for (const record of displayedItems) {
    const row = identity(record);
    if (row.id) state.selected.set(row.rootId, row);
  }
  return notify(model, type);
}
