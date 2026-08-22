import { serializeOutboundRecord } from "../app/outboundSerializer.js";
import { generateRecordId } from "../shared/idUtils.js";
import { postJson } from "../shared/apiClient.js";
import {
  captureWorkspaceLease,
  isWorkspaceLeaseCurrent,
  workspaceChangedError,
} from "../app/workspaceLease.js";

export const PLAN_VERSION_DRAFT_STORAGE_KEY = "plan_version_drafts_v1";
export const PLAN_VERSION_DRAFT_TOMBSTONE_LIMIT = 256;
const firstSaveAuthorities = new WeakMap();
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
export const PLAN_VERSION_DRAFT_OWNED_TABLES = Object.freeze([
  "kehoach",
  "goithau",
  "goithauhanghoa",
  "thongtinmothau",
  "hanghoaduthaunhathau",
  "assignments",
]);
export const PLAN_VERSION_DRAFT_SHARED_TABLES = Object.freeze([
  "chudautu",
  "chuyengia",
  "nhathau",
]);

const SHARED_TABLES = new Set(PLAN_VERSION_DRAFT_SHARED_TABLES);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function rootOf(record) {
  return String(record?.rootId || record?.id || "");
}

function displayVersionNumber(record) {
  const value = Number.parseInt(String(record?.phienBan ?? "0"), 10);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function strictVersionNumber(record) {
  const raw = record?.phienBan;
  if (typeof raw === "number") {
    if (Number.isInteger(raw) && raw >= 0) return raw;
  } else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const value = Number(raw.trim());
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  throw new Error("Số phiên bản kế hoạch không hợp lệ.");
}

function strictNonnegativeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function isUnpersistedRecord(record) {
  return ["rowVersion", "expectedVersion"].every((field) => {
    if (!Object.prototype.hasOwnProperty.call(record || {}, field) || record[field] == null) {
      return true;
    }
    return strictNonnegativeInteger(record[field]) === 0;
  });
}

function hasValidRecordVersions(record) {
  return ["rowVersion", "expectedVersion"].every((field) => (
    !Object.prototype.hasOwnProperty.call(record || {}, field)
    || record[field] == null
    || strictNonnegativeInteger(record[field]) !== null
  ));
}

function rowsForIds(rows, field, ids) {
  return (rows || []).filter((row) => ids.has(String(row?.[field] || "")));
}

export function capturePlanVersionDraftAggregate(state, planRootId) {
  const rootId = String(planRootId || "");
  const plans = (state?.kehoach || [])
    .filter((plan) => rootOf(plan) === rootId)
    .sort((left, right) => displayVersionNumber(left) - displayVersionNumber(right));
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
  const initialVersion = strictVersionNumber(plan);
  const rootId = rootOf(plan);
  const aggregate = capturePlanVersionDraftAggregate(state, rootId);
  aggregate.kehoach.forEach(strictVersionNumber);
  const session = {
    draftId: generateRecordId("plan-draft"),
    finalizeMutationId: generateRecordId("plan-finalize"),
    rootId,
    status: "editing",
    versions: [String(initialVersion).padStart(2, "0")],
    revision: 0,
    currentVersionId: plan.id,
    createdAt: now,
    updatedAt: now,
    dirtyRelatedRecords: {},
    aggregate: clone(aggregate),
  };
  // A revision-0 draft is valid only as the exact object issued by this
  // factory. Structured/stale clones deliberately lose this non-copyable
  // first-save authority, while durable revisions use normal CAS metadata.
  firstSaveAuthorities.set(session, session.draftId);
  return session;
}

export function refreshPlanVersionDraftSession(session, state, currentVersionId) {
  if (!session?.draftId || !session?.rootId) return null;
  const aggregate = capturePlanVersionDraftAggregate(state, session.rootId);
  const plans = aggregate.kehoach || [];
  if (plans.length === 0) return null;
  const current = plans.find((plan) => String(plan.id) === String(currentVersionId || ""))
    || plans[plans.length - 1];
  session.aggregate = clone(aggregate);
  session.versions = plans.map((plan) => String(strictVersionNumber(plan)).padStart(2, "0"));
  session.currentVersionId = current.id;
  session.updatedAt = new Date().toISOString();
  return session;
}

function validTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compactDraftTombstones(envelope) {
  const tombstones = Object.entries(envelope.tombstones || {})
    .map(([draftId, tombstone], insertionOrder) => ({
      draftId,
      tombstone,
      removedAt: validTimestamp(tombstone?.removedAt),
      insertionOrder,
    }))
    .sort((left, right) => (
      (left.removedAt ?? Number.NEGATIVE_INFINITY)
      - (right.removedAt ?? Number.NEGATIVE_INFINITY)
      || left.insertionOrder - right.insertionOrder
    ));
  let retainedCount = tombstones.length;
  for (const entry of tombstones) {
    if (retainedCount <= PLAN_VERSION_DRAFT_TOMBSTONE_LIMIT) break;
    delete envelope.tombstones[entry.draftId];
    retainedCount -= 1;
  }
  return envelope;
}

function normalizeStoredEnvelope(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.sessions)) {
    return { version: 4, sessions: [], tombstones: {} };
  }
  return {
    version: 4,
    sessions: value.sessions.filter((session) => (
      session?.draftId && session?.rootId && session?.aggregate
    )).map((session) => ({ ...clone(session), revision: normalizeRevision(session.revision) })),
    tombstones: value.tombstones && typeof value.tombstones === "object"
      ? clone(value.tombstones)
      : {},
  };
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function publishDurableSessions(model, envelope) {
  model.planVersionDraftSessions = normalizeStoredEnvelope(envelope).sessions;
  return model.planVersionDraftSessions;
}

