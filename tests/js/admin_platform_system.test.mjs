import assert from "node:assert/strict";
import test from "node:test";

import { createLatestAdminLoader, directoryQuery, directoryResultsMarkup, readDirectoryState } from "../../frontend/admin-platform/AdminDirectory.js";
import { JOB_DIRECTORY, SYNC_DIRECTORY } from "../../frontend/admin-platform/AdminSystem.js";

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
    items: [{ id: "job-1", organizationId: "org-a", operation: "render", recordType: "goi_thau", status: "failed", attemptCount: 2, progress: { phase: "failed", completedItems: 0, totalItems: 1 }, lastErrorCode: "RENDER_FAILED", updatedAt: 100 }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(jobs, /job-1|RENDER_FAILED|0\/1/u);
  assert.doesNotMatch(jobs, /filename|lockedBy|lastErrorMessage/u);

  const sync = directoryResultsMarkup(SYNC_DIRECTORY, readDirectoryState(SYNC_DIRECTORY, ""), {
    items: [{ id: 1, organizationId: "org-a", eventType: "broadcast", status: "pending", attemptCount: 0, availableAt: 100 }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(sync, /broadcast|org-a|pending/u);
  assert.doesNotMatch(sync, /payload|userId|workerId/u);
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
