import assert from "node:assert/strict";
import test from "node:test";

import { overlayPendingPaginatedMutations } from "../../frontend/shared/tableDataUtils.js";

function pendingModel(table, { upserts = [], patches = [] } = {}) {
  return {
    state: { activeuser: { id: "user-1" }, activerole: "manager" },
    getWorkspaceToken: () => "user-1:org-1@1",
    normalizeRecordKeys: (record) => record,
    getMutationQueue: () => ({
      upserts: { [table]: Object.fromEntries(upserts.map((record) => [record.id, record])) },
      patches: { [table]: Object.fromEntries(patches.map((record) => [record.id, record])) },
    }),
  };
}

for (const [table, record] of [
  ["kehoach", { id: "plan-1", maKeHoach: "KH01", tenKeHoach: "Mua sắm thiết bị", tongMucDauTu: 1_000_000 }],
  ["goithau", { id: "package-1", maGoiThau: "GT01", tenGoiThau: "Mua sắm thiết bị", giaGoiThau: 1_000_000 }],
  ["hopdong", { id: "contract-1", soHopDong: "HD01", tenHopDong: "Mua sắm thiết bị", giaTri: 1_000_000 }],
]) {
  test(`empty advanced filters preserve a locally saved ${table} until acknowledgement`, () => {
    const model = pendingModel(table, { upserts: [record] });
    const result = overlayPendingPaginatedMutations(model, table, {
      items: [], totalItems: 0,
    }, { page: 1, pageSize: 10, filters: "[]" });

    assert.deepEqual(result.items, [record]);
    assert.equal(result.totalItems, 1);
    assert.equal(result.pendingLocal, true);
  });
}

test("advanced filters retain existing keyword and approval year constraints for pending plans", () => {
  const matching = { id: "plan-1", maKeHoach: "KH01", tenKeHoach: "Mua sắm thiết bị", ngayPheDuyet: "2026-10-02" };
  const otherYear = { ...matching, id: "plan-2", ngayPheDuyet: "2025-10-02" };
  const otherName = { ...matching, id: "plan-3", tenKeHoach: "Thi công công trình" };
  const model = pendingModel("kehoach", { upserts: [matching, otherYear, otherName] });
  const result = overlayPendingPaginatedMutations(model, "kehoach", {
    items: [], totalItems: 0,
  }, { page: 1, pageSize: 10, search: "thiết bị", nam: "2026", thang: "10", filters: "[]" });

  assert.deepEqual(result.items.map((record) => record.id), ["plan-1"]);
  assert.equal(result.totalItems, 1);
});

test("malformed advanced filter JSON cannot silently remove a locally saved row", () => {
  const record = { id: "plan-1", tenKeHoach: "Mua sắm thiết bị" };
  const model = pendingModel("kehoach", { upserts: [record] });
  assert.throws(() => overlayPendingPaginatedMutations(model, "kehoach", {
    items: [], totalItems: 0,
  }, { page: 1, filters: "{" }));
});

test("pending upserts apply all advanced conditions instead of comparing JSON to a record field", () => {
  const matching = { id: "package-1", tenGoiThau: "Mua sắm thiết bị", giaGoiThau: "2000000" };
  const lowPrice = { ...matching, id: "package-2", giaGoiThau: "500000" };
  const otherName = { ...matching, id: "package-3", tenGoiThau: "Thi công công trình" };
  const model = pendingModel("goithau", { upserts: [matching, lowPrice, otherName] });
  const result = overlayPendingPaginatedMutations(model, "goithau", {
    items: [], totalItems: 0,
  }, {
    page: 1, pageSize: 10,
    filters: JSON.stringify([
      { field: "tenGoiThau", operator: "contains", value: "thiết bị" },
      { field: "giaGoiThau", operator: "range", value: { min: "1500000", max: "2500000" } },
    ]),
  });

  assert.deepEqual(result.items.map((record) => record.id), ["package-1"]);
  assert.equal(result.totalItems, 1);
});

test("a pending patch leaving an advanced filter is removed without hiding matching rows", () => {
  const records = [
    { id: "contract-1", tenHopDong: "Mua sắm thiết bị", giaTri: "2000000" },
    { id: "contract-2", tenHopDong: "Mua sắm thiết bị", giaTri: "1800000" },
  ];
  const model = pendingModel("hopdong", {
    patches: [
      { id: "contract-1", giaTri: "500000" },
      { id: "contract-2", tenHopDong: "Mua sắm thiết bị mới" },
    ],
  });
  const result = overlayPendingPaginatedMutations(model, "hopdong", {
    items: records, totalItems: 2,
  }, {
    page: 1, pageSize: 10,
    filters: JSON.stringify([
      { field: "tenHopDong", operator: "contains", value: "thiết bị" },
      { field: "giaTri", operator: "range", value: { min: "1500000", max: "" } },
    ]),
  });

  assert.deepEqual(result.items, [{ ...records[1], tenHopDong: "Mua sắm thiết bị mới" }]);
  assert.equal(result.totalItems, 1);
  assert.equal(records[1].tenHopDong, "Mua sắm thiết bị", "canonical input remains intact");
});
