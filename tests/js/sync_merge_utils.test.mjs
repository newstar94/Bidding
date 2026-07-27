import assert from "node:assert/strict";
import test from "node:test";

import {
  applyServerSnapshot,
  mergeReferenceRecords,
} from "../../frontend/app/syncMergeUtils.js";

test("reference merge preserves complete local fields and authoritative package identity", () => {
  const model = {
    state: {
      nhathau: [{
        id: "contractor-1",
        tenNhaThau: "Tên cũ",
        diaChi: "Chi tiết đầy đủ",
        referenceOnly: false,
      }],
      goithau: [{
        id: "package-1",
        tenGoiThau: "Tên cũ",
        noiDungChiTiet: "Giữ nội dung cục bộ",
        referenceOnly: false,
      }],
    },
  };

  mergeReferenceRecords(model, "nhathau", [{
    id: "contractor-1",
    tenNhaThau: "Tên tham chiếu",
  }]);
  mergeReferenceRecords(model, "goithau", [{
    id: "package-1",
    tenGoiThau: "Tên từ máy chủ",
  }]);

  assert.equal(model.state.nhathau[0].tenNhaThau, "Tên cũ");
  assert.equal(model.state.nhathau[0].diaChi, "Chi tiết đầy đủ");
  assert.equal(model.state.goithau[0].tenGoiThau, "Tên từ máy chủ");
  assert.equal(model.state.goithau[0].noiDungChiTiet, "Giữ nội dung cục bộ");
});

test("reference merge does not scan the growing state once per incoming record", () => {
  const records = [];
  let predicateCalls = 0;
  records.findIndex = (predicate) => {
    for (let index = 0; index < records.length; index += 1) {
      predicateCalls += 1;
      if (predicate(records[index], index, records)) return index;
    }
    return -1;
  };
  const model = { state: { nhathau: records } };
  const incoming = Array.from({ length: 1_000 }, (_, index) => ({
    id: `contractor-${index}`,
    tenNhaThau: `Nhà thầu ${index}`,
  }));

  mergeReferenceRecords(model, "nhathau", incoming);

  assert.equal(model.state.nhathau.length, incoming.length);
  assert.ok(
    predicateCalls <= incoming.length,
    `reference merge performed ${predicateCalls} growing-array probes`,
  );
});

test("server snapshot reuses merged references instead of finding every record again", async () => {
  const records = [];
  let predicateCalls = 0;
  records.find = (predicate) => {
    for (let index = 0; index < records.length; index += 1) {
      predicateCalls += 1;
      if (predicate(records[index], index, records)) return records[index];
    }
    return undefined;
  };
  let persisted = null;
  const model = {
    state: { nhathau: records },
    suspendMutationTracking: (callback) => callback(),
    getMutationQueue: () => null,
    db: {
      applySyncChanges: async (changes) => {
        persisted = changes;
      },
    },
  };
  const incoming = Array.from({ length: 1_000 }, (_, index) => ({
    id: `contractor-${index}`,
    tenNhaThau: `Nhà thầu ${index}`,
  }));

  const result = applyServerSnapshot(model, {
    useServerSidePagination: true,
    paginatedKeys: ["nhathau"],
    referenceData: { nhathau: incoming },
  }, { since: "0", useVersionDelta: false });
  await result.persistencePromise;

  assert.equal(persisted.upserts.nhathau.length, incoming.length);
  assert.ok(
    predicateCalls <= incoming.length,
    `server snapshot performed ${predicateCalls} post-merge probes`,
  );
});
