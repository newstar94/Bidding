import {
  getWorkspaceRenderCacheEntry,
  setWorkspaceRenderCacheEntry,
} from "./workspaceRenderCache.js";

let holidays = null;
let contractorViewOnly = false;
let unifiedSelectListenerRegistered = false;
const LOT_WINNERS_CACHE_NAMESPACE = "lot-winners";

export const getHolidays = () => holidays || {};
export const hasHolidays = () => holidays !== null;
export const setHolidays = (value) => { holidays = value || {}; };

export const getContractorViewOnly = () => contractorViewOnly;
export const setContractorViewOnly = (value) => { contractorViewOnly = !!value; };
export const setLotWinners = (workspace, packageId, winners, options = {}) => (
  setWorkspaceRenderCacheEntry(workspace, LOT_WINNERS_CACHE_NAMESPACE, packageId, winners, options)
);
export const getLotWinners = (workspace, packageId) => (
  getWorkspaceRenderCacheEntry(workspace, LOT_WINNERS_CACHE_NAMESPACE, packageId)
);
export const hasUnifiedSelectListener = () => unifiedSelectListenerRegistered;
export const markUnifiedSelectListenerRegistered = () => { unifiedSelectListenerRegistered = true; };
