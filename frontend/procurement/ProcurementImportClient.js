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
