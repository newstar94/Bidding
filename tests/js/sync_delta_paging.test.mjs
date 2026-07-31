import assert from "node:assert/strict";
import test from "node:test";

import { fetchDeltaSnapshot } from "../../frontend/app/syncCursor.js";

function response(payload, ok = true) {
  return { ok, status: ok ? 200 : 409, json: async () => payload };
}

test("delta client advances the durable version only after the final page", async () => {
  const calls = [];
  const apiFetch = async (url) => {
    calls.push(url);
    return calls.length === 1
      ? response({ goithau: [{ id: "one" }], deletions: [], throughVersion: 9, partial: true, nextCursor: "signed" })
      : response({ goithau: [{ id: "two" }], deletions: [{ table: "goithau", id: "old" }], throughVersion: 9, partial: false, syncVersion: 9 });
  };

  const result = await fetchDeltaSnapshot(apiFetch, { afterVersion: 3, headers: {} });

  assert.deepEqual(result.snapshot.goithau.map((item) => item.id), ["one", "two"]);
  assert.equal(result.snapshot.syncVersion, 9);
  assert.equal(result.snapshot.partial, false);
  assert.match(calls[1], /cursor=signed/u);
});

test("delta client exposes an error without committing a partial snapshot", async () => {
  let count = 0;
  const result = await fetchDeltaSnapshot(async () => {
    count += 1;
    return count === 1
      ? response({ goithau: [{ id: "one" }], throughVersion: 9, nextCursor: "signed" })
      : response({ code: "FULL_SYNC_REQUIRED" }, false);
  }, { afterVersion: 3, headers: {} });

  assert.equal(result.snapshot, null);
  assert.equal(result.response.status, 409);
});
