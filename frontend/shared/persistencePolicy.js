export const SYNCED_STATE_KEYS = Object.freeze([
  "assignments",
  "chudautu",
  "chuyengia",
  "customcontractstatuses",
  "goithau",
  "goithauhanghoa",
  "hanghoaduthaunhathau",
  "hopdong",
  "kehoach",
  "nhathau",
  "permissionmatrix",
  "thongtinmothau",
]);

const SYNCED_STATE_KEY_SET = new Set(SYNCED_STATE_KEYS);

export function isSyncedStateKey(table) {
  return SYNCED_STATE_KEY_SET.has(String(table || ""));
}
