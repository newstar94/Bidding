import assert from "node:assert/strict";
import test from "node:test";

import { ConflictCenterClient } from "../../frontend/app/ConflictCenterClient.js";
import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";


function response(payload, ok = true, status = 200) {
  return { ok, status, async json() { return payload; } };
}


test("conflict client uses explicit capture preview resolve and discard commands", async () => {
  const calls = [];
  const client = new ConflictCenterClient({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return response({ ok: true });
    },
  });

  await client.capture({ recordId: "package-1" });
  await client.list("workspace a");
  await client.preview("draft/1", "workspace a");
  await client.resolve("draft/1", { decisions: { tenGoiThau: "LOCAL" } });
  await client.discard("draft/1", "workspace a");

  assert.deepEqual(calls.map((call) => [call.url, call.options.method || "GET"]), [
    ["/api/conflict-drafts", "POST"],
    ["/api/conflict-drafts?workspaceFingerprint=workspace+a", "GET"],
    ["/api/conflict-drafts/draft%2F1/preview?workspaceFingerprint=workspace+a", "POST"],
    ["/api/conflict-drafts/draft%2F1/resolve", "POST"],
    ["/api/conflict-drafts/draft%2F1?workspaceFingerprint=workspace+a", "DELETE"],
  ]);
  assert.equal(JSON.parse(calls[3].options.body).decisions.tenGoiThau, "LOCAL");
});


test("outbox pins the first server base and never replaces it with later local edits", () => {
  const store = { persist() {}, async hydrate() {}, async flush() {} };
  let id = 0;
  const outbox = new WorkspaceMutationOutbox({
    store,
    createId: () => `mutation-${++id}`,
    isSyncedType: () => true,
    normalizeRecord: (record) => structuredClone(record),
  });
  const base = { id: "package-1", rowVersion: 2, tenGoiThau: "Base", giaGoiThau: 100 };
  const first = { ...base, tenGoiThau: "Local 1" };
  const second = { ...base, tenGoiThau: "Local 2" };

  outbox.enqueue({ kind: "upsert", table: "goithau", records: [first], baseRecords: [base] });
  outbox.enqueue({
    kind: "upsert",
    table: "goithau",
    records: [second],
    baseRecords: [{ ...base, tenGoiThau: "Wrong replacement" }],
  });

  const checkpoint = outbox.checkpoint();
  assert.equal(checkpoint.queue.baseSnapshots.goithau["package-1"].tenGoiThau, "Base");
  assert.equal(checkpoint.queue.upserts.goithau["package-1"].tenGoiThau, "Local 2");
});


test("conflict client surfaces typed stale authority errors", async () => {
  const client = new ConflictCenterClient({
    fetchImpl: async () => response(
      { code: "AUTHORITY_SCOPE_MISMATCH", message: "stale" },
      false,
      409,
    ),
  });
  await assert.rejects(
    () => client.resolve("draft-1", {}),
    (error) => error.code === "AUTHORITY_SCOPE_MISMATCH" && error.status === 409,
  );
});
