import {
  buildEffectiveTimeline,
  mergeSavedTimelineEntries,
  timelineCatalogDefinition,
  TIMELINE_TEMPLATE_VERSION
} from "./timelineRuleEngine.js";

export { TIMELINE_TEMPLATE_VERSION };

const catalog = timelineCatalogDefinition();
export const TIMELINE_SECTIONS = Object.freeze(catalog.sections.map((section) => [
  section.legacyCode,
  section.title,
  catalog.milestones
    .filter((milestone) => milestone.sectionKey === section.sectionKey && !milestone.repeatable)
    .map((milestone) => [
      milestone.legacyCodes[0] || `${section.displayPrefix}.0`,
      milestone.title,
      milestone.issuer,
      milestone.tags.includes("OPTIONAL")
    ])
]));

function related(plan = {}, contracts = []) {
  return { plan, contracts };
}

export function createDefaultTimelineRows() {
  return buildEffectiveTimeline({}, { plan: {} }, [], { includeNotApplicable: true });
}

export function isTimelineRowApplicable(row, pkg = {}, plan = {}) {
  const rows = buildEffectiveTimeline(pkg, { plan }, [row], { includeNotApplicable: true });
  const match = rows.find((item) => (
    item.milestoneKey === row?.milestoneKey
    || item.maMoc === row?.maMoc
  ));
  return match?.applicability !== "NOT_APPLICABLE";
}

export function applyTimelineApplicability(rows, pkg = {}, plan = {}, contracts = []) {
  return buildEffectiveTimeline(pkg, related(plan, contracts), rows);
}

export function applyAutomaticTimelineSources(rows, pkg = {}, plan = {}, contracts = []) {
  return buildEffectiveTimeline(pkg, related(plan, contracts), rows);
}

export function mergeTimelineRows(pkg = {}, plan = {}, contracts = []) {
  return buildEffectiveTimeline(pkg, related(plan, contracts), Array.isArray(pkg.timelineItems) ? pkg.timelineItems : []);
}

export function preserveHiddenTimelineRows(existingEntries = [], effectiveRows = []) {
  return mergeSavedTimelineEntries(existingEntries, effectiveRows);
}

export function timelineDisplayCode(row) {
  return String(row?.displayCode || row?.maMoc || "");
}

export function timelineIsOverdue(row, today = new Date()) {
  if (row?.applicability !== "APPLICABLE" || !row?.ngayDuKien || row.ngayThucTe || ["DONE", "NOT_APPLICABLE"].includes(row.trangThai)) return false;
  const deadline = new Date(`${row.ngayDuKien}T23:59:59`);
  return Number.isFinite(deadline.getTime()) && deadline < today;
}

export function copyTimelineForNewVersion(previousRows = []) {
  const previousByKey = new Map(previousRows.map((row) => [`${row.milestoneKey || row.maMoc}\u0000${row.instanceKey || ""}`, row]));
  return createDefaultTimelineRows().map((defaultRow) => {
    const previous = previousByKey.get(`${defaultRow.milestoneKey}\u0000${defaultRow.instanceKey || ""}`);
    if (!previous) return defaultRow;
    const resetProcessMilestone = ["E_HSMT", "SELECTION_RESULT"].includes(defaultRow.sectionKey);
    return {
      ...defaultRow,
      ...previous,
      id: `${defaultRow.milestoneKey}:${defaultRow.instanceKey || "base"}`,
      ...(resetProcessMilestone ? {
        soVanBan: "", ngayDuKien: "", ngayThucTe: "", trangThai: "PENDING", status: "PENDING",
        sourceMode: defaultRow.sourceMode, sourceKey: defaultRow.sourceKey
      } : {}),
      sortOrder: defaultRow.sortOrder,
      templateVersion: TIMELINE_TEMPLATE_VERSION
    };
  });
}
