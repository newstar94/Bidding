import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { selectExpertVersion } from "../../frontend/experts/ExpertVersionSelection.js";

test("expert version selection hydrates the historical record and reuses the current page", async () => {
  const latest = {
    id: "expert-v01",
    rootId: "expert-root",
    phienBan: "01",
    allVersions: [
      { id: "expert-v01", phienBan: "01" },
      { id: "expert-v00", phienBan: "00" },
    ],
  };
  const historical = {
    id: "expert-v00",
    rootId: "expert-root",
    phienBan: "00",
  };
  const renders = [];
  const lookups = [];
  const controller = {
    model: {
      state: { chuyengia: [latest], selectedChuyenGiaVersion: {} },
    },
    async fetchRecordByLookup(table, id) {
      lookups.push([table, id]);
      if (id === historical.id) this.model.state.chuyengia.push(historical);
      return id === historical.id ? historical : null;
    },
    view: {
      async renderChuyenGiaTable(options) {
        renders.push(options);
      },
    },
  };

  await selectExpertVersion(controller, latest.rootId, historical.id);

  assert.deepEqual(lookups, [["chuyengia", historical.id]]);
  assert.equal(controller.model.state.selectedChuyenGiaVersion[latest.rootId], historical.id);
  assert.deepEqual(renders, [{ reuseCurrentPage: true }]);
});

test("expert table has an explicit cached-page path for version-only rendering", async () => {
  const source = await readFile(
    new URL("../../frontend/experts/ChuyenGiaComponent.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /reuseCurrentPage/u);
  assert.match(source, /_chuyenGiaPageSnapshot/u);
});
