import assert from "node:assert/strict";
import test from "node:test";

import { createLatestAdminLoader, directoryQuery, directoryResultsMarkup, readDirectoryState } from "../../frontend/admin-platform/AdminDirectory.js";
import { ORGANIZATION_DIRECTORY, USER_DIRECTORY } from "../../frontend/admin-platform/AdminDirectories.js";

test("directory query keeps only bounded server-side controls", () => {
  const state = readDirectoryState(USER_DIRECTORY, "?page=2&pageSize=50&search=an&role=user&status=active&sortBy=email&sortDir=desc&unknown=x");
  assert.deepEqual(directoryQuery(state, USER_DIRECTORY), {
    page: 2, pageSize: 50, search: "an", sortBy: "email", sortDir: "desc", role: "user", status: "active",
  });
  const invalid = readDirectoryState(USER_DIRECTORY, "?page=-2&pageSize=999&role=manager&sortBy=DROP&sortDir=sideways");
  assert.deepEqual(directoryQuery(invalid, USER_DIRECTORY), {
    page: 1, pageSize: 25, sortBy: "name", sortDir: "asc",
  });
});

test("latest directory request aborts and cannot overwrite newer data", async () => {
  const loader = createLatestAdminLoader();
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const applied = [];
  const oldRun = loader.run(async () => first, { onSuccess: (value) => applied.push(value) });
  const newRun = loader.run(async () => "new", { onSuccess: (value) => applied.push(value) });
  releaseFirst("old");
  await Promise.all([oldRun, newRun]);
  assert.deepEqual(applied, ["new"]);
});

test("user directory renders authorized fields in an accessible responsive table", () => {
  const state = readDirectoryState(USER_DIRECTORY, "");
  const markup = directoryResultsMarkup(USER_DIRECTORY, state, {
    items: [{
      id: "user-1", username: "minhan", name: "Minh An", email: "an@example.test",
      role: "user", status: "active", createdAt: "2026-01-02",
      organizations: [{ name: "Công ty An Bình", role: "manager", employeeName: "Nguyễn An", employeePhone: "0901" }],
    }],
    pagination: { page: 1, totalPages: 2, totalRows: 26 },
  });
  assert.match(markup, /<table[^>]+bf-admin-directory-table/u);
  assert.match(markup, /aria-sort="ascending"/u);
  assert.match(markup, /an@example[.]test/u);
  assert.match(markup, /Nguyễn An · 0901/u);
  assert.match(markup, /data-admin-page="2"/u);
});

test("organization directory renders real subscription values and an empty state", () => {
  const state = readDirectoryState(ORGANIZATION_DIRECTORY, "");
  const markup = directoryResultsMarkup(ORGANIZATION_DIRECTORY, state, {
    items: [{ id: "org-1", name: "Minh An", status: "active", memberCount: 12, subscription: { packageId: "business", status: "active", expiresAt: 4102444800 } }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(markup, /business/u);
  assert.match(markup, />12</u);
  assert.match(directoryResultsMarkup(ORGANIZATION_DIRECTORY, state, { items: [] }), /data-admin-state="empty"/u);
});
