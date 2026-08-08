import assert from "node:assert/strict";
import test from "node:test";

import { EntityIndexes } from "../../frontend/app/EntityIndexes.js";
import { storeFetchedRecord } from "../../frontend/app/SyncPullService.js";
import { cachePaginatedRecords } from "../../frontend/shared/tableDataUtils.js";


test("entity indexes derive all relationship projections and invalidate by table", () => {
  const state = {
    goithau: [
      { id: "pkg-1", rootId: "pkg-root", keHoachId: "plan-1" },
      { id: "pkg-2", rootId: "pkg-root", keHoachId: "plan-2" },
    ],
    hanghoaduthaunhathau: [{
      id: "bidder-goods-1",
      goiThauId: "pkg-1",
      thongTinMoThauId: "opening-1",
      nhaThauId: "contractor-1",
      phanLoId: "lot-1",
    }],
  };
  const indexes = new EntityIndexes((table) => state[table]);

  assert.equal(indexes.byId("goithau").get("pkg-1").id, "pkg-1");
  assert.deepEqual(indexes.byRootId("goithau").get("pkg-root").map((row) => row.id), ["pkg-1", "pkg-2"]);
  assert.equal(indexes.byPlanId("goithau").get("plan-1")[0].id, "pkg-1");
  assert.equal(indexes.byPackageId("hanghoaduthaunhathau").get("pkg-1")[0].id, "bidder-goods-1");
  assert.equal(indexes.byOpeningId("hanghoaduthaunhathau").get("opening-1")[0].id, "bidder-goods-1");
  assert.equal(indexes.byContractorId("hanghoaduthaunhathau").get("contractor-1")[0].id, "bidder-goods-1");
  assert.equal(indexes.byLotId("hanghoaduthaunhathau").get("lot-1")[0].id, "bidder-goods-1");

  state.goithau.push({ id: "pkg-3", rootId: "pkg-3", keHoachId: "plan-1" });
  indexes.invalidate("goithau");
  assert.equal(indexes.byPlanId("goithau").get("plan-1").length, 2);
});

test("a fetched record replacement invalidates selectors that cached the previous object", () => {
  const state = {
    goithau: [{
      id: "pkg-1",
      rootId: "pkg-1",
      isLatest: 1,
      danhGiaHsdtMetadata: "{\"saved\":false}",
    }],
  };
  const model = {
    state,
    entityIndexes: new EntityIndexes((table) => state[table]),
  };
  const cached = model.entityIndexes.byId("goithau").get("pkg-1");
  const authoritative = {
    ...cached,
    rowVersion: 2,
    danhGiaHsdtMetadata: "{\"saved\":true,\"soBaoCao\":\"BC-01\"}",
  };

  storeFetchedRecord(model, "goithau", authoritative);

  const selected = model.entityIndexes.byId("goithau").get("pkg-1");
  assert.equal(selected, authoritative);
  assert.notEqual(selected, cached);
  assert.match(selected.danhGiaHsdtMetadata, /BC-01/);
});

test("a paginated record replacement becomes the canonical indexed package", () => {
  const state = {
    goithau: [{
      id: "pkg-1",
      rootId: "pkg-1",
      isLatest: 1,
      danhGiaHsdtMetadata: "{\"saved\":true,\"soBaoCao\":\"BC-01\"}",
    }],
  };
  const model = {
    state,
    entityIndexes: new EntityIndexes((table) => state[table]),
  };
  const cached = model.entityIndexes.byId("goithau").get("pkg-1");
  const [authoritative] = cachePaginatedRecords(model, "goithau", [{
    ...cached,
    rowVersion: 2,
    danhGiaHsdtMetadata: "{\"saved\":false}",
  }]);

  const selected = model.entityIndexes.byId("goithau").get("pkg-1");
  assert.equal(selected, authoritative);
  assert.notEqual(selected, cached);
  assert.equal(selected.danhGiaHsdtMetadata, "{\"saved\":false}");
});
