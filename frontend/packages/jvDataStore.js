import {
  getWorkspaceRenderCacheEntry,
  setWorkspaceRenderCacheEntry,
} from "../shared/workspaceRenderCache.js";

const JV_CACHE_NAMESPACE = "joint-venture";

export function setJvData(workspace, key, data, options = {}) {
  return setWorkspaceRenderCacheEntry(workspace, JV_CACHE_NAMESPACE, key, data, options);
}

export function getJvData(workspace, key) {
  return getWorkspaceRenderCacheEntry(workspace, JV_CACHE_NAMESPACE, key);
}
