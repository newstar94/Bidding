import test from "node:test";
import assert from "node:assert/strict";

import {
  foldText,
  searchWorkspace,
} from "../../frontend/app/WorkspaceTools.js";
import { describeApiError, formatRetryAfter } from "../../frontend/shared/apiErrorText.js";
import { previewUrlFor } from "../../frontend/documents/WordPreviewDialog.js";
import { deleteView, listSavedViews, saveView } from "../../frontend/shared/BusinessListSavedViews.js";

test("global search matches codes and Vietnamese names without diacritics", () => {
  const state = {
    goithau: [
      { id: "p1", idGoc: "p1", maGoiThau: "IB2600000001", tenGoiThau: "Mua sắm thiết bị y tế", isLatest: 1 },
      { id: "p0", idGoc: "p1", maGoiThau: "IB2600000001", tenGoiThau: "Bản cũ", isLatest: 0 },
    ],
    nhathau: [{ id: "n1", maSoThue: "0101234567", tenNhaThau: "Công ty Đông Á" }],
  };
  assert.equal(foldText("Đông Á"), "dong a");
  const byName = searchWorkspace(state, "thiet bi");
  assert.deepEqual(byName.map((item) => item.id), ["p1"]);
  assert.equal(searchWorkspace(state, "IB2600000001")[0].score, 0);
  assert.equal(searchWorkspace(state, "dong a")[0].source.command, "showNhaThauDetails");
  assert.deepEqual(searchWorkspace(state, "  "), []);
});

test("API error text adds the wait time and support reference", () => {
  assert.equal(formatRetryAfter(30), "30 giây");
  assert.equal(formatRetryAfter(61), "2 phút");
  assert.equal(
    describeApiError({ error: "Quá nhiều lần đăng nhập.", retry_after: 45 }, "x", { status: 429 }),
    "Quá nhiều lần đăng nhập. Vui lòng thử lại sau 45 giây.",
  );
  assert.equal(
    describeApiError({ error: "Không có quyền.", requestId: "req-1" }, "x", { includeReference: true }),
    "Không có quyền. Mã tra cứu: req-1",
  );
  assert.equal(describeApiError({ requestId: "<b>" }, "Lỗi", { includeReference: true }), "Lỗi");
});

test("Word preview only targets the matching document job", () => {
  assert.equal(previewUrlFor("/api/document-jobs/abc/download"), "/api/document-jobs/abc/preview");
  assert.equal(previewUrlFor("https://evil.example/api/document-jobs/abc/download"), "");
  assert.equal(previewUrlFor("/api/other/download"), "");
});

test("saved list views are scoped per workspace and validated", () => {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  try {
    const modelA = { workspaceScope: { key: "user-1@org-a" } };
    const modelB = { workspaceScope: { key: "user-1@org-b" } };
    assert.throws(() => saveView(modelA, "goithau", "", [{ field: "x" }]));
    assert.throws(() => saveView(modelA, "goithau", "Rỗng", []));
    saveView(modelA, "goithau", "Đang mời thầu", [{ field: "trangThai", values: ["Đang mời thầu"] }]);
    assert.deepEqual(listSavedViews(modelA, "goithau").map((view) => view.name), ["Đang mời thầu"]);
    assert.deepEqual(listSavedViews(modelB, "goithau"), []);
    deleteView(modelA, "goithau", "Đang mời thầu");
    assert.deepEqual(listSavedViews(modelA, "goithau"), []);
  } finally {
    globalThis.localStorage = previous;
  }
});

test("snoozed invitations stay hidden unless new or opened from the email link", async () => {
  const { invitationsToShow } = await import("../../frontend/app/WorkspaceTools.js");
  const invitations = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(invitationsToShow(invitations, { snoozed: new Set(["a"]) }).map((item) => item.id), ["b"]);
  assert.deepEqual(invitationsToShow(invitations, { snoozed: new Set(["a", "b"]) }), []);
  assert.equal(invitationsToShow(invitations, { snoozed: new Set(["a", "b"]), force: true }).length, 2);
});
