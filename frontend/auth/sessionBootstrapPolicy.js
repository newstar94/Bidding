export function preferredWorkspaceId(storage = globalThis.sessionStorage, fallback = globalThis.localStorage) {
  return String(storage?.getItem?.("bf_active_org") || fallback?.getItem?.("bf_active_org") || "").trim();
}

export function embeddedSessionNeedsWorkspaceRefresh(embedded, preferredWorkspace) {
  if (!embedded || embedded.valid !== true || !preferredWorkspace) return false;
  return String(embedded.user?.active_org_id || "").trim() !== String(preferredWorkspace).trim();
}
