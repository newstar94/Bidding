import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { buildPackageDetailViewModel } from "../../frontend/packages/detail/PackageDetailViewModel.js";
import { hydrateVersionFamily } from "../../frontend/shared/VersionFamilyLoader.js";

test("detail version hydration loads missing records advertised by allVersions", async () => {
  const latest = {
    id: "package-v01",
    rootId: "package-root",
    phienBan: "01",
    isLatest: 1,
    allVersions: [
      { id: "package-v01", phienBan: "01" },
      { id: "package-v00", phienBan: "00" },
    ],
  };
  const historical = {
    id: "package-v00",
    rootId: "package-root",
    phienBan: "00",
    isLatest: 0,
  };
  const requested = [];
  const controller = {
    model: {
      state: { goithau: [latest], kehoach: [] },
      getLatestPackage: () => latest,
      getLatestPlan: () => null,
    },
    async fetchRecordByLookup(table, id) {
      requested.push([table, id]);
      if (id === historical.id) this.model.state.goithau.push(historical);
      return id === historical.id ? historical : null;
    },
  };

  await hydrateVersionFamily(controller, "goithau", latest);

  assert.deepEqual(requested, [["goithau", "package-v00"]]);
  const detail = buildPackageDetailViewModel({
    model: controller.model,
    packageId: latest.id,
  });
  assert.deepEqual(
    detail.versions.map(({ id, label }) => ({ id, label })),
    [
      { id: "package-v00", label: "00" },
      { id: "package-v01", label: "01" },
    ],
  );
});

test("package, plan, and contract detail paths hydrate their version family", async () => {
  const [packageDetail, planView, contractView] = await Promise.all([
    readFile(new URL("../../frontend/packages/GoiThauDetail.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/plans/KeHoachView.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/contracts/HopDongComponent.js", import.meta.url), "utf8"),
  ]);

  for (const source of [packageDetail, planView, contractView]) {
    assert.match(source, /await hydrateVersionFamily\(/u);
  }
});
