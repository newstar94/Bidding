import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Execute the real helper without running the live account/fixture workflow.
const source = await readFile(new URL("../../scripts/verify_auth_roles_e2e.mjs", import.meta.url), "utf8");
const helper = source.match(/function versionedMutation\([\s\S]*?\n\}/u)?.[0];
assert.ok(helper, "The E2E mutation helper must be covered");
const versionedMutation = vm.runInNewContext(`(${helper})`);

test("E2E updates omit read-only creator hints and retain optimistic concurrency", () => {
  for (const deleteOwnerUserId of ["employee-1", null]) {
    const record = {
      id: "expert-1", hoTen: "Original", soCCCD: "079000000001",
      rowVersion: 7, deleteOwnerUserId, allVersions: [{ id: "older" }],
    };
    const mutation = versionedMutation(record, { hoTen: "Updated" });
    assert.deepEqual(JSON.parse(JSON.stringify(mutation)), {
      id: "expert-1", hoTen: "Updated", soCCCD: "079000000001", expectedVersion: 7,
    });
    assert.equal(record.deleteOwnerUserId, deleteOwnerUserId);
    assert.equal(record.hoTen, "Original");
    assert.equal(record.rowVersion, 7);
  }
});
