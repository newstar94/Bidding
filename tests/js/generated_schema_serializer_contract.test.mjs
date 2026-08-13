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

test("current procurement import snapshot sends trusted revision authority", () => {
  const sourceRevision = {
    provider: "MUASAMCONG",
    sessionId: "session-1",
    workspaceLease: "lease-1",
    revisionId: "revision-00",
    revisionNumber: "00",
    revisionDigest: "sha256:abc",
  };

  for (const type of ["kehoach", "goithau"]) {
    const record = {
      id: `${type}-00`,
      sourceRevision,
      _procurementImportCurrent: true,
    };
    assert.deepEqual(unknownOutboundFields(record, type), []);
    assert.deepEqual(serializeOutboundRecord(record, type), {
      id: `${type}-00`,
      sourceRevision,
    });
  }
});

test("historical procurement snapshots cannot send import authority", () => {
  const record = {
    id: "plan-00",
    sourceRevision: { sessionId: "session-1", revisionNumber: "00" },
    _procurementImportCurrent: false,
  };

  assert.deepEqual(serializeOutboundRecord(record, "kehoach"), { id: "plan-00" });
});

test("procurement authority remains rejected for unrelated schemas", () => {
  const record = {
    id: "investor-1",
    sourceRevision: { sessionId: "session-1" },
  };

  assert.deepEqual(unknownOutboundFields(record, "chudautu"), ["sourceRevision"]);
  assert.deepEqual(serializeOutboundRecord(record, "chudautu"), { id: "investor-1" });
});
