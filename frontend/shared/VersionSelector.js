import { escapeHtml, safeAttr } from "./view_helpers.js";

export function getVersionFamily(records, record) {
  if (!record) return [];
  const rootId = record.rootId || record.id;
  return (records || [])
    .filter((item) => String(item.rootId || item.id) === String(rootId))
    .sort((a, b) => (Number.parseInt(b.phienBan || "0", 10) || 0) - (Number.parseInt(a.phienBan || "0", 10) || 0));
}

export function resolveSelectedVersion(records, record, selectedVersions = {}) {
  if (!record) return null;
  const rootId = record.rootId || record.id;
  const selectedId = selectedVersions[rootId] || record.id;
  return (records || []).find((item) => String(item.id) === String(selectedId)) || record;
}

export function renderVersionSelector({
  versions,
  selectedId,
  rootId,
  changeAction,
  className = "form-control version-droplist"
}) {
  const options = (versions || []).map((version) => {
    const label = String(Number.parseInt(version.phienBan || "0", 10) || 0).padStart(2, "0");
    return `<option value="${safeAttr(version.id)}" ${String(version.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  return `
    <select class="${safeAttr(className)} bf-s-1249e0db6b" data-bf-change="${safeAttr(changeAction)}" data-root="${safeAttr(rootId)}"
     >
      ${options}
    </select>`;
}

export function resolveVersionedRow(records, row, selectedVersions = {}) {
  const rootId = row?.rootId || row?.id;
  const versions = row?.allVersions || getVersionFamily(records, row);
  const displayed = resolveSelectedVersion(records, row, selectedVersions);
  return { rootId, versions, displayed };
}
