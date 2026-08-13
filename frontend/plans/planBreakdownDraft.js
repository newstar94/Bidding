import { generateRecordId } from "../shared/idUtils.js";
import { restoreRecordSnapshot } from "../shared/recordSnapshot.js";

export const PLAN_BREAKDOWN_DRAFT_TABLES = [
  "chudautu",
  "kehoach",
  "goithau",
  "goithauhanghoa",
  "thongtinmothau",
  "hanghoaduthaunhathau",
  "assignments",
];

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function capturePlanBreakdownDraft(state, { planId, action } = {}) {
  const snapshot = {};
  PLAN_BREAKDOWN_DRAFT_TABLES.forEach((table) => {
    snapshot[table] = clone(state?.[table] || []);
  });
  return {
    active: true,
    action: action || "create",
    planId: String(planId || ""),
    snapshot,
  };
}

export function isPlanBreakdownDraftActive(controller, planId) {
  const draft = controller?.planBreakdownDraft;
  return Boolean(
    draft?.active
    && draft.action === "create"
    && String(draft.planId || "") === String(planId || ""),
  );
}

export function restorePlanBreakdownDraft(model, draft) {
  if (!draft?.snapshot) return false;
  PLAN_BREAKDOWN_DRAFT_TABLES.forEach((table) => {
    const liveRecords = model?.state?.[table] || [];
    const snapshotRecords = draft.snapshot[table] || [];
    const restored = restoreRecordSnapshot(
      liveRecords,
      snapshotRecords,
    );
    if (["kehoach", "goithau"].includes(table)) {
      const snapshotIds = new Set(snapshotRecords.map((row) => String(row?.id || "")));
      const committedNewerFamilies = new Set(
        liveRecords
          .filter((row) => (
            !snapshotIds.has(String(row?.id || ""))
            && Number.isInteger(row?.rowVersion)
            && row.rowVersion > 0
          ))
          .map((row) => String(row?.rootId || row?.id || "")),
      );
      const snapshotById = new Map(
        snapshotRecords.map((row) => [String(row?.id || ""), row]),
      );
      restored.forEach((row) => {
        const snapshotRow = snapshotById.get(String(row?.id || ""));
        const family = String(row?.rootId || row?.id || "");
        if (snapshotRow && !committedNewerFamilies.has(family)) {
          row.isLatest = snapshotRow.isLatest;
        }
      });
    }
    if (typeof model?.replaceTableState === "function") model.replaceTableState(table, restored);
    else model.state[table] = restored;
  });
  return true;
}

export function applyDraftAssignmentSelection(model, {
  targetId,
  type,
  selectedIds,
  createId = generateRecordId,
} = {}) {
  const target = String(targetId || "");
  const assignmentType = String(type || "");
  const selected = [...new Set(
    (selectedIds || []).map((value) => String(value || "").trim()).filter(Boolean),
  )];
  const unrelated = (model?.state?.assignments || []).filter((assignment) => !(
    String(assignment?.targetId || "") === target
    && String(assignment?.type || "") === assignmentType
  ));
  const replacements = selected.map((empId) => ({
    id: createId("assignments"),
    empId,
    targetId,
    type,
  }));
  model.state.assignments = [...unrelated, ...replacements];
  model.entityIndexes?.invalidate?.("assignments");
  return replacements;
}

export function removeDraftPackageAggregate(model, packageId) {
  const target = (model?.state?.goithau || []).find(
    (pkg) => String(pkg?.id || "") === String(packageId || ""),
  );
  if (!target) return { removedPackageIds: [] };
  const rootId = String(target.rootId || target.id);
  const planId = String(target.keHoachId || "");
  const removedPackages = (model.state.goithau || []).filter((pkg) => (
    String(pkg?.rootId || pkg?.id || "") === rootId
    && String(pkg?.keHoachId || "") === planId
  ));
  const removedPackageIds = new Set(removedPackages.map((pkg) => String(pkg.id)));
  model.state.goithau = (model.state.goithau || []).filter(
    (pkg) => !removedPackageIds.has(String(pkg?.id || "")),
  );
  ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau"].forEach((table) => {
    model.state[table] = (model.state[table] || []).filter(
      (record) => !removedPackageIds.has(String(record?.goiThauId || "")),
    );
  });
  model.state.assignments = (model.state.assignments || []).filter((assignment) => !(
    assignment?.type === "goithau"
    && removedPackageIds.has(String(assignment?.targetId || ""))
  ));
  const selected = model.state.selectedPackageVersion;
  if (selected && typeof selected === "object") {
    Object.entries(selected).forEach(([key, value]) => {
      if (key === rootId || removedPackageIds.has(String(value || ""))) delete selected[key];
    });
  }
  [
    "goithau",
    "goithauhanghoa",
    "thongtinmothau",
    "hanghoaduthaunhathau",
    "assignments",
  ].forEach((table) => model.entityIndexes?.invalidate?.(table));
  return { removedPackageIds: [...removedPackageIds], planId };
}

function rowsForIds(rows, field, ids) {
  return (rows || []).filter((row) => ids.has(String(row?.[field] || "")));
}

