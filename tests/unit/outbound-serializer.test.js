import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedOutboundFields,
  assertOutboundRecordFields,
  serializeOutboundRecord
} from "../../frontend/app/outboundSerializer.js";

test("outbound serializer keeps schema and child fields but removes UI and server metadata", () => {
  const serialized = serializeOutboundRecord({
    id: "gt-1",
    tenGoiThau: "Gói số 1",
    quaMang: "Qua mạng",
    isRebid: true,
    rebidFromPackageId: "gt-source",
    phanLoList: [{ id: "lot-1", tenPhanLo: "Lô 1" }],
    allVersions: [{ id: "old" }],
    canEdit: false,
    referenceOnly: true,
    organizationId: "org-1",
    rowVersion: 4,
    createdAt: "2026-07-14 10:00:00"
  }, "goithau");

  assert.deepEqual(serialized.phanLoList, [{ id: "lot-1", tenPhanLo: "Lô 1" }]);
  assert.equal(serialized.quaMang, "Qua mạng");
  assert.equal(serialized.isRebid, true);
  assert.equal(serialized.rebidFromPackageId, "gt-source");
  assert.equal(serialized.expectedVersion, 4);
  assert.equal(Object.hasOwn(serialized, "rowVersion"), false);
  assert.equal(Object.hasOwn(serialized, "organizationId"), false);
  assert.equal(Object.hasOwn(serialized, "allVersions"), false);
  assert.equal(Object.hasOwn(serialized, "canEdit"), false);
  assert.equal(Object.hasOwn(serialized, "referenceOnly"), false);
});

test("new records do not receive an expected version", () => {
  const serialized = serializeOutboundRecord({ id: "gt-new", tenGoiThau: "Gói mới" }, "goithau");
  assert.equal(Object.hasOwn(serialized, "expectedVersion"), false);
});

test("system-generated display versions are sent as database integers", () => {
  const initial = serializeOutboundRecord({
    id: "cdt-00",
    phienBan: "00",
    tenChuDauTu: "Chủ đầu tư"
  }, "chudautu");
  const next = serializeOutboundRecord({
    id: "nt-01",
    phienBan: "01",
    tenNhaThau: "Nhà thầu"
  }, "nhathau");

  assert.equal(initial.phienBan, 0);
  assert.equal(next.phienBan, 1);
});

test("plan and package mappings expose the canonical business fields", () => {
  assert.equal(allowedOutboundFields("kehoach").has("maDuan"), true);
  assert.equal(allowedOutboundFields("kehoach").has("thoiGianDuAn"), true);
  assert.equal(allowedOutboundFields("goithau").has("quaMang"), true);
  assert.equal(allowedOutboundFields("goithau").has("trongNuocQuocTe"), true);
  assert.equal(allowedOutboundFields("goithau").has("isRebid"), true);
  assert.equal(allowedOutboundFields("goithau").has("rebidFromPackageId"), true);
});

test("form and import field contracts reject misspelled schema fields", () => {
  assert.doesNotThrow(() => assertOutboundRecordFields({
    id: "gt-1",
    tenGoiThau: "Gói hợp lệ",
    rowVersion: 2,
    referenceOnly: false
  }, "goithau", { source: "Excel goithau" }));

  assert.throws(
    () => assertOutboundRecordFields({ tenGoiThau: "Gói", giaGoiThaau: 10 }, "goithau", { source: "form goithau" }),
    /giaGoiThaau/
  );
});
