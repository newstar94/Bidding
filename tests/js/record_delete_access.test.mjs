import assert from "node:assert/strict";
import test from "node:test";
import { canRequestRecordDelete } from "../../frontend/shared/recordDeleteAccess.js";
import { serializeOutboundRecord, unknownOutboundFields } from "../../frontend/app/outboundSerializer.js";
import { copyAsNewRecord } from "../../frontend/shared/VersionedEntityService.js";

const model = (organizationId, role = "employee") => ({
  state: { activerole: role, activeuser: { id: "alice" } },
  workspaceScope: { organizationId },
});
test("personal owner can delete without being an organization manager", () => {
  assert.equal(canRequestRecordDelete(model("personal:alice"), { id: "new" }), true);
  assert.equal(canRequestRecordDelete(model("personal:bob"), { id: "other" }), false);
});
test("organization member needs identity-bound creator evidence", () => {
  assert.equal(canRequestRecordDelete(model("org"), { deleteOwnerUserId: "alice" }), true);
  assert.equal(canRequestRecordDelete(model("org"), { deleteOwnerUserId: "bob" }), false);
  assert.equal(canRequestRecordDelete(model("org"), { createdBy: "alice" }), false);
  assert.equal(canRequestRecordDelete(model("org"), {}), false);
  assert.equal(canRequestRecordDelete(model("org", "manager"), {}), true);
});

test("creator hint is read-only metadata, not outbound business data or a copied creator claim", () => {
  const row = { id: "record", deleteOwnerUserId: "alice" };
  assert.deepEqual(unknownOutboundFields(row, "kehoach"), []);
  assert.deepEqual(serializeOutboundRecord(row, "kehoach"), { id: "record" });
  assert.equal(copyAsNewRecord(row).deleteOwnerUserId, undefined);
});