function captureDraftStorageCapability(model) {
  return Object.freeze({
    lease: captureWorkspaceLease(model),
    storage: model?.workspaceStorage,
  });
}

function assertDraftStorageCapability(model, capability) {
  if (
    !isWorkspaceLeaseCurrent(model, capability?.lease)
    || model?.workspaceStorage !== capability?.storage
  ) {
    throw workspaceChangedError();
  }
  return capability;
}

async function updateDraftEnvelope(db, updater) {
  if (typeof db?.update === "function") {
    return db.update(PLAN_VERSION_DRAFT_STORAGE_KEY, (current) => (
      compactDraftTombstones(updater(normalizeStoredEnvelope(current)))
    ));
  }
  // Compatibility for small test doubles. BrowserDB always provides atomic update().
  if (typeof db?.set !== "function") {
    throw new Error("Không có kho lưu bền vững cho bản nháp phiên bản kế hoạch.");
  }
  const current = typeof db.get === "function"
    ? await db.get(PLAN_VERSION_DRAFT_STORAGE_KEY)
    : null;
  const next = compactDraftTombstones(updater(normalizeStoredEnvelope(current)));
  await db.set(PLAN_VERSION_DRAFT_STORAGE_KEY, next);
  return next;
}

export async function hydratePlanVersionDraftSessions(model) {
  const capability = captureDraftStorageCapability(model);
  const envelope = normalizeStoredEnvelope(
    await capability.lease.db?.get?.(PLAN_VERSION_DRAFT_STORAGE_KEY),
  );
  assertDraftStorageCapability(model, capability);
  model.planVersionDraftSessions = envelope.sessions;
  await reapplyPlanVersionDraftSessions(model);
  assertDraftStorageCapability(model, capability);
  return model.planVersionDraftSessions;
}

export async function savePlanVersionDraftSession(model, session) {
  if (!session?.draftId) throw new Error("Draft session không hợp lệ.");
  const capability = captureDraftStorageCapability(model);
  const draftId = String(session.draftId);
  const expectedRevision = normalizeRevision(session.revision);
  let persistedSession;
  const envelope = await updateDraftEnvelope(capability.lease.db, (current) => {
    if (Object.hasOwn(current.tombstones, draftId)) {
      throw new Error("Stale plan draft revision cannot resurrect a removed session.");
    }
    const index = current.sessions.findIndex((item) => String(item.draftId) === draftId);
    if (index < 0 && expectedRevision !== 0) {
      throw new Error("Stale plan draft revision cannot resurrect a removed session.");
    }
    if (index < 0 && firstSaveAuthorities.get(session) !== draftId) {
      throw new Error("Stale plan draft revision cannot resurrect a removed session.");
    }
    const storedRevision = index >= 0
      ? normalizeRevision(current.sessions[index].revision)
      : 0;
    if (index >= 0 && expectedRevision !== storedRevision) {
      throw new Error("Stale plan draft revision cannot overwrite a newer snapshot.");
    }
    persistedSession = { ...clone(session), revision: storedRevision + 1 };
    if (index >= 0) current.sessions[index] = persistedSession;
    else current.sessions.push(persistedSession);
    return current;
  });
  assertDraftStorageCapability(model, capability);
  firstSaveAuthorities.delete(session);
  publishDurableSessions(model, envelope);
  session.revision = persistedSession.revision;
  return session;
}

