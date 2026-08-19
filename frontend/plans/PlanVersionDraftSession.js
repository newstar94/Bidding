import { serializeOutboundRecord } from "../app/outboundSerializer.js";
import { generateRecordId } from "../shared/idUtils.js";
import { postJson } from "../shared/apiClient.js";

export const PLAN_VERSION_DRAFT_STORAGE_KEY = "plan_version_drafts_v1";
export const PLAN_VERSION_DRAFT_TABLES = Object.freeze([
  "chudautu",
  "chuyengia",
  "nhathau",
  "kehoach",
  "goithau",
  "goithauhanghoa",
  "thongtinmothau",
  "hanghoaduthaunhathau",
  "assignments",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function rootOf(record) {
  return String(record?.rootId || record?.id || "");
}

function versionNumber(record) {
  const value = Number.parseInt(String(record?.phienBan ?? "0"), 10);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function rowsForIds(rows, field, ids) {
  return (rows || []).filter((row) => ids.has(String(row?.[field] || "")));
}

export function capturePlanVersionDraftAggregate(state, planRootId) {
  const rootId = String(planRootId || "");
  const plans = (state?.kehoach || [])
    .filter((plan) => rootOf(plan) === rootId)
    .sort((left, right) => versionNumber(left) - versionNumber(right));
  const planIds = new Set(plans.map((plan) => String(plan.id)));
  const packages = (state?.goithau || []).filter(
    (pkg) => planIds.has(String(pkg?.keHoachId || "")),
  );
  const packageIds = new Set(packages.map((pkg) => String(pkg.id)));
  const assignments = (state?.assignments || []).filter((assignment) => (
    assignment?.type === "kehoach" && planIds.has(String(assignment.targetId || ""))
  ) || (
    assignment?.type === "goithau" && packageIds.has(String(assignment.targetId || ""))
  ));
  const openings = rowsForIds(state?.thongtinmothau, "goiThauId", packageIds);
  const expertIds = new Set();
  packages.forEach((pkg) => {
    [...(pkg?.toChuyenGia || []), ...(pkg?.toThamDinh || [])].forEach((member) => {
      const id = String(member?.chuyenGiaId || member?.id || "");
      if (id) expertIds.add(id);
    });
  });
  const contractorIds = new Set(openings.map((row) => String(row?.nhaThauId || "")).filter(Boolean));
  const investorIds = new Set(plans.map((plan) => String(plan?.chuDauTuId || "")).filter(Boolean));
  return {
    chudautu: (state?.chudautu || []).filter((row) => investorIds.has(String(row.id))),
    chuyengia: (state?.chuyengia || []).filter((row) => expertIds.has(String(row.id))),
    nhathau: (state?.nhathau || []).filter((row) => contractorIds.has(String(row.id))),
    kehoach: plans,
    goithau: packages,
    goithauhanghoa: rowsForIds(state?.goithauhanghoa, "goiThauId", packageIds),
    thongtinmothau: openings,
    hanghoaduthaunhathau: rowsForIds(
      state?.hanghoaduthaunhathau,
      "goiThauId",
      packageIds,
    ),
    assignments,
  };
}

export function createPlanVersionDraftSession(state, planId, now = new Date().toISOString()) {
  const plan = (state?.kehoach || []).find((row) => String(row.id) === String(planId));
  if (!plan) throw new Error("Không tìm thấy kế hoạch để tạo bản nháp phiên bản.");
  const rootId = rootOf(plan);
  return {
    draftId: generateRecordId("plan-draft"),
    finalizeMutationId: generateRecordId("plan-finalize"),
    rootId,
    status: "editing",
    versions: [String(plan.phienBan ?? "00").padStart(2, "0")],
    currentVersionId: plan.id,
    createdAt: now,
    updatedAt: now,
    dirtyRelatedRecords: {},
    aggregate: clone(capturePlanVersionDraftAggregate(state, rootId)),
  };
}

export function refreshPlanVersionDraftSession(session, state, currentVersionId) {
  if (!session?.draftId || !session?.rootId) return null;
  const aggregate = capturePlanVersionDraftAggregate(state, session.rootId);
  const plans = aggregate.kehoach || [];
  if (plans.length === 0) return null;
  const current = plans.find((plan) => String(plan.id) === String(currentVersionId || ""))
    || plans[plans.length - 1];
  session.aggregate = clone(aggregate);
  session.versions = plans.map((plan) => String(versionNumber(plan)).padStart(2, "0"));
  session.currentVersionId = current.id;
  session.updatedAt = new Date().toISOString();
  return session;
}

function normalizeStoredEnvelope(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.sessions)) {
    return { version: 1, sessions: [] };
  }
  return {
    version: 1,
    sessions: value.sessions.filter((session) => (
      session?.draftId && session?.rootId && session?.aggregate
    )).map(clone),
  };
}

export async function hydratePlanVersionDraftSessions(model) {
  const envelope = normalizeStoredEnvelope(
    await model?.db?.get?.(PLAN_VERSION_DRAFT_STORAGE_KEY),
  );
  model.planVersionDraftSessions = envelope.sessions;
  await reapplyPlanVersionDraftSessions(model, { persistCleanup: false });
  return model.planVersionDraftSessions;
}

async function persistSessions(model) {
  if (typeof model?.db?.set !== "function") return;
  await model.db.set(PLAN_VERSION_DRAFT_STORAGE_KEY, {
    version: 1,
    sessions: clone(model.planVersionDraftSessions || []),
  });
}

export async function savePlanVersionDraftSession(model, session) {
  if (!session?.draftId) throw new Error("Draft session không hợp lệ.");
  model.planVersionDraftSessions ||= [];
  const index = model.planVersionDraftSessions.findIndex(
    (item) => String(item.draftId) === String(session.draftId),
  );
  if (index >= 0) model.planVersionDraftSessions[index] = clone(session);
  else model.planVersionDraftSessions.push(clone(session));
  await persistSessions(model);
  return session;
}

export async function removePlanVersionDraftSession(model, draftId) {
  const before = model.planVersionDraftSessions || [];
  model.planVersionDraftSessions = before.filter(
    (session) => String(session.draftId) !== String(draftId),
  );
  await persistSessions(model);
  return model.planVersionDraftSessions.length !== before.length;
}

export function findPlanVersionDraftSession(model, planId) {
  const id = String(planId || "");
  return (model?.planVersionDraftSessions || []).find((session) => (
    (session.aggregate?.kehoach || []).some((plan) => String(plan.id) === id)
  )) || null;
}

export async function persistActivePlanVersionDraftSession(controller, planId = "") {
  const model = controller?.model;
  const activePlanId = String(planId || controller?.planBreakdownDraft?.planId || "");
  const session = findPlanVersionDraftSession(model, activePlanId);
  if (!session) return null;
  const refreshed = refreshPlanVersionDraftSession(session, model.state, activePlanId);
  if (!refreshed) return null;
  await savePlanVersionDraftSession(model, refreshed);
  return refreshed;
}

export async function markPlanVersionDraftRecordsDirty(controller, table, records) {
  const session = await persistActivePlanVersionDraftSession(controller);
  if (!session) return null;
  session.dirtyRelatedRecords ||= {};
  const dirty = new Set(session.dirtyRelatedRecords[table] || []);
  (Array.isArray(records) ? records : [records]).filter(Boolean).forEach((row) => {
    if (row?.id) dirty.add(String(row.id));
  });
  session.dirtyRelatedRecords[table] = [...dirty];
  await savePlanVersionDraftSession(controller.model, session);
  return session;
}

export async function reapplyPlanVersionDraftSessions(model, { persistCleanup = true } = {}) {
  if (!model?.state) return [];
  const sessions = model.planVersionDraftSessions || [];
  const retained = [];
  for (const session of sessions) {
    const draftPlanIds = new Set(
      (session.aggregate?.kehoach || []).map((plan) => String(plan.id)),
    );
    const alreadyCommitted = (model.state.kehoach || []).some((plan) => (
      draftPlanIds.has(String(plan.id)) && Number(plan.rowVersion) > 0
    ));
    if (alreadyCommitted) continue;
    retained.push(session);
    for (const table of PLAN_VERSION_DRAFT_TABLES) {
      const incoming = session.aggregate?.[table] || [];
      if (incoming.length === 0) continue;
      model.state[table] = Array.isArray(model.state[table]) ? model.state[table] : [];
      const byId = new Map(model.state[table].map((row, index) => [String(row.id), index]));
      incoming.forEach((row) => {
        const index = byId.get(String(row.id));
        if (index === undefined) {
          byId.set(String(row.id), model.state[table].length);
          model.state[table].push(clone(row));
        } else {
          model.state[table][index] = clone(row);
        }
      });
      model.entityIndexes?.invalidate?.(table);
    }
  }
  if (retained.length !== sessions.length) {
    model.planVersionDraftSessions = retained;
    if (persistCleanup) await persistSessions(model);
  }
  return retained;
}

export function buildPlanDraftFinalizePayload(model, session) {
  const aggregate = session?.aggregate || {};
  const plans = [...(aggregate.kehoach || [])]
    .sort((left, right) => versionNumber(left) - versionNumber(right));
  const serialize = (table, rows) => (rows || []).map((row) => (
    serializeOutboundRecord(row, table, (value, type) => (
      model?.normalizeRecordKeys?.(value, type) || value
    ))
  ));
  const changedRelatedRows = (table) => {
    const dirty = new Set(session?.dirtyRelatedRecords?.[table] || []);
    return (aggregate[table] || []).filter((row) => (
      !(Number(row?.rowVersion) > 0) || dirty.has(String(row?.id || ""))
    ));
  };
  return {
    draftId: session.draftId,
    planRootId: session.rootId,
    clientMutationId: session.finalizeMutationId,
    baseSyncVersion: model?.workspaceStorage?.getItem?.("bf_last_sync_version") || "0",
    versions: plans.map((plan) => ({
      id: plan.id,
      version: versionNumber(plan),
    })),
    chudautu: serialize("chudautu", changedRelatedRows("chudautu")),
    kehoach: serialize("kehoach", plans),
    goithau: serialize("goithau", aggregate.goithau),
    chuyengia: serialize("chuyengia", changedRelatedRows("chuyengia")),
    nhathau: serialize("nhathau", changedRelatedRows("nhathau")),
    assignments: serialize("assignments", aggregate.assignments),
    thongtinmothau: serialize("thongtinmothau", aggregate.thongtinmothau),
    goithauhanghoa: serialize("goithauhanghoa", aggregate.goithauhanghoa),
    hanghoaduthaunhathau: serialize(
      "hanghoaduthaunhathau",
      aggregate.hanghoaduthaunhathau,
    ),
    deletions: [],
  };
}

export function validatePlanVersionDraftSession(session) {
  const aggregate = session?.aggregate || {};
  const plans = [...(aggregate.kehoach || [])]
    .sort((left, right) => versionNumber(left) - versionNumber(right));
  if (plans.length === 0) throw new Error("Bản nháp chưa có phiên bản kế hoạch.");
  const rootId = String(session?.rootId || "");
  const versions = plans.map(versionNumber);
  if (new Set(versions).size !== versions.length) {
    throw new Error("Chuỗi phiên bản kế hoạch bị trùng.");
  }
  if (versions.some((value, index) => value !== index)) {
    throw new Error("Chuỗi phiên bản kế hoạch phải liên tục từ 00.");
  }
  if (plans.some((plan) => rootOf(plan) !== rootId || Number(plan.rowVersion) > 0)) {
    throw new Error("Bản nháp không thuộc cùng một dòng phiên bản mới.");
  }
  const planIds = new Set(plans.map((plan) => String(plan.id)));
  const packages = aggregate.goithau || [];
  const packageIds = new Set(packages.map((pkg) => String(pkg.id)));
  if (packageIds.size !== packages.length) throw new Error("Bản nháp có ID gói thầu bị trùng.");
  if (packages.some((pkg) => !planIds.has(String(pkg.keHoachId)) || Number(pkg.rowVersion) > 0)) {
    throw new Error("Gói thầu không trỏ tới phiên bản kế hoạch hợp lệ.");
  }
  for (const table of ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau"]) {
    if ((aggregate[table] || []).some((row) => !packageIds.has(String(row.goiThauId)))) {
      throw new Error(`Bản nháp có liên kết ${table} không hợp lệ.`);
    }
  }
  if ((aggregate.assignments || []).some((assignment) => (
    assignment.type === "kehoach"
      ? !planIds.has(String(assignment.targetId))
      : assignment.type === "goithau" && !packageIds.has(String(assignment.targetId))
  ))) {
    throw new Error("Bản nháp có phân công trỏ tới đối tượng không hợp lệ.");
  }
  return true;
}

async function applyCanonicalFinalizeResponse(model, response) {
  const versions = response?.rowVersions || [];
  if (Array.isArray(versions) && typeof model.applyCommittedRowVersions === "function") {
    await model.applyCommittedRowVersions(versions);
  } else if (Array.isArray(versions)) {
    versions.forEach(({ table, id, rowVersion }) => {
      const row = (model.state?.[table] || []).find(
        (candidate) => String(candidate.id) === String(id),
      );
      if (row) row.rowVersion = Number(rowVersion);
      model.entityIndexes?.invalidate?.(table);
    });
  }
  if (response?.syncVersion !== undefined) {
    model.workspaceStorage?.setItem?.("bf_last_sync_version", String(response.syncVersion));
  }
}

export async function finalizePlanVersionDraft(controller, session, {
  send = (payload) => postJson("/api/plans/finalize-draft", payload, {
    headers: { "Idempotency-Key": payload.clientMutationId },
    retries: 1,
  }),
} = {}) {
  const model = controller?.model;
  const refreshed = refreshPlanVersionDraftSession(
    session,
    model.state,
    session.currentVersionId,
  );
  if (!refreshed) throw new Error("Không thể đọc lại bản nháp kế hoạch.");
  validatePlanVersionDraftSession(refreshed);
  await savePlanVersionDraftSession(model, refreshed);
  const response = await send(buildPlanDraftFinalizePayload(model, refreshed));
  await applyCanonicalFinalizeResponse(model, response);
  await removePlanVersionDraftSession(model, refreshed.draftId);
  return response;
}
