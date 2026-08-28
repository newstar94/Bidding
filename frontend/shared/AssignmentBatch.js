import { generateRecordId } from "./idUtils.js";

/** Persist an assignment delta in one IndexedDB transaction and one outbox flush. */
export async function applyAssignmentBatch(model, {
  addedIds,
  removedAssignments,
  targetId,
  type,
}) {
  const additions = (addedIds || []).map((employeeId) => ({
    id: generateRecordId("assignments"),
    empId: employeeId,
    targetId,
    type,
  }));
  const removals = removedAssignments || [];

  // Compatibility adapter for shallow clients/tests; production BiddingModel
  // always takes the atomic path below.
  if (typeof model?.beginWorkspaceMutation !== "function" || typeof model?.db?.applySyncChanges !== "function") {
    for (const assignment of removals) await model.deleteRecord("assignments", assignment.id);
    for (const assignment of additions) await model.addRecord("assignments", assignment);
    return { additions, removals };
  }

  const mutation = model.beginWorkspaceMutation();
  const before = [...(mutation.state.assignments || [])];
  const removedIds = new Set(removals.map((assignment) => String(assignment.id)));
  const after = [
    ...before.filter((assignment) => !removedIds.has(String(assignment.id))),
    ...additions,
  ];
  const checkpoint = mutation.outbox?.checkpoint?.() || null;
  let durable = false;
  try {
    await mutation.db.applySyncChanges({
      upserts: { assignments: additions },
      deletions: { assignments: removals.map((assignment) => assignment.id) },
    });
    durable = true;
    mutation.state.assignments = after;
    if (removals.length) {
      model.commitWorkspaceMutation(mutation, "assignments", { deletedIds: removals });
    }
    if (additions.length) {
      model.commitWorkspaceMutation(mutation, "assignments", { records: additions });
    }
    await mutation.outbox?.flush?.();
    return { additions, removals };
  } catch (error) {
    mutation.state.assignments = before;
    model.entityIndexes?.invalidate?.("assignments");
    if (checkpoint) mutation.outbox?.restore?.(checkpoint);
    if (durable) {
      await mutation.db.applySyncChanges({ replacements: { assignments: before } });
    }
    await mutation.outbox?.flush?.().catch(() => undefined);
    throw error;
  } finally {
    model.finishWorkspaceMutation(mutation);
  }
}
