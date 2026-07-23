import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteAllPackageVersions,
  deleteLatestPackageVersion,
  getPackageDeleteContext,
} from "../../frontend/packages/packageDeleteHelpers.js";
import {
  refreshPackageDeleteDependencies,
} from "../../frontend/packages/packageLifecycleWorkflow.js";


function deletionHarness() {
  const packageV0 = {
    id: "pkg-v0",
    rootId: "pkg-root",
    phienBan: "00",
    rowVersion: 4,
    keHoachId: "plan-1",
  };
  const packageV1 = {
    id: "pkg-v1",
    rootId: "pkg-root",
    phienBan: "01",
    rowVersion: 7,
    keHoachId: "plan-1",
  };
  const openingBid = {
    id: "bid-1",
    goiThauId: "pkg-v1",
    rowVersion: 3,
  };
  const deletions = [];
  const model = {
    state: {
      goithau: [packageV0, packageV1],
      thongtinmothau: [openingBid],
    },
    markDeleted(table, records) {
      (Array.isArray(records) ? records : [records]).forEach((record) => {
        deletions.push({
          table,
          id: record.id,
          expectedVersion: record.rowVersion,
        });
      });
    },
  };
  return { model, deletions, packageV0, packageV1, openingBid };
}


test("deleting the latest package version retains server row versions in the first sync", () => {
  const { model, deletions, packageV1, openingBid } = deletionHarness();
  const context = getPackageDeleteContext(model.state.goithau, packageV1.id);

  deleteLatestPackageVersion(model, context);

  assert.deepEqual(deletions, [
    { table: "goithau", id: packageV1.id, expectedVersion: 7 },
    { table: "thongtinmothau", id: openingBid.id, expectedVersion: 3 },
  ]);
});


test("deleting every package version retains each expectedVersion in the first sync", () => {
  const { model, deletions, packageV0, packageV1, openingBid } = deletionHarness();
  const context = getPackageDeleteContext(model.state.goithau, packageV1.id);

  deleteAllPackageVersions(model, context);

  assert.deepEqual(deletions, [
    { table: "goithau", id: packageV0.id, expectedVersion: 4 },
    { table: "goithau", id: packageV1.id, expectedVersion: 7 },
    { table: "thongtinmothau", id: openingBid.id, expectedVersion: 3 },
  ]);
});

test("package deletion refreshes every record whose version participates in the mutation", async () => {
  const { model, packageV1 } = deletionHarness();
  const context = getPackageDeleteContext(model.state.goithau, packageV1.id);
  const refreshed = [];
  const controller = {
    model,
    async fetchRecordByLookup(table, id) {
      refreshed.push(`${table}:${id}`);
      return model.state[table]?.find((record) => String(record.id) === String(id)) || null;
    },
  };

  const refreshedContext = await refreshPackageDeleteDependencies(controller, context);

  assert.deepEqual(refreshed.sort(), [
    "goithau:pkg-v0",
    "goithau:pkg-v1",
    "kehoach:plan-1",
    "thongtinmothau:bid-1",
  ]);
  assert.equal(refreshedContext.targetPackage.id, packageV1.id);
});