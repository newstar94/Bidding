import assert from "node:assert/strict";
import test from "node:test";

import { createLatestAdminLoader, directoryQuery, directoryResultsMarkup, readDirectoryState } from "../../frontend/admin-platform/AdminDirectory.js";
import {
  JOB_DIRECTORY, SYNC_DIRECTORY, executeJobRetry, jobDetailMarkup,
  jobSummaryMarkup, syncSummaryMarkup,
} from "../../frontend/admin-platform/AdminSystem.js";

const JOB_ID = "b".repeat(32);

test("jobs use bounded server-side operation, status, sorting and pagination", () => {
  const state = readDirectoryState(JOB_DIRECTORY, "?page=2&pageSize=50&operation=render&status=failed&sortBy=attempt_count&sortDir=asc&unknown=x");
  assert.deepEqual(directoryQuery(state, JOB_DIRECTORY), {
    page: 2, pageSize: 50, operation: "render", sortBy: "attempt_count",
    sortDir: "asc", status: "failed",
  });
  const invalid = readDirectoryState(JOB_DIRECTORY, "?pageSize=500&status=secret&sortBy=filename");
  assert.deepEqual(directoryQuery(invalid, JOB_DIRECTORY), {
    page: 1, pageSize: 25, sortBy: "created_at", sortDir: "desc",
  });
});

test("sync uses only allowlisted server controls", () => {
  const state = readDirectoryState(SYNC_DIRECTORY, "?status=pending&eventType=broadcast&sortBy=available_at");
  assert.deepEqual(directoryQuery(state, SYNC_DIRECTORY), {
    page: 1, pageSize: 25, sortBy: "available_at", sortDir: "desc",
    status: "pending", eventType: "broadcast",
  });
});

test("job and sync tables render sanitized operational fields", () => {
  const jobs = directoryResultsMarkup(JOB_DIRECTORY, readDirectoryState(JOB_DIRECTORY, ""), {
    items: [{ id: JOB_ID, organizationId: "org-a", operation: "render", recordType: "goi_thau", status: "failed", attemptCount: 2, progress: { phase: "failed", completedItems: 0, totalItems: 1 }, lastErrorCode: "RENDER_FAILED", updatedAt: 100 }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(jobs, new RegExp(`${JOB_ID}|RENDER_FAILED|0/1`, "u"));
  assert.match(jobs, /data-admin-job-detail-id/u);
  assert.doesNotMatch(jobs, /filename|lockedBy|lastErrorMessage/u);

  const sync = directoryResultsMarkup(SYNC_DIRECTORY, readDirectoryState(SYNC_DIRECTORY, ""), {
    items: [{ id: 1, organizationId: "org-a", eventType: "broadcast", status: "pending", attemptCount: 0, availableAt: 100 }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(sync, /broadcast|org-a|pending/u);
  assert.doesNotMatch(sync, /payload|userId|workerId/u);
});

test("job detail exposes only sanitized operational fields and retry eligibility", () => {
  const markup = jobDetailMarkup({ job: {
    id: JOB_ID, organizationId: "org-a", operation: "render_docx",
    recordType: "goi_thau", status: "failed", attemptCount: 2,
    progress: { phase: "failed", completedItems: 0, totalItems: 1 },
    error: { code: "RENDER_FAILED", message: "Tác vụ tài liệu không thành công." },
    retryAllowed: true, createdAt: 100, updatedAt: 200,
  } });
  assert.match(markup, /Chi tiết lỗi đã khử nhạy cảm/u);
  assert.match(markup, /data-admin-job-retry/u);
  assert.doesNotMatch(markup, /filename|policy|lockedBy|document content/u);
});

test("job retry requires explicit confirmation and posts only to platform endpoint", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([url, options]);
    return { ok: true, status: 202, headers: { get: () => "application/json" }, json: async () => ({ jobId: JOB_ID, status: "retry" }) };
  };
  const cancelled = await executeJobRetry(JOB_ID, {
    fetchImpl, confirmImpl: async () => false,
  });
  assert.deepEqual(cancelled, { cancelled: true });
  assert.equal(requests.length, 0);

  const result = await executeJobRetry(JOB_ID, {
    fetchImpl, confirmImpl: async (value) => value === JOB_ID,
  });
  assert.equal(result.payload.status, "retry");
  assert.equal(requests[0][0], `/api/admin/system/jobs/${JOB_ID}/retry`);
  assert.equal(requests[0][1].method, "POST");
});

test("job retry performs one privileged reauthentication then retries", async () => {
  const requests = [];
  const responses = [
    [false, 403, { error: "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm." }],
    [true, 200, { success: true }],
    [true, 202, { jobId: JOB_ID, status: "retry" }],
  ];
  const fetchImpl = async (url, options) => {
    requests.push([url, options]);
    const [ok, status, body] = responses.shift();
    return { ok, status, headers: { get: () => "application/json" }, json: async () => body };
  };
  let confirmations = 0;
  let passwordRequests = 0;
  const result = await executeJobRetry(JOB_ID, {
    fetchImpl,
    confirmImpl: async () => { confirmations += 1; return true; },
    requestPassword: async () => { passwordRequests += 1; return "current-password"; },
  });
  assert.equal(result.payload.status, "retry");
  assert.equal(confirmations, 1);
  assert.equal(passwordRequests, 1);
  assert.deepEqual(requests.map(([url]) => url), [
    `/api/admin/system/jobs/${JOB_ID}/retry`,
    "/api/auth/privileged-reauth",
    `/api/admin/system/jobs/${JOB_ID}/retry`,
  ]);
});

test("shared latest-wins loader cancels stale jobs or sync requests", async () => {
  const loader = createLatestAdminLoader();
  let release;
  const stale = new Promise((resolve) => { release = resolve; });
  const applied = [];
  const oldRequest = loader.run(() => stale, { onSuccess: (value) => applied.push(value) });
  const newRequest = loader.run(async () => "new", { onSuccess: (value) => applied.push(value) });
  release("old");
  await Promise.all([oldRequest, newRequest]);
  assert.deepEqual(applied, ["new"]);
});

test("job and sync summary cards expose real aggregates and explicit unavailable metrics", () => {
  const jobs = jobSummaryMarkup({ total: 9, byStatus: { pending: 2, processing: 1, failed: 3 } });
  assert.match(jobs, /data-admin-system-metric="jobs-failed">3/u);
  const sync = syncSummaryMarkup({
    eventsTotal: 20, eventsByStatus: { retry: 2, dead_letter: 1 },
    activeConnections: 4, recordedMutations: 12,
    syncRequests: 12, failedSyncs: 3,
    rowVersionConflicts: null, visibilityResets: null, fullSyncs: 2, outboxFailures: 3,
    metricsScope: "current_process",
  });
  assert.match(sync, /data-admin-system-metric="sync-requests">12/u);
  assert.match(sync, /data-admin-system-metric="sync-failed">3/u);
  assert.match(sync, /data-admin-system-metric="sync-full-resets">2/u);
  assert.match(sync, /data-admin-system-metric="sync-outbox-failures">3/u);
  assert.equal((sync.match(/>N\/A</gu) || []).length, 2);
  assert.match(sync, /phạm vi tiến trình hiện tại/u);
});
