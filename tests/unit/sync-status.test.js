import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFieldConflictChoices,
  buildConflictDiff,
  collectFieldConflicts,
  deriveSyncStatus,
  renderSyncStatus,
  summarizeMutationQueue
} from "../../frontend/app/syncStatus.js";
import { selectPostCommitRenderKeys } from "../../frontend/app/BiddingControllerSync.js";

test("sync status exposes pending count and offline state per workspace", () => {
  const summary = summarizeMutationQueue({
    upserts: { goithau: { a: {}, b: {} }, hopdong: { c: {} } },
    deletes: [{ table: "nhathau", id: "d" }]
  });

  assert.equal(summary.pendingCount, 4);
  assert.deepEqual(
    deriveSyncStatus({ online: false, pendingCount: summary.pendingCount }),
    { state: "offline", label: "Ngoại tuyến · 4 chờ", assertive: true }
  );
});

test("sync status prioritizes conflict and gives a resolvable diff", () => {
  const status = deriveSyncStatus({ phase: "conflict", pendingCount: 1 });
  const diff = buildConflictDiff(
    { upserts: { goithau: { a: { id: "a", tenGoiThau: "Bản máy này" } } } },
    {
      errors: [{
        table: "goithau",
        id: "a",
        message: "Bản ghi đã thay đổi",
        serverRecord: { id: "a", tenGoiThau: "Bản máy chủ" }
      }]
    }
  );

  assert.equal(status.state, "conflict");
  assert.match(diff.join("\n"), /tenGoiThau/);
  assert.match(diff.join("\n"), /Bản máy này/);
  assert.match(diff.join("\n"), /Bản máy chủ/);
});

test("conflicts can be resolved independently for each business field", () => {
  const queue = {
    upserts: {
      goithau: {
        a: { id: "a", tenGoiThau: "Tên local", giaGoiThau: 120, rowVersion: 2 }
      }
    }
  };
  const response = {
    errors: [{
      table: "goithau",
      id: "a",
      serverRecord: { id: "a", tenGoiThau: "Tên server", giaGoiThau: 100, rowVersion: 3 }
    }]
  };

  const conflicts = collectFieldConflicts(queue, response);
  assert.deepEqual(conflicts.map((item) => item.field), ["tenGoiThau", "giaGoiThau"]);
  const merged = applyFieldConflictChoices(queue, conflicts, {
    [conflicts[0].key]: "local",
    [conflicts[1].key]: "server"
  });

  assert.equal(merged.upserts.goithau.a.tenGoiThau, "Tên local");
  assert.equal(merged.upserts.goithau.a.giaGoiThau, 100);
  assert.equal(queue.upserts.goithau.a.giaGoiThau, 120);
});

test("normal and in-progress sync states stay hidden while actionable states remain visible", () => {
  const label = {};
  const count = {};
  const element = {
    dataset: {},
    hidden: false,
    setAttribute() {},
    querySelector(selector) {
      return selector === "[data-sync-label]" ? label : count;
    }
  };

  renderSyncStatus(element, { lastSyncedAt: Date.now() });
  assert.equal(element.hidden, true);

  renderSyncStatus(element, { phase: "syncing", pendingCount: 2 });
  assert.equal(element.hidden, true);

  renderSyncStatus(element, { pendingCount: 2 });
  assert.equal(element.hidden, false);
  assert.equal(label.textContent, "2 thay đổi chờ đồng bộ");
});

test("server acknowledgement does not rerender a whole entity table for an upsert", () => {
  const committed = new Set(["goithau", "dashboardSummary"]);
  assert.deepEqual(
    [...selectPostCommitRenderKeys(committed)],
    ["dashboardSummary"]
  );
  assert.deepEqual(
    [...selectPostCommitRenderKeys(committed, { hasDeletions: true })],
    ["goithau", "dashboardSummary"]
  );
});
