import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeOutboundRecord,
  unknownOutboundFields,
} from "../../frontend/app/outboundSerializer.js";


test("package appraisal decision survives outbound serialization", () => {
  const pkg = {
    id: "package-1",
    yeuCauThamDinhHsmtCode: "REQUIRED",
  };

  assert.deepEqual(unknownOutboundFields(pkg, "goithau"), []);
  assert.deepEqual(serializeOutboundRecord(pkg, "goithau"), pkg);
});
