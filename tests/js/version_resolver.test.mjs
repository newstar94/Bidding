import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { resolveLatestNhaThauVersionId } from "../../frontend/partners/NhaThauComponent.js";
import { resolveLatestPackage } from "../../frontend/packages/detail/PackageDetailState.js";
import {
  resolveLatestVersion,
  selectLatestVersion,
  selectLatestVersionsByRoot,
  versionRootId,
} from "../../frontend/shared/versionResolver.js";

const row = (id, rootId, phienBan, isLatest = 0, extra = {}) => ({
  id,
  rootId,
  phienBan,
  isLatest,
  ...extra,
});

test("canonical latest resolution is order-independent and version-first", () => {
  const staleMarker = row("v01", "root", "01", 1);
  const higherVersion = row("v02", "root", "02", 0);
  const duplicateA = row("a", "duplicate", "03", 1);
  const duplicateB = row("b", "duplicate", "03", 1);

  for (const records of [
    [staleMarker, higherVersion],
    [higherVersion, staleMarker],
  ]) {
    assert.equal(selectLatestVersion(records)?.id, "v02");
    assert.equal(resolveLatestVersion(records, "v01")?.id, "v02");
  }
  assert.equal(selectLatestVersion([duplicateB, duplicateA])?.id, "a");
  assert.equal(selectLatestVersion([duplicateA, duplicateB])?.id, "a");
});

test("root identity is normalized and latest grouping returns one stable row per family", () => {
  const records = [
    row("a0", 7, "00"),
    row("a1", "7", "01"),
    row("b0", null, "00"),
  ];

  assert.equal(versionRootId(records[0]), "7");
  assert.equal(versionRootId(records[2]), "b0");
  assert.deepEqual(
    selectLatestVersionsByRoot(records).map((record) => record.id),
    ["a1", "b0"],
  );
});

test("package duplicate versions prefer the snapshot in the higher plan version", () => {
  const plans = new Map([
    ["plan-01", row("plan-01", "plan-root", "01", 0)],
    ["plan-02", row("plan-02", "plan-root", "02", 0)],
  ]);
  const oldSnapshot = row("pkg-old", "pkg-root", "04", 1, { keHoachId: "plan-01" });
  const newSnapshot = row("pkg-new", "pkg-root", "04", 0, { keHoachId: "plan-02" });
  const options = {
    getSecondaryVersion: (pkg) => plans.get(String(pkg.keHoachId))?.phienBan,
  };

  assert.equal(selectLatestVersion([oldSnapshot, newSnapshot], options)?.id, "pkg-new");
  assert.equal(selectLatestVersion([newSnapshot, oldSnapshot], options)?.id, "pkg-new");
});

test("BiddingModel list and single getters share the canonical tie-break", () => {
  const model = new BiddingModel();
  const planV1 = row("plan-v1", "plan-root", "01", 1);
  const planV2 = row("plan-v2", "plan-root", "02", 0);
  model.state.kehoach = [planV1, planV2];

  const packageV2OldPlan = row("pkg-v2-old", "pkg-root", "02", 1, { keHoachId: planV1.id });
  const packageV2NewPlan = row("pkg-v2-new", "pkg-root", "02", 0, { keHoachId: planV2.id });
  model.state.goithau = [packageV2OldPlan, packageV2NewPlan];

  assert.deepEqual(model.getLatestPlans(), [planV2]);
  assert.equal(model.getLatestPlan(planV1.id), planV2);
  assert.deepEqual(model.getLatestPackages(), [packageV2NewPlan]);
  assert.equal(model.getLatestPackage(packageV2OldPlan.id), packageV2NewPlan);
  assert.equal(model.getLatestPackage("pkg-root"), packageV2NewPlan);
  assert.deepEqual(model.getLatestPackagesForPlan(planV1.id), [packageV2OldPlan]);
  assert.deepEqual(model.getLatestPackagesForPlan(planV2.id), [packageV2NewPlan]);
});

test("partner and contract list/single getters use the same version-first contract", () => {
  const model = new BiddingModel();
  for (const [stateKey, listMethod] of [
    ["chudautu", "getLatestChuDauTu"],
    ["nhathau", "getLatestNhaThau"],
    ["chuyengia", "getLatestChuyenGia"],
  ]) {
    const v1 = row(`${stateKey}-v1`, `${stateKey}-root`, "01", 1);
    const v2 = row(`${stateKey}-v2`, `${stateKey}-root`, "02", 0);
    model.state[stateKey] = [v1, v2];
    assert.deepEqual(model[listMethod](), [v2]);
  }

  const contractV1 = row("contract-v1", "contract-root", "01", 1);
  const contractV2 = row("contract-v2", "contract-root", "02", 0);
  model.state.hopdong = [contractV1, contractV2];
  assert.deepEqual(model.getLatestContracts(), [contractV2]);
  assert.equal(model.getLatestContract(contractV1.id), contractV2);
  assert.equal(model.getLatestContract("contract-root"), contractV2);
});

test("detail and contractor component resolvers agree with the model contract", () => {
  const model = new BiddingModel();
  const packageV1 = row("pkg-v1", "pkg-root", "01", 1);
  const packageV2 = row("pkg-v2", "pkg-root", "02", 0);
  model.state.goithau = [packageV1, packageV2];
  const contractorV1 = row("contractor-v1", "contractor-root", "01", 1);
  const contractorV2 = row("contractor-v2", "contractor-root", "02", 0);
  model.state.nhathau = [contractorV1, contractorV2];

  assert.equal(resolveLatestPackage(model, packageV1), packageV2);
  assert.equal(resolveLatestPackage({ state: model.state }, "pkg-root"), packageV2);
  assert.equal(resolveLatestNhaThauVersionId(model, contractorV1.id), contractorV2.id);
});
