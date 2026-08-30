import assert from "node:assert/strict";
import test from "node:test";

import { savePackageInvitationInfo } from "../../frontend/packages/packageInvitation.js";

test("invitation save reloads the aggregate children before the caller renders", async () => {
  const pkg = { id: "package-1", rowVersion: 1 };
  const extensions = [{ id: "extension-1", thoiGianDongThau: "31/08/2026 09:00" }];
  const authoritative = { ...pkg, rowVersion: 2, giaHanList: extensions };
  const calls = [];
  const controller = {
    model: {
      state: { goithau: [pkg] },
      commitLocalMutation() {},
      persistChanges: async () => {},
      flushMutationOutbox: async () => {},
    },
    autoSync: async () => ({ ok: true }),
    fetchRecordByLookup: async (table, id) => {
      calls.push([table, id]);
      return authoritative;
    },
  };

  const result = await savePackageInvitationInfo(controller, pkg, {
    extensions,
    convertDateTime: () => "2026-08-31T09:00:00",
  });

  assert.equal(result, authoritative);
  assert.deepEqual(calls, [["goithau", "package-1"]]);
  assert.deepEqual(result.giaHanList, extensions);
});

test("invitation save does not claim an authoritative reload after sync failure", async () => {
  const pkg = { id: "package-2", rowVersion: 1 };
  let fetchCalls = 0;
  const controller = {
    model: {
      state: { goithau: [pkg] },
      commitLocalMutation() {},
      persistChanges: async () => {},
      flushMutationOutbox: async () => {},
    },
    autoSync: async () => ({ ok: false, code: "ROW_VERSION_CONFLICT" }),
    fetchRecordByLookup: async () => { fetchCalls += 1; },
  };

  const result = await savePackageInvitationInfo(controller, pkg, {
    extensions: [],
    convertDateTime: (value) => value,
  });

  assert.equal(result, pkg);
  assert.equal(fetchCalls, 0);
});