export async function removePlanVersionDraftSession(model, draftId, { expectedRevision } = {}) {
  const capability = captureDraftStorageCapability(model);
  const id = String(draftId || "");
  const hasExpectedRevision = expectedRevision !== undefined;
  const expected = normalizeRevision(expectedRevision);
  let removed = false;
  const envelope = await updateDraftEnvelope(capability.lease.db, (current) => {
    const existing = current.sessions.find((session) => String(session.draftId) === id);
    removed = Boolean(existing);
    if (!existing) return current;
    const storedRevision = normalizeRevision(existing?.revision);
    if (hasExpectedRevision && existing && expected !== storedRevision) {
      throw new Error("Stale plan draft revision cannot remove a newer snapshot.");
    }
    const currentRevision = normalizeRevision(existing.revision);
    current.sessions = current.sessions.filter((session) => String(session.draftId) !== id);
    current.tombstones[id] = {
      revision: currentRevision + 1,
      removedAt: new Date().toISOString(),
    };
    return current;
  });
  assertDraftStorageCapability(model, capability);
  publishDurableSessions(model, envelope);
  return removed;
}

export async function discardPlanVersionDraftSession(model, session) {
  if (!session?.draftId) return false;
  const removed = await removePlanVersionDraftSession(model, session.draftId, {
    expectedRevision: session.revision,
  });
  if (!removed) return false;
  for (const table of PLAN_VERSION_DRAFT_TABLES) {
    const discardedIds = new Set(
      (session.aggregate?.[table] || []).map((row) => String(row?.id || "")),
    );
    if (discardedIds.size === 0) continue;
    const retainedIds = new Set(
      (model.planVersionDraftSessions || []).flatMap(
        (candidate) => (candidate.aggregate?.[table] || []).map(
          (row) => String(row?.id || ""),
        ),
      ),
    );
    model.state[table] = (model.state?.[table] || []).filter((row) => {
      const id = String(row?.id || "");
      return !discardedIds.has(id)
        || retainedIds.has(id)
        || Number(row?.rowVersion) > 0;
    });
    model.entityIndexes?.invalidate?.(table);
  }
  return true;
}

export async function discardPlanVersionDraftForImportSession(model, sessionId) {
  const capability = captureDraftStorageCapability(model);
  assertDraftStorageCapability(model, capability);
  const sourceSessionId = String(sessionId || "");
  if (!sourceSessionId) return false;
  const matches = (model?.planVersionDraftSessions || []).filter((session) => (
    [
      ...(session.aggregate?.kehoach || []),
      ...(session.aggregate?.goithau || []),
    ].some((row) => String(row?.sourceRevision?.sessionId || "") === sourceSessionId)
  ));
  let removed = false;
  for (const session of matches) {
    assertDraftStorageCapability(model, capability);
    removed = await discardPlanVersionDraftSession(model, session) || removed;
    assertDraftStorageCapability(model, capability);
  }
  return removed;
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
  const currentSession = findPlanVersionDraftSession(model, activePlanId);
  if (!currentSession) return null;
  const refreshed = refreshPlanVersionDraftSession(
    clone(currentSession), model.state, activePlanId,
  );
  if (!refreshed) return null;
  await savePlanVersionDraftSession(model, refreshed);
  return refreshed;
}

