import { captureWorkspaceLease, isWorkspaceLeaseCurrent } from "../app/workspaceLease.js";
import { captureProjectionAuthorizationScope, projectionAuthorizationScopeIsCurrent } from "./PaginatedProjectionStore.js";

const STORES = new WeakMap();
export const BUSINESS_LIST_TYPES = Object.freeze(["kehoach", "goithau", "hopdong"]);

export function businessListState(model, type) {
  if (!model || !BUSINESS_LIST_TYPES.includes(type)) throw new TypeError("Danh sách không hợp lệ.");
  let store = STORES.get(model);
  if (!store || !isWorkspaceLeaseCurrent(model, store.lease)
    || !projectionAuthorizationScopeIsCurrent(model, store.authorization)) {
    store = {
      lease: captureWorkspaceLease(model),
      authorization: captureProjectionAuthorizationScope(model),
      lists: new Map(),
    };
    STORES.set(model, store);
  }
  if (!store.lists.has(type)) {
    store.lists.set(type, {
      filters: [],
      selection: { mode: "explicit", selected: new Map(), excluded: new Set(), query: {}, queryKey: null, items: [], totalItems: 0 },
    });
  }
  return store.lists.get(type);
}

export function canonicalListQuery(value) {
  if (Array.isArray(value)) return value.map(canonicalListQuery);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalListQuery(value[key])]));
  }
  return value ?? null;
}
