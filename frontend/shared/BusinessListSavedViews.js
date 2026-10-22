// Per-user, per-workspace named filter sets for the business lists. They are
// a viewer convenience only: stored in this browser, never sent to the
// server, and always re-validated by normalizeBusinessListFilters on apply.

const STORAGE_PREFIX = "bf_saved_list_views";
const MAX_VIEWS = 20;
const MAX_NAME_LENGTH = 60;

function storageKey(model, type) {
  const scope = String(model?.workspaceScope?.key || "").trim();
  return scope ? `${STORAGE_PREFIX}:${scope}:${type}` : "";
}

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function listSavedViews(model, type) {
  const key = storageKey(model, type);
  if (!key) return [];
  try {
    const parsed = JSON.parse(storage()?.getItem(key) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((view) => view && typeof view.name === "string" && Array.isArray(view.conditions))
      : [];
  } catch {
    return [];
  }
}

function writeViews(model, type, views) {
  const key = storageKey(model, type);
  if (!key) return false;
  try {
    storage()?.setItem(key, JSON.stringify(views.slice(0, MAX_VIEWS)));
    return true;
  } catch {
    return false;
  }
}

export function saveView(model, type, name, conditions) {
  const label = String(name || "").trim().slice(0, MAX_NAME_LENGTH);
  if (!label) throw new Error("Vui lòng nhập tên chế độ xem.");
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new Error("Chưa có điều kiện lọc để lưu.");
  }
  const views = listSavedViews(model, type).filter((view) => view.name !== label);
  views.unshift({ name: label, conditions: structuredClone(conditions), savedAt: Date.now() });
  if (!writeViews(model, type, views)) throw new Error("Trình duyệt không cho phép lưu chế độ xem.");
  return label;
}

export function deleteView(model, type, name) {
  return writeViews(model, type, listSavedViews(model, type).filter((view) => view.name !== name));
}

export function findView(model, type, name) {
  return listSavedViews(model, type).find((view) => view.name === name) || null;
}
