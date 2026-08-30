import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeOutboundRecord,
  unknownOutboundFields,
} from "../../frontend/app/outboundSerializer.js";
import { BiddingModel } from "../../frontend/app/BiddingModel.js";


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

test("record normalization preserves the procurement import authority marker", () => {
  const model = new BiddingModel();
  const sourceRevision = {
    provider: "MUASAMCONG",
    sessionId: "session-1",
    workspaceLease: "lease-1",
    revisionId: "revision-00",
    revisionNumber: "00",
    revisionDigest: "sha256:abc",
  };
  const normalized = model.normalizeRecordKeys({
    id: "plan-00",
    sourceRevision,
    _procurementImportCurrent: true,
  }, "kehoach");

  assert.deepEqual(serializeOutboundRecord(normalized, "kehoach"), {
    id: "plan-00",
    sourceRevision,
  });
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

test("plan basis serialization strips server-owned parser projection", () => {
  const serialized = serializeOutboundRecord({
    id: "plan-00",
    canCuLapKeHoachList: [{
      id: "khcc-1",
      rootId: "khcc-root",
      noiDungGoc: "Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC",
      tenVanBan: "Quyết định",
      tenCanCu: "Quyết định",
      parseStatus: "PARSED",
      parseReasons: [],
    }, {
      noiDungGoc: "Căn cứ văn bản mới",
      parseStatus: "UNPARSED",
    }],
  }, "kehoach");

  assert.deepEqual(serialized.canCuLapKeHoachList, [{
    id: "khcc-1",
    noiDungGoc: "Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC",
  }, {
    noiDungGoc: "Căn cứ văn bản mới",
  }]);
});