function removedIds(before, after) {
  const currentIds = new Set((after || []).map((row) => String(row?.id || "")));
  return (before || [])
    .filter((row) => row?.id && !currentIds.has(String(row.id)))
    .map((row) => row.id);
}

export function collectPlanBreakdownDraftChanges(state, { planId, snapshot = {} } = {}) {
  const targetPlanId = String(planId || "");
  const targetPlan = (state?.kehoach || []).find(
    (plan) => String(plan?.id || "") === targetPlanId,
  );
  const targetPlanRootId = String(targetPlan?.rootId || targetPlan?.id || "");
  const currentPackages = (state?.goithau || []).filter(
    (pkg) => String(pkg?.keHoachId || "") === targetPlanId,
  );
  const previousPackages = (snapshot.goithau || []).filter(
    (pkg) => String(pkg?.keHoachId || "") === targetPlanId,
  );
  const packageIds = new Set(
    [...currentPackages, ...previousPackages].map((pkg) => String(pkg?.id || "")),
  );
  const packageRootIds = new Set(
    currentPackages.map((pkg) => String(pkg?.rootId || pkg?.id || "")),
  );
  const packageFamilyRows = (state?.goithau || []).filter(
    (pkg) => packageRootIds.has(String(pkg?.rootId || pkg?.id || "")),
  );
  packageFamilyRows.forEach((pkg) => packageIds.add(String(pkg?.id || "")));
  const currentTargetIds = new Set([targetPlanId, ...packageIds]);
  const currentAssignments = (state?.assignments || []).filter((assignment) => (
    (assignment.type === "kehoach" && String(assignment.targetId || "") === targetPlanId)
    || (assignment.type === "goithau" && currentTargetIds.has(String(assignment.targetId || "")))
  ));
  const previousAssignments = (snapshot.assignments || []).filter((assignment) => (
    (assignment.type === "kehoach" && String(assignment.targetId || "") === targetPlanId)
    || (assignment.type === "goithau" && currentTargetIds.has(String(assignment.targetId || "")))
  ));
  const investorIds = new Set([
    String(targetPlan?.chuDauTuId || ""),
  ].filter(Boolean));
  const upserts = {
    chudautu: (state?.chudautu || []).filter((investor) => (
      investorIds.has(String(investor?.id || ""))
      && !(snapshot.chudautu || []).some(
        (previousInvestor) => String(previousInvestor?.id || "") === String(investor?.id || ""),
      )
    )),
    kehoach: (state?.kehoach || []).filter((plan) => (
      String(plan?.rootId || plan?.id || "") === targetPlanRootId
    )),
    goithau: packageFamilyRows,
    goithauhanghoa: rowsForIds(state?.goithauhanghoa, "goiThauId", packageIds),
    thongtinmothau: rowsForIds(state?.thongtinmothau, "goiThauId", packageIds),
    hanghoaduthaunhathau: rowsForIds(state?.hanghoaduthaunhathau, "goiThauId", packageIds),
    assignments: currentAssignments,
  };
  const previous = {
    chudautu: (snapshot.chudautu || []).filter(
      (investor) => investorIds.has(String(investor?.id || "")),
    ),
    kehoach: (snapshot.kehoach || []).filter((plan) => (
      String(plan?.rootId || plan?.id || "") === targetPlanRootId
    )),
    goithau: (snapshot.goithau || []).filter(
      (pkg) => packageRootIds.has(String(pkg?.rootId || pkg?.id || "")),
    ),
    goithauhanghoa: rowsForIds(snapshot.goithauhanghoa, "goiThauId", packageIds),
    thongtinmothau: rowsForIds(snapshot.thongtinmothau, "goiThauId", packageIds),
    hanghoaduthaunhathau: rowsForIds(snapshot.hanghoaduthaunhathau, "goiThauId", packageIds),
    assignments: previousAssignments,
  };
  const deletions = {};
  Object.keys(upserts).forEach((table) => {
    const ids = removedIds(previous[table], upserts[table]);
    if (ids.length) deletions[table] = ids;
  });
  return { upserts, deletions };
}

export function boundProcurementRevisionChanges(changes, planId) {
  const bounded = clone(changes || { upserts: {}, deletions: {} });
  const packageIds = new Set(
    (bounded.upserts?.goithau || [])
      .filter((pkg) => String(pkg?.keHoachId || "") === String(planId || ""))
      .map((pkg) => String(pkg.id)),
  );
  bounded.upserts.kehoach = (bounded.upserts.kehoach || [])
    .filter((plan) => String(plan.id) === String(planId));
  bounded.upserts.goithau = (bounded.upserts.goithau || [])
    .filter((pkg) => packageIds.has(String(pkg.id)));
  for (const table of ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau"]) {
    bounded.upserts[table] = (bounded.upserts[table] || [])
      .filter((row) => packageIds.has(String(row.goiThauId || "")));
  }
  bounded.upserts.assignments = (bounded.upserts.assignments || [])
    .filter((row) => (
      String(row.targetId || "") === String(planId)
      || packageIds.has(String(row.targetId || ""))
    ));
  return bounded;
}