export async function markPlanVersionDraftRecordsDirty(controller, table, records) {
  const persisted = await persistActivePlanVersionDraftSession(controller);
  const session = clone(persisted);
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
      const dirty = new Set(session.dirtyRelatedRecords?.[table] || []);
      incoming.forEach((row) => {
        const index = byId.get(String(row.id));
        const sharedServerRecord = SHARED_TABLES.has(table)
          && Number(row?.rowVersion) > 0
          && !dirty.has(String(row?.id || ""));
        if (sharedServerRecord) return;
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
    if (persistCleanup) {
      const retainedIds = new Set(retained.map((session) => String(session.draftId)));
      for (const session of sessions) {
        if (!retainedIds.has(String(session.draftId))) {
          await removePlanVersionDraftSession(model, session.draftId, {
            expectedRevision: session.revision,
          });
        }
      }
    } else {
      model.planVersionDraftSessions = retained;
    }
  }
  return retained;
}

export function buildPlanDraftFinalizePayload(model, session) {
  const aggregate = session?.aggregate || {};
  const plans = [...(aggregate.kehoach || [])]
    .sort((left, right) => strictVersionNumber(left) - strictVersionNumber(right));
  const serialize = (table, rows) => (rows || []).map((row) => {
    const serialized = serializeOutboundRecord(row, table, (value, type) => (
      model?.normalizeRecordKeys?.(value, type) || value
    ));
    // The generic sync lane only emits provenance for the active source row.
    // Atomic new-plan finalization is different: every unpersisted revision is
    // committed together and the backend must validate each snapshot against
    // its own authoritative MSC revision.
    if (
      ["kehoach", "goithau"].includes(table)
      && row?.sourceRevision
      && typeof row.sourceRevision === "object"
      && !Array.isArray(row.sourceRevision)
    ) {
      serialized.sourceRevision = clone(row.sourceRevision);
    }
    return serialized;
  });
  const changedRelatedRows = (table) => {
    const dirty = new Set(session?.dirtyRelatedRecords?.[table] || []);
    return (aggregate[table] || []).filter((row) => (
      dirty.has(String(row?.id || ""))
      || (row?.referenceOnly !== true && !(Number(row?.rowVersion) > 0))
    ));
  };
  return {
    draftId: session.draftId,
    planRootId: session.rootId,
    clientMutationId: session.finalizeMutationId,
    baseSyncVersion: model?.workspaceStorage?.getItem?.("bf_last_sync_version") || "0",
    versions: plans.map((plan) => ({
      id: plan.id,
      version: strictVersionNumber(plan),
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
  if (!String(session?.draftId || "").trim()
    || !String(session?.finalizeMutationId || "").trim()
    || !String(session?.rootId || "").trim()) {
    throw new Error("Thiếu định danh bản nháp, root hoặc idempotency key.");
  }
  if (PLAN_VERSION_DRAFT_TABLES.some((table) => (
    (aggregate[table] || []).some((row) => !hasValidRecordVersions(row))
  ))) {
    throw new Error("Phiên bản bản ghi trong bản nháp không hợp lệ.");
  }
  const plans = [...(aggregate.kehoach || [])]
    .sort((left, right) => strictVersionNumber(left) - strictVersionNumber(right));
  if (plans.length === 0) throw new Error("Bản nháp chưa có phiên bản kế hoạch.");
  const rootId = String(session?.rootId || "");
  const versions = plans.map(strictVersionNumber);
  if (new Set(versions).size !== versions.length) {
    throw new Error("Chuỗi phiên bản kế hoạch bị trùng.");
  }
  if (versions.some((value, index) => value !== index)) {
    throw new Error("Chuỗi phiên bản kế hoạch phải liên tục từ 00.");
  }
  if (plans.some((plan) => rootOf(plan) !== rootId || !isUnpersistedRecord(plan))) {
    throw new Error("Bản nháp không thuộc cùng một dòng phiên bản mới.");
  }
  const planIdList = plans.map((plan) => String(plan.id || ""));
  const planIds = new Set(planIdList);
  if (planIdList.some((id) => !id) || planIds.size !== plans.length) {
    throw new Error("Bản nháp có ID kế hoạch thiếu hoặc bị trùng.");
  }
  const packages = aggregate.goithau || [];
  const packageIdList = packages.map((pkg) => String(pkg.id || ""));
  const packageIds = new Set(packageIdList);
  if (packageIdList.some((id) => !id) || packageIds.size !== packages.length) {
    throw new Error("Bản nháp có ID gói thầu thiếu hoặc bị trùng.");
  }
  if (packages.some((pkg) => (
    !planIds.has(String(pkg.keHoachId)) || !isUnpersistedRecord(pkg)
  ))) {
    throw new Error("Gói thầu không trỏ tới phiên bản kế hoạch hợp lệ.");
  }
  for (const table of ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau"]) {
    const rows = aggregate[table] || [];
    const ids = rows.map((row) => String(row?.id || ""));
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length
      || rows.some((row) => !packageIds.has(String(row.goiThauId)))) {
      throw new Error(`Bản nháp có liên kết ${table} không hợp lệ.`);
    }
  }
  const assignments = aggregate.assignments || [];
  const assignmentIds = assignments.map((assignment) => String(assignment?.id || ""));
  if (assignmentIds.some((id) => !id) || new Set(assignmentIds).size !== assignments.length
    || assignments.some((assignment) => !(
      (assignment.type === "kehoach" && planIds.has(String(assignment.targetId)))
      || (assignment.type === "goithau" && packageIds.has(String(assignment.targetId)))
    ))) {
    throw new Error("Bản nháp có phân công trỏ tới đối tượng không hợp lệ.");
  }
  return true;
}

function staleFinalizeResult() {
  return {
    ok: false,
    stale: true,
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
  };
}

function finalizeLeaseIsCurrent(model, lease, storage) {
  return isWorkspaceLeaseCurrent(model, lease)
    && model?.workspaceStorage === storage;
}

async function applyCanonicalFinalizeResponse(resources, response, isCurrent) {
  const versions = response?.rowVersions || [];
  if (Array.isArray(versions)) {
    resources.outbox?.enqueue?.({ kind: "server-row-version", entries: versions });
    const prepared = versions.flatMap(({ table, id, rowVersion }) => {
      if (!table || !id || !Number.isInteger(rowVersion)) return [];
      const row = (resources.state?.[table] || []).find(
        (candidate) => String(candidate.id) === String(id),
      );
      if (!row) return [];
      return [{ table, row, next: { ...row, rowVersion: Number(rowVersion) } }];
    });
    const writes = prepared
      .filter(({ table }) => (
        typeof resources.db?.putRecord === "function"
        && (!Array.isArray(resources.db?.stores) || resources.db.stores.includes(table))
      ))
      .map(({ table, next }) => resources.db.putRecord(table, next));
    await Promise.all(writes);
    if (!isCurrent()) return false;
    prepared.forEach(({ table, row, next }) => {
      row.rowVersion = next.rowVersion;
      resources.entityIndexes?.invalidate?.(table);
    });
  }
  if (response?.syncVersion !== undefined) {
    resources.storage?.setItem?.("bf_last_sync_version", String(response.syncVersion));
  }
  return true;
}

export async function finalizePlanVersionDraft(controller, session, {
  send = (payload) => postJson("/api/plans/finalize-draft", payload, {
    headers: { "Idempotency-Key": payload.clientMutationId },
    retries: 1,
  }),
} = {}) {
  const model = controller?.model;
  const lease = captureWorkspaceLease(model);
  const storage = model?.workspaceStorage;
  const resources = {
    state: lease.state,
    db: lease.db,
    storage,
    workspaceStorage: storage,
    entityIndexes: model?.entityIndexes,
    outbox: model?._getMutationOutbox?.(),
    normalizeRecordKeys: typeof model?.normalizeRecordKeys === "function"
      ? model.normalizeRecordKeys.bind(model)
      : undefined,
    planVersionDraftSessions: clone(model?.planVersionDraftSessions || []),
  };
  const isCurrent = () => finalizeLeaseIsCurrent(model, lease, storage);
  if (!isCurrent()) return staleFinalizeResult();
  const refreshed = refreshPlanVersionDraftSession(
    clone(session),
    resources.state,
    session.currentVersionId,
  );
  if (!refreshed) throw new Error("Không thể đọc lại bản nháp kế hoạch.");
  validatePlanVersionDraftSession(refreshed);
  await savePlanVersionDraftSession(resources, refreshed);
  if (!isCurrent()) return staleFinalizeResult();
  model.planVersionDraftSessions = clone(resources.planVersionDraftSessions);
  Object.assign(session, clone(refreshed));
  const payload = buildPlanDraftFinalizePayload(resources, refreshed);
  const finalizedMutationReceipt = resources.outbox?.captureReceiptForRecords?.(payload);
  if (!isCurrent()) return staleFinalizeResult();
  const response = await send(payload);
  if (!isCurrent()) return staleFinalizeResult();
  const applied = await applyCanonicalFinalizeResponse(resources, response, isCurrent);
  if (!applied || !isCurrent()) return staleFinalizeResult();
  if (finalizedMutationReceipt) {
    resources.outbox?.ack?.(finalizedMutationReceipt);
    await resources.outbox?.flush?.();
    if (!isCurrent()) return staleFinalizeResult();
  }
  await removePlanVersionDraftSession(resources, refreshed.draftId, {
    expectedRevision: refreshed.revision,
  });
  if (!isCurrent()) return staleFinalizeResult();
  model.planVersionDraftSessions = clone(resources.planVersionDraftSessions);
  return response;
}
