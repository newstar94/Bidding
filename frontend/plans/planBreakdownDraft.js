import { generateRecordId } from "../shared/idUtils.js";
import { restoreRecordSnapshot } from "../shared/recordSnapshot.js";

export const PLAN_BREAKDOWN_DRAFT_TABLES = [
  "chudautu",
  "chuyengia",
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

const SERVER_OWNED_DRAFT_FIELDS = new Set([
  "rowVersion", "expectedVersion", "syncVersion", "organizationId",
  "createdAt", "updatedAt", "referenceOnly", "allVersions", "canEdit",
  "_valid", "_comment", "_operation",
]);

function changedFieldNames(current = {}, baseline = {}) {
  const fields = new Set([...Object.keys(current || {}), ...Object.keys(baseline || {})]);
  return [...fields].filter((field) => (
    !SERVER_OWNED_DRAFT_FIELDS.has(field)
    && JSON.stringify(current?.[field]) !== JSON.stringify(baseline?.[field])
  ));
}

export function rebasePlanBreakdownDraftAfterServerMerge(model, draft, localBefore, changedTables) {
  if (!draft?.active || !draft?.snapshot || !localBefore) return false;
  const changed = new Set(changedTables || []);
  let rebased = false;
  PLAN_BREAKDOWN_DRAFT_TABLES.forEach((table) => {
    if (!changed.has(table)) return;
    const baseline = draft.snapshot[table] || [];
    const localRows = localBefore[table] || [];
    const serverRows = model.state?.[table] || [];
    const baselineById = new Map(baseline.map((row) => [String(row?.id || ""), row]));
    const localById = new Map(localRows.map((row) => [String(row?.id || ""), row]));
    const serverById = new Map(serverRows.map((row) => [String(row?.id || ""), row]));
    const serverIds = new Set(serverById.keys());
    const nextSnapshotById = new Map(baselineById);

    serverById.forEach((serverRow, id) => {
      const baseRow = baselineById.get(id);
      const localRow = localById.get(id);
      if (!baseRow) {
        if (localRow) serverById.set(id, clone(localRow));
        else nextSnapshotById.set(id, clone(serverRow));
        return;
      }
      if (!localRow) {
        const serverFields = changedFieldNames(serverRow, baseRow);
        serverById.delete(id);
        if (serverFields.length === 0) nextSnapshotById.set(id, clone(serverRow));
        return;
      }
      const localFields = changedFieldNames(localRow, baseRow);
      if (localFields.length === 0) {
        nextSnapshotById.set(id, clone(serverRow));
        return;
      }
      const serverFields = changedFieldNames(serverRow, baseRow);
      if (serverFields.length > 0) {
        serverById.set(id, clone(localRow));
        return;
      }
      const merged = clone(serverRow);
      localFields.forEach((field) => { merged[field] = clone(localRow[field]); });
      serverById.set(id, merged);
      nextSnapshotById.set(id, clone(serverRow));
      rebased = true;
    });

    localById.forEach((localRow, id) => {
      const baseRow = baselineById.get(id);
      if (!baseRow && !serverById.has(id)) {
        serverById.set(id, clone(localRow));
        return;
      }
      if (baseRow && !serverById.has(id)) {
        const localFields = changedFieldNames(localRow, baseRow);
        if (localFields.length > 0) serverById.set(id, clone(localRow));
        else nextSnapshotById.delete(id);
      }
    });
    baselineById.forEach((_baseRow, id) => {
      if (!localById.has(id) && !serverIds.has(id)) nextSnapshotById.delete(id);
    });
    model.state[table] = [...serverById.values()];
    draft.snapshot[table] = [...nextSnapshotById.values()];
    model.entityIndexes?.invalidate?.(table);
  });
  return rebased;
}

export function capturePlanBreakdownDraft(state, { planId, action } = {}) {
  const snapshot = {};
  PLAN_BREAKDOWN_DRAFT_TABLES.forEach((table) => {
    if (Array.isArray(state?.[table])) snapshot[table] = clone(state[table]);
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
    isPlanBreakdownEditSessionActive(controller)
    && String(draft.planId || "") === String(planId || ""),
  );
}

export function isPlanBreakdownEditSessionActive(controller) {
  const draft = controller?.planBreakdownDraft;
  return Boolean(draft?.active && ["create", "edit"].includes(draft.action));
}

export function restorePlanBreakdownDraft(model, draft) {
  if (!draft?.snapshot) return false;
  PLAN_BREAKDOWN_DRAFT_TABLES.forEach((table) => {
    if (!Object.prototype.hasOwnProperty.call(draft.snapshot, table)) return;
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
  const existingByEmployee = new Map();
  (model?.state?.assignments || []).forEach((assignment) => {
    if (
      String(assignment?.targetId || "") !== target
      || String(assignment?.type || "") !== assignmentType
    ) return;
    const employeeId = String(assignment?.empId || "");
    if (employeeId && !existingByEmployee.has(employeeId)) {
      existingByEmployee.set(employeeId, assignment);
    }
  });
  const replacements = selected.map((empId) => existingByEmployee.get(empId) || ({
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

function changedRows(currentRows, previousRows) {
  const previousById = new Map(
    (previousRows || []).map((row) => [String(row?.id || ""), row]),
  );
  return (currentRows || []).filter((row) => {
    const previous = previousById.get(String(row?.id || ""));
    return previous === undefined || JSON.stringify(row) !== JSON.stringify(previous);
  });
}

export function collectPlanBreakdownDraftChanges(state, { planId, snapshot = {} } = {}) {
  const targetPlanId = String(planId || "");
  const targetPlan = (state?.kehoach || []).find(
    (plan) => String(plan?.id || "") === targetPlanId,
  );
  const currentPlans = targetPlan ? [targetPlan] : [];
  const previousPlans = (snapshot.kehoach || []).filter(
    (plan) => String(plan?.id || "") === targetPlanId,
  );
  const currentPackages = (state?.goithau || []).filter(
    (pkg) => String(pkg?.keHoachId || "") === targetPlanId,
  );
  const previousPackages = (snapshot.goithau || []).filter(
    (pkg) => String(pkg?.keHoachId || "") === targetPlanId,
  );
  const packageIds = new Set(
    [...currentPackages, ...previousPackages].map((pkg) => String(pkg?.id || "")),
  );
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
  const currentGoods = rowsForIds(state?.goithauhanghoa, "goiThauId", packageIds);
  const previousGoods = rowsForIds(snapshot.goithauhanghoa, "goiThauId", packageIds);
  const currentOpeningInfo = rowsForIds(state?.thongtinmothau, "goiThauId", packageIds);
  const previousOpeningInfo = rowsForIds(snapshot.thongtinmothau, "goiThauId", packageIds);
  const currentBidderGoods = rowsForIds(state?.hanghoaduthaunhathau, "goiThauId", packageIds);
  const previousBidderGoods = rowsForIds(snapshot.hanghoaduthaunhathau, "goiThauId", packageIds);
  const currentExperts = state?.chuyengia || [];
  const previousExperts = snapshot.chuyengia || [];
  const changedExperts = changedRows(currentExperts, previousExperts)
    .filter((expert) => expert?.isLatest == 1);
  const upserts = {
    chudautu: (state?.chudautu || []).filter((investor) => (
      investorIds.has(String(investor?.id || ""))
      && investor?.referenceOnly !== true
      && !(Number(investor?.rowVersion) > 0)
    )),
    kehoach: changedRows(currentPlans, previousPlans),
    goithau: changedRows(currentPackages, previousPackages),
    goithauhanghoa: changedRows(currentGoods, previousGoods),
    thongtinmothau: changedRows(currentOpeningInfo, previousOpeningInfo),
    hanghoaduthaunhathau: changedRows(currentBidderGoods, previousBidderGoods),
    assignments: changedRows(currentAssignments, previousAssignments),
  };
  const previous = {
    chudautu: (snapshot.chudautu || []).filter(
      (investor) => investorIds.has(String(investor?.id || "")),
    ),
    kehoach: previousPlans,
    goithau: previousPackages,
    goithauhanghoa: previousGoods,
    thongtinmothau: previousOpeningInfo,
    hanghoaduthaunhathau: previousBidderGoods,
    assignments: previousAssignments,
  };
  const current = {
    chudautu: (state?.chudautu || []).filter(
      (investor) => investorIds.has(String(investor?.id || "")),
    ),
    kehoach: currentPlans,
    goithau: currentPackages,
    goithauhanghoa: currentGoods,
    thongtinmothau: currentOpeningInfo,
    hanghoaduthaunhathau: currentBidderGoods,
    assignments: currentAssignments,
  };
  const deletions = {};
  Object.keys(upserts).forEach((table) => {
    if (table === "chudautu") return;
    const ids = removedIds(previous[table], current[table]);
    if (ids.length) deletions[table] = ids;
  });
  const removedExpertIds = removedIds(previousExperts, currentExperts);
  if (changedExperts.length > 0 || removedExpertIds.length > 0) {
    upserts.chuyengia = changedExperts;
    if (removedExpertIds.length > 0) deletions.chuyengia = removedExpertIds;
  }
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
