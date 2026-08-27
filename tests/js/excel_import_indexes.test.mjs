import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpertImportIndex,
  findIndexedExpert,
} from "../../frontend/documents/excelImportIndexes.js";
import { saveBasicExcelImport } from "../../frontend/documents/excelSaveAdapters.js";


test("expert Excel index preserves current CCCD and certificate matching", () => {
  const current = {
    id: "current",
    isLatest: 1,
    soCCCD: " 012345678901 ",
    soChungChi: " CC-001 ",
  };
  const historical = {
    id: "historical",
    isLatest: 0,
    soCCCD: "999999999999",
    soChungChi: "CC-OLD",
  };
  const index = buildExpertImportIndex([historical, current]);

  assert.equal(findIndexedExpert(index, { soCCCD: "012345678901" }), current);
  assert.equal(findIndexedExpert(index, { soChungChi: "cc-001" }), current);
  assert.equal(findIndexedExpert(index, { soCCCD: "999999999999" }), null);
});


test("expert Excel lookup builds once instead of rescanning records per row", () => {
  let citizenIdReads = 0;
  const records = Array.from({ length: 5000 }, (_, index) => ({
    isLatest: true,
    get soCCCD() {
      citizenIdReads += 1;
      return String(index).padStart(12, "0");
    },
    soChungChi: `CC-${index}`,
  }));

  const index = buildExpertImportIndex(records);
  for (let value = 0; value < 500; value += 1) {
    findIndexedExpert(index, { soCCCD: String(value).padStart(12, "0") });
  }

  assert.equal(citizenIdReads, records.length);
});


test("expert save lookup preserves first-record matching across both identities", () => {
  const certificateMatch = {
    id: "first",
    isLatest: 0,
    soCCCD: "111111111111",
    soChungChi: "CC-SHARED",
  };
  const citizenMatch = {
    id: "second",
    isLatest: 1,
    soCCCD: "222222222222",
    soChungChi: "CC-OTHER",
  };
  const index = buildExpertImportIndex(
    [certificateMatch, citizenMatch],
    { latestOnly: false },
  );

  assert.equal(findIndexedExpert(index, {
    soCCCD: "222222222222",
    soChungChi: "CC-SHARED",
  }), certificateMatch);
});


test("indexed expert Excel save preserves identity and existing images", async () => {
  const existing = {
    id: "expert-1",
    rootId: "expert-1",
    phienBan: "00",
    isLatest: 1,
    soCCCD: "123456789012",
    soChungChi: "CC-OLD",
    anhChungChi: "certificate-image",
    tenAnhChungChi: "certificate.webp",
    anhChuKy: "signature-image",
    tenAnhChuKy: "signature.webp",
  };
  let persisted = null;
  const controller = {
    model: {
      state: { chuyengia: [existing] },
      persistChanges: async (_table, changes) => {
        persisted = changes.upserts;
      },
      commitLocalMutation() {},
      convertDMYToYMD: (value) => value,
    },
  };

  const count = await saveBasicExcelImport(controller, "chuyengia", [{
    hoTen: "Dòng kiểm thử",
    soCCCD: "123456789012",
    soChungChi: "CC-NEW",
  }]);

  assert.equal(count, 1);
  assert.equal(controller.model.state.chuyengia.length, 1);
  assert.equal(controller.model.state.chuyengia[0].id, existing.id);
  assert.equal(controller.model.state.chuyengia[0].anhChuKy, "signature-image");
  assert.equal(persisted[0].tenAnhChungChi, "certificate.webp");
});


test("failed Excel persistence restores the pre-import in-memory workspace", async () => {
  const original = {
    id: "plan-1",
    maKeHoach: "KH-01",
    tenKeHoach: "Tên cũ",
    isLatest: 1,
    rootId: "plan-1",
    phienBan: "00",
  };
  const controller = {
    model: {
      state: { kehoach: [structuredClone(original)] },
      persistChanges: async () => { throw new Error("IndexedDB failed"); },
      commitLocalMutation() {},
      parseVND: (value) => Number(value || 0),
      convertDMYToYMD: (value) => value,
      convertDMYHMSToYMDHMS: (value) => value,
    },
  };

  await assert.rejects(
    saveBasicExcelImport(controller, "kehoach", [{
      maKeHoach: "KH-01",
      tenKeHoach: "Tên bị rollback",
    }]),
    /IndexedDB failed/,
  );
  assert.deepEqual(controller.model.state.kehoach, [original]);
});
