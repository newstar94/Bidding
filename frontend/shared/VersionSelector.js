import { escapeHtml, safeAttr } from "./view_helpers.js";
import {
  sortVersionsDescending,
  versionFamily,
  versionRootId,
} from "./versionResolver.js";

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
  className = "form-control version-droplist",
  ariaLabel = "Chọn phiên bản",
  name = "",
}) {
  const options = (versions || []).map((version) => {
    const label = String(Number.parseInt(version.phienBan || "0", 10) || 0).padStart(2, "0");
    return `<option value="${safeAttr(version.id)}" ${String(version.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  return `
    <select class="${safeAttr(className)} bf-s-1249e0db6b" data-bf-change="${safeAttr(changeAction)}" data-root="${safeAttr(rootId)}" aria-label="${safeAttr(ariaLabel)}"${name ? ` name="${safeAttr(name)}"` : ""}
     >
      ${options}
    </select>`;
}

export function resolveVersionedRow(records, row, selectedVersions = {}) {
  const rootId = versionRootId(row);
  const versions = sortVersionsDescending(row?.allVersions || versionFamily(records, row));
  const displayed = resolveSelectedVersion(records, row, selectedVersions);
  return { rootId, versions, displayed };
}
