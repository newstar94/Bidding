import assert from "node:assert/strict";
import test from "node:test";

import { saveBasicExcelImport } from "../../frontend/documents/excelSaveAdapters.js";

function controllerWithState(state) {
  const persisted = [];
  return {
    model: {
      state,
      currentPage: {},
      parseVND: (value) => Number(value || 0),
      getLatestPlans: () => state.kehoach.filter((item) => item.isLatest === 1),
      persistData: async (table) => persisted.push(table)
    },
    recalculatePlanTotal: () => {},
    persisted
  };
}

test("Excel plan upsert preserves lineage and optimistic-lock version", async () => {
  const existing = {
    id: "kh-1", rootId: "kh-root", phienBan: "02", isLatest: 1,
    maKeHoach: "KH-01", tenKeHoach: "Cũ", rowVersion: 7, createdAt: "2026-01-01"
  };
  const controller = controllerWithState({ kehoach: [existing] });

  const count = await saveBasicExcelImport(controller, "kehoach", [{
    maKeHoach: " kh-01 ", tenKeHoach: "Mới", tongMucDauTu: 100
  }]);

  assert.equal(count, 1);
  assert.equal(controller.model.state.kehoach.length, 1);
  assert.equal(controller.model.state.kehoach[0].id, "kh-1");
  assert.equal(controller.model.state.kehoach[0].rootId, "kh-root");
  assert.equal(controller.model.state.kehoach[0].rowVersion, 7);
  assert.equal(controller.model.state.kehoach[0].tenKeHoach, "Mới");
});

test("Excel package upsert keeps existing relations and does not duplicate the row", async () => {
  const plan = { id: "kh-1", maKeHoach: "KH-01", isLatest: 1 };
  const existing = {
    id: "gt-1", rootId: "gt-root", phienBan: "01", isLatest: 1,
    maGoiThau: "GT-01", keHoachId: "kh-1", tenGoiThau: "Cũ", rowVersion: 4,
    phanLo: "Có", phanLoList: [{ id: "lot-1", maPhanLo: "L1" }]
  };
  const controller = controllerWithState({ kehoach: [plan], goithau: [existing] });

  await saveBasicExcelImport(controller, "goithau", [{
    maGoiThau: "gt-01", maKeHoach: "KH-01", tenGoiThau: "Mới", giaGoiThau: 100
  }]);

  assert.equal(controller.model.state.goithau.length, 1);
  assert.equal(controller.model.state.goithau[0].id, "gt-1");
  assert.equal(controller.model.state.goithau[0].rowVersion, 4);
  assert.equal(controller.model.state.goithau[0].phanLoList[0].id, "lot-1");
  assert.equal(controller.model.state.goithau[0].tenGoiThau, "Mới");
});
