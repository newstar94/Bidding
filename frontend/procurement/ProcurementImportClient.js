import { getJson, postJson } from "../shared/apiClient.js";

const APPLY_FIELDS = new Set([
  "previewId",
  "idempotencyKey",
  "expectedPlanRowVersion",
  "decisions",
  "workspaceLease",
]);
const APPLY_NOTICE_FIELDS = new Set([
  "previewId",
  "idempotencyKey",
  "expectedPackageRowVersion",
  "workspaceLease",
]);
const APPLY_OPENING_FIELDS = new Set([
  "previewId",
  "expectedPackageRowVersion",
  "workspaceLease",
]);

export class ProcurementImportClient {
  constructor({ get = getJson, post = postJson } = {}) {
    this.get = get;
    this.post = post;
  }

  preparePlan(request, { signal } = {}) {
    return this.post(
      "/api/procurement/imports/plan/prepare",
      {
        code: request.code,
        revisionMode: request.revisionMode || "LATEST",
        selectedRevision: request.selectedRevision || null,
        includeLinkedNotices: request.includeLinkedNotices !== false,
        targetPlanRootId: request.targetPlanRootId || null,
        workspaceLease: request.workspaceLease || null,
      },
      { signal, retries: 0 },
    );
  }

  applyPlan(request, { signal } = {}) {
    const untrustedFields = Object.keys(request).filter((key) => !APPLY_FIELDS.has(key));
    if (untrustedFields.length) {
      throw new TypeError("Apply chỉ nhận previewId, decisions và CAS metadata.");
    }
    return this.post(
      "/api/procurement/imports/plan/apply",
      request,
      {
        signal,
        retries: 1,
        headers: { "Idempotency-Key": request.idempotencyKey },
        timeoutMs: 120_000,
      },
    );
  }

  getPlanSession(sessionId, { workspaceLease, signal } = {}) {
    const query = workspaceLease
      ? `?workspaceLease=${encodeURIComponent(workspaceLease)}`
      : "";
    return this.get(
      `/api/procurement/imports/plan/sessions/${encodeURIComponent(sessionId)}${query}`,
      { signal, retries: 1 },
    );
  }

  bindPlanSessionDecisions(sessionId, request, { signal } = {}) {
    const allowed = new Set(["bundleDigest", "decisions", "workspaceLease"]);
    const untrustedFields = Object.keys(request || {}).filter((key) => !allowed.has(key));
    if (untrustedFields.length) {
      throw new TypeError("Decision binding chỉ nhận digest, decisions và workspace lease.");
    }
    return this.post(
      `/api/procurement/imports/plan/sessions/${encodeURIComponent(sessionId)}/decisions`,
      request,
      { signal, retries: 1 },
    );
  }

  getImportSession(sessionId, { workspaceLease, signal, kind = "plan" } = {}) {
    const query = workspaceLease
      ? `?workspaceLease=${encodeURIComponent(workspaceLease)}`
      : "";
    return this.get(
      `/api/procurement/imports/${encodeURIComponent(kind)}/sessions/`
        + `${encodeURIComponent(sessionId)}${query}`,
      { signal, retries: 1 },
    );
  }

  cancelImportSession(sessionId, { workspaceLease, signal, kind = "plan" } = {}) {
    const query = workspaceLease
      ? `?workspaceLease=${encodeURIComponent(workspaceLease)}`
      : "";
    return this.post(
      `/api/procurement/imports/${encodeURIComponent(kind)}/sessions/`
        + `${encodeURIComponent(sessionId)}/cancel${query}`,
      {},
      { signal, retries: 1 },
    );
  }

  getPlanRevisionDraft(sessionId, revisionNumber, {
    workspaceLease,
    signal,
    kind = "plan",
  } = {}) {
    const query = workspaceLease
      ? `?workspaceLease=${encodeURIComponent(workspaceLease)}`
      : "";
    return this.get(
      `/api/procurement/imports/${encodeURIComponent(kind)}/sessions/`
        + `${encodeURIComponent(sessionId)}/revisions/`
        + `${encodeURIComponent(revisionNumber)}${query}`,
      { signal, retries: 1 },
    );
  }

  prepareNotice(request, { signal } = {}) {
    return this.post(
      "/api/procurement/imports/notice/prepare",
      {
        code: request.code,
        revisionMode: request.revisionMode || "LATEST",
        selectedRevision: request.selectedRevision || null,
        targetPackageRootId: request.targetPackageRootId || null,
        workspaceLease: request.workspaceLease || null,
      },
      { signal, retries: 0 },
    );
  }

  applyNotice(request, { signal } = {}) {
    const untrustedFields = Object.keys(request).filter(
      (key) => !APPLY_NOTICE_FIELDS.has(key),
    );
    if (untrustedFields.length) {
      throw new TypeError("Apply chỉ nhận previewId và package CAS metadata.");
    }
    return this.post(
      "/api/procurement/imports/notice/apply",
      request,
      {
        signal,
        retries: 1,
        headers: { "Idempotency-Key": request.idempotencyKey },
        timeoutMs: 120_000,
      },
    );
  }

  prepareOpening(request, { signal } = {}) {
    return this.post(
      "/api/procurement/imports/opening/prepare",
      {
        packageId: request.packageId,
        noticeNo: request.noticeNo || null,
        selectedRevision: request.selectedRevision || null,
        workspaceLease: request.workspaceLease || null,
      },
      { signal, retries: 0, timeoutMs: 120_000 },
    );
  }

  applyOpening(request, { signal } = {}) {
    const untrustedFields = Object.keys(request).filter(
      (key) => !APPLY_OPENING_FIELDS.has(key),
    );
    if (untrustedFields.length) {
      throw new TypeError("Apply chỉ nhận previewId và package CAS metadata.");
    }
    return this.post(
      "/api/procurement/imports/opening/apply",
      request,
      { signal, retries: 0, timeoutMs: 30_000 },
    );
  }

  getOperation(operationId, { signal } = {}) {
    return this.get(
      `/api/procurement/imports/operations/${encodeURIComponent(operationId)}`,
      { signal, retries: 1 },
    );
  }

  resumeOperation(operationId, { signal } = {}) {
    return this.post(
      `/api/procurement/imports/operations/${encodeURIComponent(operationId)}/resume`,
      {},
      { signal, retries: 1, headers: { "Idempotency-Key": `resume:${operationId}` } },
    );
  }
}
